/**
 * Authentication Middleware
 *
 * Verifies JWT access tokens on protected routes.
 * Attaches the decoded user payload to req.user.
 */

'use strict';

const jwt = require('jsonwebtoken');
const { UnauthorizedError } = require('../utils/errors');
const logger = require('../utils/logger');

/**
 * authGuard — protects routes that require a valid JWT.
 *
 * Expects: Authorization: Bearer <token>
 */
const authGuard = (req, _res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedError('No token provided. Please log in.');
    }

    const token = authHeader.split(' ')[1];

    if (!token) {
      throw new UnauthorizedError('Malformed authorization header.');
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      logger.error('JWT_SECRET environment variable is not set');
      throw new Error('Server configuration error');
    }

    const decoded = jwt.verify(token, secret);
    req.user = decoded; // { userId, email, iat, exp }
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return next(new UnauthorizedError('Token has expired. Please log in again.'));
    }
    if (err.name === 'JsonWebTokenError') {
      return next(new UnauthorizedError('Invalid token. Please log in again.'));
    }
    next(err);
  }
};

module.exports = { authGuard };
