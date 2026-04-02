/**
 * Authentication Middleware
 * JWT token verification for protected routes
 */

const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { AuthError } = require('../utils/errors');
const logger = require('../utils/logger');

/**
 * Verify JWT token and attach user to request
 */
const authMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next(new AuthError('No token provided'));
    }

    const token = authHeader.split(' ')[1];

    if (!token) {
      return next(new AuthError('No token provided'));
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await User.findById(decoded.id).select('-password -refreshToken').lean();

    if (!user) {
      return next(new AuthError('User no longer exists'));
    }

    req.user = {
      id: user._id.toString(),
      email: user.email,
      phone: user.phone,
      verified: user.verified,
    };

    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return next(new AuthError('Invalid token'));
    }
    if (error.name === 'TokenExpiredError') {
      return next(new AuthError('Token expired'));
    }
    logger.error('Auth middleware error:', error.message);
    next(error);
  }
};

module.exports = authMiddleware;
