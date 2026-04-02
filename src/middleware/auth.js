/**
 * Authentication Middleware
 * JWT-based authentication guard for protected routes.
 */

const jwt = require('jsonwebtoken');
const { AppError } = require('../utils/errors');
const logger = require('../utils/logger');

/**
 * Extract JWT token from the Authorization header.
 * Supports 'Bearer <token>' format.
 *
 * @param {Object} req - Express request
 * @returns {string|null} Token string or null
 */
const extractToken = (req) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  return null;
};

/**
 * authenticate middleware
 * Verifies the JWT access token and attaches the decoded user to req.user.
 *
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Function} next - Next middleware
 */
const authenticate = (req, res, next) => {
  const token = extractToken(req);

  if (!token) {
    return next(new AppError('Authentication required. Please provide a valid Bearer token.', 401));
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // Attach user info to request for downstream use
    req.user = {
      id: decoded.id,
      email: decoded.email,
    };
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return next(new AppError('Authentication token has expired. Please log in again.', 401));
    }
    if (error.name === 'JsonWebTokenError') {
      return next(new AppError('Invalid authentication token.', 401));
    }
    logger.error('JWT verification error:', error);
    return next(new AppError('Authentication failed.', 401));
  }
};

module.exports = { authenticate };
