/**
 * Custom Error Classes and Utilities
 * Provides structured error handling throughout the application.
 */

/**
 * AppError - Custom operational error class.
 * Used for expected errors (validation failures, not found, unauthorized, etc.)
 * that should be returned to the client with a specific HTTP status code.
 *
 * @param {string} message - Human-readable error message
 * @param {number} statusCode - HTTP status code (400, 401, 403, 404, 422, 500, etc.)
 * @param {Array} [details] - Optional array of validation error details
 */
class AppError extends Error {
  constructor(message, statusCode = 500, details = null) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = true; // Distinguishes from programming errors

    // Capture stack trace (V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AppError);
    }
  }
}

/**
 * Format a Mongoose validation error into AppError details.
 *
 * @param {Object} mongooseError - Mongoose ValidationError
 * @returns {Array} Array of { field, message } objects
 */
const formatMongooseValidationError = (mongooseError) => {
  return Object.values(mongooseError.errors).map((err) => ({
    field: err.path,
    message: err.message,
  }));
};

/**
 * Global error handler middleware for Express.
 * Must be registered LAST in the middleware chain.
 *
 * @param {Error} err - Error object
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Function} next - Next middleware (required for Express error handler signature)
 */
const globalErrorHandler = (err, req, res, next) => { // eslint-disable-line no-unused-vars
  const logger = require('./logger');

  // Default to 500 Internal Server Error
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Internal Server Error';
  let details = err.details || null;

  // Handle Mongoose duplicate key error (e.g., duplicate email)
  if (err.code === 11000) {
    statusCode = 409;
    const field = Object.keys(err.keyValue || {})[0] || 'field';
    message = `A record with this ${field} already exists.`;
  }

  // Handle Mongoose validation errors
  if (err.name === 'ValidationError') {
    statusCode = 422;
    message = 'Validation failed';
    details = formatMongooseValidationError(err);
  }

  // Handle Mongoose CastError (invalid ObjectId)
  if (err.name === 'CastError') {
    statusCode = 400;
    message = `Invalid value for field: ${err.path}`;
  }

  // Handle JWT errors
  if (err.name === 'JsonWebTokenError') {
    statusCode = 401;
    message = 'Invalid authentication token.';
  }
  if (err.name === 'TokenExpiredError') {
    statusCode = 401;
    message = 'Authentication token has expired. Please log in again.';
  }

  // Log server errors (5xx) with full stack trace
  if (statusCode >= 500) {
    logger.error(`[${statusCode}] ${message}`, {
      error: err.message,
      stack: err.stack,
      url: req.originalUrl,
      method: req.method,
      userId: req.user ? req.user.id : 'unauthenticated',
    });
  } else {
    logger.warn(`[${statusCode}] ${message}`, {
      url: req.originalUrl,
      method: req.method,
    });
  }

  // Build response
  const response = {
    success: false,
    error: {
      message,
      statusCode,
    },
  };

  if (details) {
    response.error.details = details;
  }

  // Include stack trace in development only
  if (process.env.NODE_ENV === 'development') {
    response.error.stack = err.stack;
  }

  res.status(statusCode).json(response);
};

module.exports = {
  AppError,
  globalErrorHandler,
  formatMongooseValidationError,
};
