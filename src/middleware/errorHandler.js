'use strict';

const { AppError } = require('../utils/errors');
const logger = require('../utils/logger');

/**
 * Global Express error handler.
 * Must be registered as the last middleware with 4 parameters.
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  // Log the error
  if (err.isOperational) {
    logger.warn('Operational error', {
      code: err.code,
      message: err.message,
      statusCode: err.statusCode,
      path: req.path,
      method: req.method,
    });
  } else {
    logger.error('Unexpected error', {
      message: err.message,
      stack: err.stack,
      path: req.path,
      method: req.method,
    });
  }

  // Determine status code and message
  const statusCode = err.statusCode || 500;
  const code = err.code || 'INTERNAL_ERROR';
  const message =
    err.isOperational
      ? err.message
      : 'An unexpected error occurred. Please try again later.';

  const body = {
    success: false,
    error: {
      code,
      message,
    },
  };

  if (err.details) {
    body.error.details = err.details;
  }

  // Don't expose stack traces in production
  if (process.env.NODE_ENV === 'development' && !err.isOperational) {
    body.error.stack = err.stack;
  }

  return res.status(statusCode).json(body);
}

module.exports = { errorHandler };
