/**
 * Global error handling middleware for the Morty backend.
 * Catches all errors passed via next(err) and returns
 * consistent JSON error responses.
 *
 * Must be registered LAST in the Express middleware stack.
 */

const logger = require('../utils/logger');
const {
  AppError,
  handleMongooseError,
  handleJWTError,
} = require('../utils/errors');

/**
 * Determine if we should expose error details to the client.
 * In production, hide internal error details.
 *
 * @param {Error} err - The error
 * @returns {boolean}
 */
const shouldExposeDetails = (err) => {
  if (process.env.NODE_ENV === 'development') return true;
  if (err instanceof AppError && err.isOperational) return true;
  return false;
};

/**
 * Format error response body.
 *
 * @param {Error} err - The error
 * @param {string} requestId - Request ID for tracing
 * @returns {Object} JSON response body
 */
const formatErrorResponse = (err, requestId) => {
  const expose = shouldExposeDetails(err);

  const response = {
    success: false,
    error: {
      code: err.errorCode || 'INTERNAL_SERVER_ERROR',
      message: expose ? err.message : 'An unexpected error occurred',
      ...(expose && err.details && { details: err.details }),
      requestId,
      timestamp: new Date().toISOString(),
    },
  };

  // Include stack trace in development
  if (process.env.NODE_ENV === 'development' && err.stack) {
    response.error.stack = err.stack;
  }

  return response;
};

/**
 * Log the error with appropriate severity.
 *
 * @param {Error} err - The error
 * @param {Object} req - Express request object
 */
const logError = (err, req) => {
  const logData = {
    errorCode: err.errorCode,
    statusCode: err.statusCode,
    message: err.message,
    path: req.path,
    method: req.method,
    ip: req.ip,
    userId: req.user?.id,
    requestId: req.id,
    isOperational: err.isOperational,
  };

  if (err.statusCode >= 500 || !err.isOperational) {
    // Server errors and programming errors - log with stack trace
    logger.error('Unhandled error', { ...logData, stack: err.stack });
  } else if (err.statusCode >= 400) {
    // Client errors - log as warnings (expected behavior)
    logger.warn('Client error', logData);
  }
};

/**
 * Handle Multer-specific errors.
 *
 * @param {Error} err - Multer error
 * @returns {AppError|null}
 */
const handleMulterError = (err) => {
  const { PayloadTooLargeError, UnsupportedMediaTypeError, ValidationError } = require('../utils/errors');

  if (err.code === 'LIMIT_FILE_SIZE') {
    return new PayloadTooLargeError('File size exceeds the 5MB limit');
  }
  if (err.code === 'LIMIT_FILE_COUNT') {
    return new ValidationError('Too many files uploaded at once');
  }
  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    return new ValidationError(`Unexpected file field: ${err.field}`);
  }
  if (err.code === 'LIMIT_FIELD_KEY') {
    return new ValidationError('Field name too long');
  }
  if (err.code === 'LIMIT_FIELD_VALUE') {
    return new ValidationError('Field value too long');
  }
  return null;
};

/**
 * Global error handler middleware.
 * Must have 4 parameters (err, req, res, next) for Express to recognize it.
 *
 * @param {Error} err - Error object
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
// eslint-disable-next-line no-unused-vars
const globalErrorHandler = (err, req, res, next) => {
  let error = err;

  // Convert known error types to AppError
  if (!(error instanceof AppError)) {
    // Try Mongoose errors
    const mongooseError = handleMongooseError(error);
    if (mongooseError) {
      error = mongooseError;
    }
    // Try JWT errors
    else if (handleJWTError(error)) {
      error = handleJWTError(error);
    }
    // Try Multer errors
    else if (error.name === 'MulterError') {
      const multerError = handleMulterError(error);
      if (multerError) {
        error = multerError;
      }
    }
    // Handle CORS errors
    else if (error.message && error.message.startsWith('CORS:')) {
      const { AuthorizationError } = require('../utils/errors');
      error = new AuthorizationError(error.message);
    }
    // Handle body parser errors (malformed JSON)
    else if (error.type === 'entity.parse.failed') {
      const { ValidationError } = require('../utils/errors');
      error = new ValidationError('Invalid JSON in request body');
    }
    // Handle payload too large from body parser
    else if (error.type === 'entity.too.large') {
      const { PayloadTooLargeError } = require('../utils/errors');
      error = new PayloadTooLargeError('Request body too large');
    }
    // Unknown errors - wrap as internal server error
    else {
      const { InternalServerError } = require('../utils/errors');
      const internalError = new InternalServerError(
        process.env.NODE_ENV === 'development' ? error.message : 'An unexpected error occurred'
      );
      internalError.originalError = error;
      error = internalError;
    }
  }

  // Log the error
  logError(error, req);

  // Send response
  const statusCode = error.statusCode || 500;
  const responseBody = formatErrorResponse(error, req.id);

  return res.status(statusCode).json(responseBody);
};

/**
 * 404 Not Found handler.
 * Must be registered BEFORE the global error handler
 * but AFTER all routes.
 *
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
const notFoundHandler = (req, res, next) => {
  const { NotFoundError } = require('../utils/errors');
  const error = new NotFoundError(`Route ${req.method} ${req.originalUrl}`);
  next(error);
};

module.exports = {
  globalErrorHandler,
  notFoundHandler,
};
