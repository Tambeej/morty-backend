/**
 * Authentication Middleware
 * Validates JWT access tokens on protected routes.
 */

const { verifyAccessToken } = require('../utils/jwt');
const { AppError } = require('../utils/errors');
const logger = require('../utils/logger');

/**
 * authenticate middleware
 * Extracts the Bearer token from the Authorization header,
 * verifies it, and attaches the decoded payload to req.user.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next(new AppError('Authentication token is missing or malformed.', 401));
    }

    const token = authHeader.split(' ')[1];

    let decoded;
    try {
      decoded = verifyAccessToken(token);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return next(new AppError('Access token has expired. Please refresh your session.', 401));
      }
      return next(new AppError('Invalid access token.', 401));
    }

    // Attach user info to request for downstream handlers
    req.user = {
      id: decoded.id,
      email: decoded.email,
    };

    return next();
  } catch (err) {
    logger.error('Auth middleware error:', err);
    return next(new AppError('Authentication failed.', 500));
  }
}

module.exports = { authenticate };
