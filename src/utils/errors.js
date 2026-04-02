/**
 * Custom Error Classes & Express Error Handlers
 *
 * Provides a hierarchy of HTTP-aware error classes and two Express
 * middleware functions:
 *   - notFoundHandler: catches unmatched routes (404)
 *   - errorHandler:    global error handler (must be last middleware)
 */

'use strict';

const logger = require('./logger');

// ---------------------------------------------------------------------------
// Base Application Error
// ---------------------------------------------------------------------------

class AppError extends Error {
  /**
   * @param {string} message   - Human-readable error message
   * @param {number} statusCode - HTTP status code
   * @param {string} code       - Machine-readable error code
   */
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR') {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true; // distinguishes expected errors from bugs
    Error.captureStackTrace(this, this.constructor);
  }
}

// ---------------------------------------------------------------------------
// Specific Error Types
// ---------------------------------------------------------------------------

class ValidationError extends AppError {
  /**
   * @param {string} message
   * @param {Array<{field: string, message: string}>} [details]
   */
  constructor(message = 'Validation failed', details = []) {
    super(message, 422, 'VALIDATION_ERROR');
    this.details = details;
  }
}

class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(message, 403, 'FORBIDDEN');
  }
}

class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(message, 404, 'NOT_FOUND');
  }
}

class ConflictError extends AppError {
  constructor(message = 'Conflict') {
    super(message, 409, 'CONFLICT');
  }
}

class BadRequestError extends AppError {
  constructor(message = 'Bad request') {
    super(message, 400, 'BAD_REQUEST');
  }
}

// ---------------------------------------------------------------------------
// Express Middleware
// ---------------------------------------------------------------------------

/**
 * 404 handler — catches requests to undefined routes.
 */
const notFoundHandler = (req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.originalUrl} not found`,
    },
  });
};

/**
 * Global error handler — must be registered LAST in the middleware chain.
 * Formats all errors into a consistent JSON response.
 */
// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, _next) => {
  // Log the error
  if (err.isOperational) {
    logger.warn(`[${err.code}] ${err.message}`, { url: req.originalUrl, method: req.method });
  } else {
    logger.error('Unexpected error', { error: err.message, stack: err.stack, url: req.originalUrl });
  }

  // Mongoose duplicate key error
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0] || 'field';
    return res.status(409).json({
      success: false,
      error: {
        code: 'CONFLICT',
        message: `${field} already exists`,
      },
    });
  }

  // Mongoose validation error
  if (err.name === 'ValidationError' && err.errors) {
    const details = Object.values(err.errors).map((e) => ({
      field: e.path,
      message: e.message,
    }));
    return res.status(422).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details,
      },
    });
  }

  // JWT errors (should be caught in authGuard, but just in case)
  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Invalid or expired token',
      },
    });
  }

  // Operational (expected) errors
  if (err.isOperational) {
    const body = {
      success: false,
      error: {
        code: err.code,
        message: err.message,
      },
    };
    if (err.details) body.error.details = err.details;
    return res.status(err.statusCode).json(body);
  }

  // Unknown / programming errors — hide details in production
  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message:
        process.env.NODE_ENV === 'production'
          ? 'An unexpected error occurred. Please try again later.'
          : err.message,
    },
  });
};

module.exports = {
  AppError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  BadRequestError,
  notFoundHandler,
  errorHandler,
};
