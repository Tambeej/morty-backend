/**
 * Error Utilities
 * Custom error classes and global error handlers
 */

const logger = require('./logger');

/**
 * Custom Application Error class
 */
class AppError extends Error {
  constructor(message, statusCode, isOperational) {
    super(message);
    this.statusCode = statusCode || 500;
    this.isOperational = isOperational !== undefined ? isOperational : true;
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Validation Error class
 */
class ValidationError extends AppError {
  constructor(message, details) {
    super(message, 422);
    this.details = details || [];
  }
}

/**
 * Authentication Error class
 */
class AuthError extends AppError {
  constructor(message) {
    super(message || 'Authentication required', 401);
  }
}

/**
 * Authorization Error class
 */
class ForbiddenError extends AppError {
  constructor(message) {
    super(message || 'Access forbidden', 403);
  }
}

/**
 * Not Found Error class
 */
class NotFoundError extends AppError {
  constructor(message) {
    super(message || 'Resource not found', 404);
  }
}

/**
 * Global error handler middleware
 */
const errorHandler = (err, req, res, next) => {
  if (err.statusCode >= 500 || !err.isOperational) {
    logger.error('Unhandled error:', {
      message: err.message,
      stack: err.stack,
      url: req.url,
      method: req.method,
    });
  } else {
    logger.warn('Operational error:', {
      message: err.message,
      statusCode: err.statusCode,
      url: req.url,
    });
  }

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const details = Object.values(err.errors).map((e) => ({
      field: e.path,
      message: e.message,
    }));
    return res.status(422).json({
      success: false,
      error: 'Validation failed',
      details,
    });
  }

  // Mongoose duplicate key error
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0] || 'field';
    return res.status(409).json({
      success: false,
      error: `${field} already exists`,
    });
  }

  // Mongoose cast error (invalid ObjectId)
  if (err.name === 'CastError') {
    return res.status(400).json({
      success: false,
      error: 'Invalid ID format',
    });
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      success: false,
      error: 'Invalid token',
    });
  }

  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      error: 'Token expired',
    });
  }

  // Multer file size error
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({
      success: false,
      error: 'File too large. Maximum size is 5MB.',
    });
  }

  // Validation error with details
  if (err instanceof ValidationError) {
    return res.status(err.statusCode).json({
      success: false,
      error: err.message,
      details: err.details,
    });
  }

  // Operational errors (known errors)
  if (err.isOperational) {
    return res.status(err.statusCode).json({
      success: false,
      error: err.message,
    });
  }

  // Unknown errors
  const statusCode = err.statusCode || 500;
  const message =
    process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message;

  res.status(statusCode).json({
    success: false,
    error: message,
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }),
  });
};

/**
 * 404 Not Found handler
 */
const notFoundHandler = (req, res) => {
  res.status(404).json({
    success: false,
    error: `Route ${req.method} ${req.url} not found`,
  });
};

module.exports = {
  AppError,
  ValidationError,
  AuthError,
  ForbiddenError,
  NotFoundError,
  errorHandler,
  notFoundHandler,
};
