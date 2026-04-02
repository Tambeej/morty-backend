/**
 * Authentication middleware for the Morty backend.
 * Verifies JWT access tokens and attaches user info to req.user.
 * Supports token blacklisting for logout functionality.
 */

const jwt = require('jsonwebtoken');
const User = require('../models/User');
const logger = require('../utils/logger');
const {
  AuthenticationError,
  AuthorizationError,
  asyncHandler,
} = require('../utils/errors');

/**
 * In-memory token blacklist for invalidated tokens.
 * In production, this should be replaced with Redis for:
 * - Persistence across server restarts
 * - Horizontal scaling support
 * - Automatic TTL-based cleanup
 *
 * @type {Map<string, number>} token -> expiry timestamp
 */
const tokenBlacklist = new Map();

/**
 * Clean up expired tokens from the blacklist.
 * Called periodically to prevent memory leaks.
 */
const cleanupBlacklist = () => {
  const now = Date.now();
  let cleaned = 0;
  for (const [token, expiry] of tokenBlacklist.entries()) {
    if (expiry < now) {
      tokenBlacklist.delete(token);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    logger.debug(`Cleaned ${cleaned} expired tokens from blacklist`);
  }
};

// Clean up blacklist every 15 minutes
setInterval(cleanupBlacklist, 15 * 60 * 1000);

/**
 * Add a token to the blacklist.
 * @param {string} token - JWT token to blacklist
 * @param {number} expiresAt - Token expiry timestamp (seconds)
 */
const blacklistToken = (token, expiresAt) => {
  tokenBlacklist.set(token, expiresAt * 1000); // Convert to milliseconds
  logger.debug('Token blacklisted', { tokenPrefix: token.substring(0, 20) });
};

/**
 * Check if a token is blacklisted.
 * @param {string} token - JWT token to check
 * @returns {boolean}
 */
const isTokenBlacklisted = (token) => {
  return tokenBlacklist.has(token);
};

/**
 * Extract JWT token from request.
 * Supports Bearer token in Authorization header.
 *
 * @param {Object} req - Express request object
 * @returns {string|null} JWT token or null
 */
const extractToken = (req) => {
  // Check Authorization header (Bearer token)
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }

  // Check httpOnly cookie (more secure alternative)
  if (req.cookies && req.cookies.accessToken) {
    return req.cookies.accessToken;
  }

  return null;
};

/**
 * Verify and decode a JWT token.
 *
 * @param {string} token - JWT token to verify
 * @param {string} [secret] - JWT secret (defaults to JWT_SECRET env var)
 * @returns {Object} Decoded token payload
 * @throws {AuthenticationError} If token is invalid or expired
 */
const verifyToken = (token, secret = process.env.JWT_SECRET) => {
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is not set');
  }

  try {
    return jwt.verify(token, secret);
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      throw new AuthenticationError('Access token has expired. Please refresh your token.');
    }
    if (err.name === 'JsonWebTokenError') {
      throw new AuthenticationError('Invalid access token');
    }
    throw new AuthenticationError('Token verification failed');
  }
};

/**
 * Generate a new access token.
 *
 * @param {Object} payload - Token payload
 * @param {string} payload.id - User ID
 * @param {string} payload.email - User email
 * @returns {string} Signed JWT access token
 */
const generateAccessToken = (payload) => {
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET environment variable is not set');
  }

  return jwt.sign(
    { id: payload.id, email: payload.email },
    process.env.JWT_SECRET,
    {
      expiresIn: process.env.JWT_EXPIRES_IN || '24h',
      issuer: 'morty-backend',
      audience: 'morty-app',
    }
  );
};

/**
 * Generate a new refresh token.
 *
 * @param {Object} payload - Token payload
 * @param {string} payload.id - User ID
 * @returns {string} Signed JWT refresh token
 */
const generateRefreshToken = (payload) => {
  if (!process.env.JWT_REFRESH_SECRET) {
    throw new Error('JWT_REFRESH_SECRET environment variable is not set');
  }

  return jwt.sign(
    { id: payload.id },
    process.env.JWT_REFRESH_SECRET,
    {
      expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
      issuer: 'morty-backend',
      audience: 'morty-app',
    }
  );
};

/**
 * Verify a refresh token.
 *
 * @param {string} token - Refresh token to verify
 * @returns {Object} Decoded token payload
 * @throws {AuthenticationError} If token is invalid or expired
 */
