/**
 * Custom error classes for the Morty backend.
 * Provides structured error handling with HTTP status codes,
 * error types, and operational vs programming error distinction.
 */

/**
 * Base application error class.
 * All custom errors should extend this class.
 */
class AppError extends Error {
  /**
   * @param {string} message - Human-readable error message
   * @param {number} statusCode - HTTP status code
   * @param {string} errorCode - Machine-readable error code
   * @param {Object} [details] - Additional error details
   */
  constructor(message, statusCode = 500, errorCode = 'INTERNAL_ERROR', details = null) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.details = details;
    this.isOperational = true; // Operational errors are expected and handled
    this.timestamp = new Date().toISOString();

    // Capture stack trace (V8 only)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Convert error to JSON-serializable object for API responses.
   * @returns {Object}
   */
  toJSON() {
    return {
      error: {
        code: this.errorCode,
        message: this.message,
        ...(this.details && { details: this.details }),
        timestamp: this.timestamp,
      },
    };
  }
}

/**
 * 400 Bad Request - Invalid input data
 */
class ValidationError extends AppError {
  constructor(message, details = null) {
    super(message, 400, 'VALIDATION_ERROR', details);
  }
}

/**
 * 401 Unauthorized - Authentication required or failed
 */
class AuthenticationError extends AppError {
  constructor(message = 'Authentication required') {
    super(message, 401, 'AUTHENTICATION_ERROR');
  }
}

/**
 * 403 Forbidden - Authenticated but not authorized
 */
class AuthorizationError extends AppError {
  constructor(message = 'Access denied') {
    super(message, 403, 'AUTHORIZATION_ERROR');
  }
}

/**
 * 404 Not Found - Resource does not exist
 */
class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(`${resource} not found`, 404, 'NOT_FOUND');
  }
}

/**
 * 409 Conflict - Resource already exists or state conflict
 */
class ConflictError extends AppError {
  constructor(message) {
    super(message, 409, 'CONFLICT_ERROR');
  }
}

/**
 * 413 Payload Too Large - Request body or file too large
 */
class PayloadTooLargeError extends AppError {
  constructor(message = 'Payload too large') {
    super(message, 413, 'PAYLOAD_TOO_LARGE');
  }
}

/**
 * 415 Unsupported Media Type - Invalid file type
 */
class UnsupportedMediaTypeError extends AppError {
  constructor(message = 'Unsupported media type') {
    super(message, 415, 'UNSUPPORTED_MEDIA_TYPE');
  }
}

/**
 * 422 Unprocessable Entity - Semantically invalid request
 */
class UnprocessableEntityError extends AppError {
  constructor(message, details = null) {
    super(message, 422, 'UNPROCESSABLE_ENTITY', details);
  }
}

/**
 * 429 Too Many Requests - Rate limit exceeded
 */
class RateLimitError extends AppError {
  constructor(message = 'Too many requests, please try again later') {
    super(message, 429, 'RATE_LIMIT_EXCEEDED');
  }
}

/**
 * 500 Internal Server Error - Unexpected server error
 */
class InternalServerError extends AppError {
  constructor(message = 'An unexpected error occurred') {
    super(message, 500, 'INTERNAL_SERVER_ERROR');
    this.isOperational = false; // Programming errors are not operational
  }
}

/**
 * 502 Bad Gateway - External service error
 */
class ExternalServiceError extends AppError {
  constructor(service, message) {
    super(`External service error (${service}): ${message}`, 502, 'EXTERNAL_SERVICE_ERROR');
  }
}

/**
 * 503 Service Unavailable - Service temporarily unavailable
 */
class ServiceUnavailableError extends AppError {
  constructor(message = 'Service temporarily unavailable') {
    super(message, 503, 'SERVICE_UNAVAILABLE');
  }
}

/**
 * Wrap async route handlers to catch errors and pass to next().
 * Eliminates the need for try/catch in every route handler.
 *
 * @param {Function} fn - Async route handler function
 * @returns {Function} Express middleware function
 *
 * @example
 * router.get('/users', asyncHandler(async (req, res) => {
 *   const users = await User.find();
 *   res.json(users);
 * }));
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

/**
 * Create a standardized error from a Mongoose error.
 * @param {Error} err - Mongoose error
 * @returns {AppError}
 */
const handleMongooseError = (err) => {
  // Duplicate key error
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0] || 'field';
    const value = err.keyValue ? err.keyValue[field] : 'value';
    return new ConflictError(`${field} '${value}' already exists`);
  }

  // Validation error
  if (err.name === 'ValidationError') {
    const details = Object.values(err.errors).map((e) => ({
      field: e.path,
      message: e.message,
    }));
    return new ValidationError('Database validation failed', details);
  }

  // Cast error (invalid ObjectId, etc.)
  if (err.name === 'CastError') {
    return new ValidationError(`Invalid ${err.path}: ${err.value}`);
  }

  return null;
};

/**
 * Create a standardized error from a JWT error.
 * @param {Error} err - JWT error
 * @returns {AppError}
 */
const handleJWTError = (err) => {
  if (err.name === 'JsonWebTokenError') {
    return new AuthenticationError('Invalid token');
  }
  if (err.name === 'TokenExpiredError') {
    return new AuthenticationError('Token has expired');
  }
  return null;
};

module.exports = {
  AppError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ConflictError,
  PayloadTooLargeError,
  UnsupportedMediaTypeError,
  UnprocessableEntityError,
  RateLimitError,
  InternalServerError,
  ExternalServiceError,
  ServiceUnavailableError,
  asyncHandler,
  handleMongooseError,
  handleJWTError,
};
