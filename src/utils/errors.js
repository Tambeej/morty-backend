/**
 * Custom error classes for the Morty backend.
 *
 * Provides a hierarchy of operational errors that map to HTTP status codes,
 * plus utility helpers (asyncHandler) used throughout controllers.
 *
 * NOTE: Mongoose/MongoDB-specific error handling has been removed as part of
 * the Firestore migration. Firestore errors are handled in errorHandler.js.
 */

// ── Base error ────────────────────────────────────────────────────────────────

class AppError extends Error {
  /**
   * @param {string} message      - Human-readable error message
   * @param {number} statusCode   - HTTP status code
   * @param {string} errorCode    - Machine-readable error code
   * @param {*}      details      - Optional extra details (validation errors, etc.)
   */
  constructor(message, statusCode = 500, errorCode = 'INTERNAL_SERVER_ERROR', details = null) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.details = details;
    this.isOperational = true;
    this.timestamp = new Date().toISOString();
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      error: {
        code: this.errorCode,
        message: this.message,
        ...(this.details !== null && { details: this.details }),
        timestamp: this.timestamp,
      },
    };
  }
}

// ── Derived error classes ─────────────────────────────────────────────────────

class ValidationError extends AppError {
  constructor(message = 'Validation failed', details = null) {
    super(message, 400, 'VALIDATION_ERROR', details);
  }
}

class AuthenticationError extends AppError {
  constructor(message = 'Authentication required') {
    super(message, 401, 'AUTHENTICATION_ERROR');
  }
}

class AuthorizationError extends AppError {
  constructor(message = 'Access denied') {
    super(message, 403, 'AUTHORIZATION_ERROR');
  }
}

class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(`${resource} not found`, 404, 'NOT_FOUND');
  }
}

class ConflictError extends AppError {
  constructor(message = 'Resource already exists') {
    super(message, 409, 'CONFLICT_ERROR');
  }
}

class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(message, 401, 'AUTHENTICATION_ERROR');
  }
}

class PayloadTooLargeError extends AppError {
  constructor(message = 'Payload too large') {
    super(message, 413, 'PAYLOAD_TOO_LARGE');
  }
}

class InternalServerError extends AppError {
  constructor(message = 'Internal server error') {
    super(message, 500, 'INTERNAL_SERVER_ERROR');
    this.isOperational = false;
  }
}

/**
 * 415 Unsupported Media Type – used when an uploaded file has a disallowed
 * MIME type or extension.
 */
class UnsupportedMediaTypeError extends AppError {
  constructor(message = 'Unsupported media type') {
    super(message, 415, 'UNSUPPORTED_MEDIA_TYPE');
  }
}

/**
 * 429 Too Many Requests – used by rate-limiting middleware.
 */
class RateLimitError extends AppError {
  constructor(message = 'Too many requests, please try again later') {
    super(message, 429, 'RATE_LIMIT_EXCEEDED');
  }
}

// ── JWT error handler ─────────────────────────────────────────────────────────

/**
 * Convert a jsonwebtoken error into an AuthenticationError.
 *
 * @param {Error} err
 * @returns {AuthenticationError|null}
 */
const handleJWTError = (err) => {
  if (err.name === 'JsonWebTokenError') {
    return new AuthenticationError('Invalid token');
  }
  if (err.name === 'TokenExpiredError') {
    return new AuthenticationError('Token has expired');
  }
  if (err.name === 'NotBeforeError') {
    return new AuthenticationError('Token not yet valid');
  }
  return null;
};

/**
 * Convert a Firestore / Google Cloud error into an AppError where possible.
 *
 * Firestore errors carry a `code` property (gRPC status code string) and
 * a `details` string.  We map the most common ones to HTTP-friendly errors.
 *
 * @param {Error} err
 * @returns {AppError|null}
 */
const handleFirestoreError = (err) => {
  if (!err || !err.code) return null;

  // gRPC status codes used by the Firestore Admin SDK
  switch (err.code) {
    case 5:   // NOT_FOUND
    case 'NOT_FOUND':
      return new NotFoundError('Firestore document');

    case 6:   // ALREADY_EXISTS
    case 'ALREADY_EXISTS':
      return new ConflictError('Document already exists');

    case 7:   // PERMISSION_DENIED
    case 'PERMISSION_DENIED':
      return new AuthorizationError('Firestore permission denied');

    case 16:  // UNAUTHENTICATED
    case 'UNAUTHENTICATED':
      return new AuthenticationError('Firestore authentication failed');

    case 8:   // RESOURCE_EXHAUSTED (quota)
    case 'RESOURCE_EXHAUSTED':
      return new RateLimitError('Firestore quota exceeded');

    case 4:   // DEADLINE_EXCEEDED
    case 'DEADLINE_EXCEEDED':
      return new InternalServerError('Firestore request timed out');

    case 14:  // UNAVAILABLE
    case 'UNAVAILABLE':
      return new InternalServerError('Firestore service temporarily unavailable');

    default:
      return null;
  }
};

// ── Async handler ─────────────────────────────────────────────────────────────

/**
 * Wrap an async route handler so that any rejected promise is forwarded
 * to Express's next(err) error handler.
 *
 * @param {Function} fn - Async route handler
 * @returns {Function}
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  AppError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ConflictError,
  UnauthorizedError,
  PayloadTooLargeError,
  InternalServerError,
  UnsupportedMediaTypeError,
  RateLimitError,
  handleJWTError,
  handleFirestoreError,
  asyncHandler,
};