const verifyRefreshToken = (token) => {
  if (!process.env.JWT_REFRESH_SECRET) {
    throw new Error('JWT_REFRESH_SECRET environment variable is not set');
  }

  try {
    return jwt.verify(token, process.env.JWT_REFRESH_SECRET, {
      issuer: 'morty-backend',
      audience: 'morty-app',
    });
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      throw new AuthenticationError('Refresh token has expired. Please log in again.');
    }
    throw new AuthenticationError('Invalid refresh token');
  }
};

/**
 * Authentication middleware.
 * Verifies the JWT access token and attaches user to req.user.
 * Rejects requests with missing, invalid, or blacklisted tokens.
 *
 * @example
 * router.get('/protected', authenticate, handler);
 */
const authenticate = asyncHandler(async (req, res, next) => {
  const token = extractToken(req);

  if (!token) {
    throw new AuthenticationError('No authentication token provided');
  }

  // Check if token is blacklisted (logged out)
  if (isTokenBlacklisted(token)) {
    logger.logSecurity('BLACKLISTED_TOKEN_USED', {
      ip: req.ip,
      path: req.path,
      requestId: req.id,
    });
    throw new AuthenticationError('Token has been invalidated. Please log in again.');
  }

  // Verify token signature and expiry
  const decoded = verifyToken(token);

  // Fetch user from database to ensure they still exist and are active
  const user = await User.findById(decoded.id).select('-password -refreshToken');

  if (!user) {
    logger.logSecurity('TOKEN_FOR_DELETED_USER', {
      userId: decoded.id,
      ip: req.ip,
      requestId: req.id,
    });
    throw new AuthenticationError('User account no longer exists');
  }

  // Attach user and token to request for downstream use
  req.user = user;
  req.token = token;
  req.tokenPayload = decoded;

  next();
});

/**
 * Optional authentication middleware.
 * Attaches user to req.user if token is valid, but does NOT reject
 * requests without tokens. Useful for routes that work for both
 * authenticated and anonymous users.
 *
 * @example
 * router.get('/public', optionalAuthenticate, handler);
 */
const optionalAuthenticate = asyncHandler(async (req, res, next) => {
  const token = extractToken(req);

  if (!token) {
    return next();
  }

  try {
    if (!isTokenBlacklisted(token)) {
      const decoded = verifyToken(token);
      const user = await User.findById(decoded.id).select('-password -refreshToken');
      if (user) {
        req.user = user;
        req.token = token;
        req.tokenPayload = decoded;
      }
    }
  } catch (err) {
    // Silently ignore auth errors for optional auth
    logger.debug('Optional auth failed', { error: err.message });
  }

  next();
});

/**
 * Authorization middleware factory.
 * Checks if the authenticated user has the required role(s).
 *
 * @param {...string} roles - Allowed roles
 * @returns {Function} Express middleware
 *
 * @example
 * router.delete('/admin/users/:id', authenticate, authorize('admin'), handler);
 */
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return next(new AuthenticationError('Authentication required'));
    }

    if (roles.length > 0 && !roles.includes(req.user.role)) {
      logger.logSecurity('UNAUTHORIZED_ACCESS_ATTEMPT', {
        userId: req.user.id,
        userRole: req.user.role,
        requiredRoles: roles,
        path: req.path,
        method: req.method,
      });
      return next(new AuthorizationError('Insufficient permissions'));
    }

    next();
  };
};

/**
 * Resource ownership middleware.
 * Ensures the authenticated user owns the requested resource.
 * Compares req.user.id with a resource field (default: userId).
 *
 * @param {string} [resourceUserField='userId'] - Field name containing the owner's user ID
 * @returns {Function} Express middleware
 *
 * @example
 * // After fetching resource and attaching to req.resource:
 * router.put('/:id', authenticate, checkOwnership(), handler);
 */
const checkOwnership = (resourceUserField = 'userId') => {
  return (req, res, next) => {
    if (!req.user) {
      return next(new AuthenticationError('Authentication required'));
    }

    if (!req.resource) {
      return next(); // No resource to check ownership of
    }

    const resourceOwnerId = req.resource[resourceUserField]?.toString();
    const requestUserId = req.user.id?.toString();

    if (resourceOwnerId !== requestUserId) {
      logger.logSecurity('OWNERSHIP_VIOLATION', {
        userId: requestUserId,
        resourceOwnerId,
        path: req.path,
        method: req.method,
      });
      return next(new AuthorizationError('You do not have permission to access this resource'));
    }

    next();
  };
};

module.exports = {
  authenticate,
  optionalAuthenticate,
  authorize,
  checkOwnership,
  blacklistToken,
  isTokenBlacklisted,
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  verifyToken,
  extractToken,
};
