/**
 * Tests for error handling, validation, and security middleware.
 *
 * Tests cover:
 * - Custom error classes (Firestore-compatible)
 * - Validation middleware with Joi schemas
 * - Security middleware (sanitization, file validation)
 * - Global error handler (JWT, Firestore, Multer, body-parser errors)
 * - Authentication middleware
 * - Response helpers
 *
 * NOTE: Mongoose/MongoDB-specific tests have been removed as part of the
 * Firestore migration. handleMongooseError no longer exists.
 */

const request = require('supertest');
const express = require('express');
const {
  AppError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ConflictError,
  UnsupportedMediaTypeError,
  RateLimitError,
  asyncHandler,
  handleFirestoreError,
} = require('../utils/errors');
const { globalErrorHandler, notFoundHandler } = require('../middleware/errorHandler');
const {
  validate,
  registerSchema,
  loginSchema,
  financialSchema,
  financialDataSchema,
} = require('../middleware/validate');
const {
  sanitizeRequest,
  validateUploadedFile,
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE,
} = require('../middleware/security');
const { sendSuccess, sendCreated, sendError, sendPaginated } = require('../utils/response');

// ─────────────────────────────────────────────
// Test App Setup
// ─────────────────────────────────────────────

/**
 * Create a minimal Express app for testing middleware.
 * @param {Function[]} middlewares - Middleware to apply
 * @param {Function} handler - Route handler
 * @returns {express.Application}
 */
const createTestApp = (middlewares = [], handler = null) => {
  const app = express();
  app.use(express.json());
  app.use(sanitizeRequest);

  middlewares.forEach((mw) => app.use(mw));

  if (handler) {
    app.post('/test', handler);
    app.get('/test', handler);
  }

  app.use(notFoundHandler);
  app.use(globalErrorHandler);

  return app;
};

// ─────────────────────────────────────────────
// Error Classes Tests
// ─────────────────────────────────────────────

describe('Error Classes', () => {
  describe('AppError', () => {
    it('should create an error with correct properties', () => {
      const err = new AppError('Test error', 400, 'TEST_ERROR', { field: 'test' });

      expect(err.message).toBe('Test error');
      expect(err.statusCode).toBe(400);
      expect(err.errorCode).toBe('TEST_ERROR');
      expect(err.details).toEqual({ field: 'test' });
      expect(err.isOperational).toBe(true);
      expect(err.timestamp).toBeDefined();
    });

    it('should serialize to JSON correctly', () => {
      const err = new AppError('Test error', 400, 'TEST_ERROR', { field: 'test' });
      const json = err.toJSON();

      expect(json.error.code).toBe('TEST_ERROR');
      expect(json.error.message).toBe('Test error');
      expect(json.error.details).toEqual({ field: 'test' });
      expect(json.error.timestamp).toBeDefined();
    });

    it('should be an instance of Error', () => {
      const err = new AppError('Test');
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(AppError);
    });
  });

  describe('ValidationError', () => {
    it('should have 400 status code', () => {
      const err = new ValidationError('Invalid input');
      expect(err.statusCode).toBe(400);
      expect(err.errorCode).toBe('VALIDATION_ERROR');
    });
  });

  describe('AuthenticationError', () => {
    it('should have 401 status code', () => {
      const err = new AuthenticationError();
      expect(err.statusCode).toBe(401);
      expect(err.errorCode).toBe('AUTHENTICATION_ERROR');
    });

    it('should use default message', () => {
      const err = new AuthenticationError();
      expect(err.message).toBe('Authentication required');
    });
  });

  describe('AuthorizationError', () => {
    it('should have 403 status code', () => {
      const err = new AuthorizationError();
      expect(err.statusCode).toBe(403);
      expect(err.errorCode).toBe('AUTHORIZATION_ERROR');
    });
  });

  describe('NotFoundError', () => {
    it('should have 404 status code', () => {
      const err = new NotFoundError('User');
      expect(err.statusCode).toBe(404);
      expect(err.message).toBe('User not found');
    });
  });

  describe('ConflictError', () => {
    it('should have 409 status code', () => {
      const err = new ConflictError('Email already exists');
      expect(err.statusCode).toBe(409);
    });
  });

  describe('UnsupportedMediaTypeError', () => {
    it('should have 415 status code', () => {
      const err = new UnsupportedMediaTypeError('Only PDF files are allowed');
      expect(err.statusCode).toBe(415);
      expect(err.errorCode).toBe('UNSUPPORTED_MEDIA_TYPE');
    });
  });

  describe('RateLimitError', () => {
    it('should have 429 status code', () => {
      const err = new RateLimitError();
      expect(err.statusCode).toBe(429);
      expect(err.errorCode).toBe('RATE_LIMIT_EXCEEDED');
    });
  });

  describe('asyncHandler', () => {
    it('should catch async errors and pass to next', async () => {
      const app = express();
      app.use(express.json());

      app.get(
        '/test',
        asyncHandler(async () => {
          throw new ValidationError('Async error');
        })
      );

      app.use(globalErrorHandler);

      const res = await request(app).get('/test');
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should pass successful responses through', async () => {
      const app = express();
      app.use(express.json());

      app.get(
        '/test',
        asyncHandler(async (req, res) => {
          res.json({ success: true });
        })
      );

      const res = await request(app).get('/test');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('handleFirestoreError', () => {
    it('should handle NOT_FOUND gRPC code (5)', () => {
      const firestoreErr = { code: 5, message: 'Document not found' };
      const err = handleFirestoreError(firestoreErr);
      expect(err).toBeInstanceOf(NotFoundError);
      expect(err.statusCode).toBe(404);
    });

    it('should handle ALREADY_EXISTS gRPC code (6)', () => {
      const firestoreErr = { code: 6, message: 'Document already exists' };
      const err = handleFirestoreError(firestoreErr);
      expect(err).toBeInstanceOf(ConflictError);
      expect(err.statusCode).toBe(409);
    });

    it('should handle PERMISSION_DENIED gRPC code (7)', () => {
      const firestoreErr = { code: 7, message: 'Permission denied' };
      const err = handleFirestoreError(firestoreErr);
      expect(err).toBeInstanceOf(AuthorizationError);
      expect(err.statusCode).toBe(403);
    });

    it('should handle UNAUTHENTICATED gRPC code (16)', () => {
      const firestoreErr = { code: 16, message: 'Unauthenticated' };
      const err = handleFirestoreError(firestoreErr);
      expect(err).toBeInstanceOf(AuthenticationError);
      expect(err.statusCode).toBe(401);
    });

    it('should return null for unknown errors', () => {
      const err = handleFirestoreError({ message: 'unknown' });
      expect(err).toBeNull();
    });

    it('should return null for null input', () => {
      const err = handleFirestoreError(null);
      expect(err).toBeNull();
    });
  });
});

// ─────────────────────────────────────────────
// Validation Middleware Tests
// ─────────────────────────────────────────────

describe('Validation Middleware', () => {
  describe('registerSchema', () => {
    let app;

    beforeEach(() => {
      app = express();
      app.use(express.json());
      app.post('/test', validate(registerSchema), (req, res) => {
        res.json({ success: true, data: req.body });
      });
      app.use(globalErrorHandler);
    });

    it('should accept valid registration data', async () => {
      const res = await request(app).post('/test').send({
        email: 'test@example.com',
        password: 'Password123',
        phone: '050-1234567',
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should reject invalid email', async () => {
      const res = await request(app).post('/test').send({
        email: 'not-an-email',
        password: 'Password123',
      });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'email' }),
        ])
      );
    });

    it('should reject weak password', async () => {
      const res = await request(app).post('/test').send({
        email: 'test@example.com',
        password: 'weak',
      });

      expect(res.status).toBe(422);
      expect(res.body.error.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'password' }),
        ])
      );
    });

    it('should reject missing required fields', async () => {
      const res = await request(app).post('/test').send({});

      expect(res.status).toBe(422);
      expect(res.body.error.details.length).toBeGreaterThan(0);
    });

    it('should strip unknown fields', async () => {
      const res = await request(app).post('/test').send({
        email: 'test@example.com',
        password: 'Password123',
        unknownField: 'should be removed',
      });

      expect(res.status).toBe(200);
      expect(res.body.data.unknownField).toBeUndefined();
    });

    it('should normalize email to lowercase', async () => {
      const res = await request(app).post('/test').send({
        email: 'TEST@EXAMPLE.COM',
        password: 'Password123',
      });

      expect(res.status).toBe(200);
      expect(res.body.data.email).toBe('test@example.com');
    });
  });

  describe('loginSchema', () => {
    let app;

    beforeEach(() => {
      app = express();
      app.use(express.json());
      app.post('/test', validate(loginSchema), (req, res) => {
        res.json({ success: true });
      });
      app.use(globalErrorHandler);
    });

    it('should accept valid login data', async () => {
      const res = await request(app).post('/test').send({
        email: 'test@example.com',
        password: 'anypassword',
      });

      expect(res.status).toBe(200);
    });

    it('should reject missing password', async () => {
      const res = await request(app).post('/test').send({
        email: 'test@example.com',
      });

      expect(res.status).toBe(422);
    });
  });

  describe('financialDataSchema (alias for financialSchema)', () => {
    let app;

    beforeEach(() => {
      app = express();
      app.use(express.json());
      app.put('/test', validate(financialDataSchema), (req, res) => {
        res.json({ success: true, data: req.body });
      });
      app.use(globalErrorHandler);
    });

    it('should accept valid financial data', async () => {
      const res = await request(app).put('/test').send({
        income: 15000,
        expenses: { housing: 3000, loans: 1000, other: 500 },
        assets: { savings: 50000, investments: 100000 },
        debts: [{ type: 'car loan', amount: 30000 }],
      });

      expect(res.status).toBe(200);
    });

    it('should reject negative income', async () => {
      const res = await request(app).put('/test').send({
        income: -1000,
      });

      expect(res.status).toBe(422);
    });

    it('should apply defaults for missing optional fields', async () => {
      const res = await request(app).put('/test').send({
        income: 10000,
      });

      expect(res.status).toBe(200);
      expect(res.body.data.expenses).toBeDefined();
      expect(res.body.data.debts).toEqual([]);
    });

    it('should reject too many debt entries (max 20)', async () => {
      const debts = Array.from({ length: 21 }, (_, i) => ({
        type: `debt ${i}`,
        amount: 1000,
      }));

      const res = await request(app).put('/test').send({ debts });
      expect(res.status).toBe(422);
    });
  });

  describe('financialSchema (direct reference)', () => {
    it('should be the same schema as financialDataSchema', () => {
      // Both exports should reference the same Joi schema object
      expect(financialSchema).toBe(financialDataSchema);
    });
  });
});

// ─────────────────────────────────────────────
// Security Middleware Tests
// ─────────────────────────────────────────────

describe('Security Middleware', () => {
  describe('sanitizeRequest', () => {
    let app;

    beforeEach(() => {
      app = express();
      app.use(express.json());
      app.use(sanitizeRequest);
      app.post('/test', (req, res) => {
        res.json({ body: req.body });
      });
    });

    it('should remove MongoDB/NoSQL operator keys ($ prefix)', async () => {
      const res = await request(app).post('/test').send({
        email: 'test@example.com',
        $where: 'malicious code',
      });

      expect(res.status).toBe(200);
      expect(res.body.body.$where).toBeUndefined();
      expect(res.body.body.email).toBe('test@example.com');
    });

    it('should strip HTML script tags', async () => {
      const res = await request(app).post('/test').send({
        name: '<script>alert("xss")</script>John',
      });

      expect(res.status).toBe(200);
      expect(res.body.body.name).not.toContain('<script>');
    });

    it('should remove javascript: protocol', async () => {
      const res = await request(app).post('/test').send({
        url: 'javascript:alert(1)',
      });

      expect(res.status).toBe(200);
      expect(res.body.body.url).not.toContain('javascript:');
    });

    it('should handle nested objects', async () => {
      const res = await request(app).post('/test').send({
        user: {
          name: 'John',
          $gt: 'injection',
        },
      });

      expect(res.status).toBe(200);
      expect(res.body.body.user.$gt).toBeUndefined();
      expect(res.body.body.user.name).toBe('John');
    });

    it('should handle arrays', async () => {
      const res = await request(app).post('/test').send({
        items: ['<script>bad</script>', 'good'],
      });

      expect(res.status).toBe(200);
      expect(res.body.body.items[0]).not.toContain('<script>');
      expect(res.body.body.items[1]).toBe('good');
    });
  });

  describe('validateUploadedFile', () => {
    it('should accept valid PDF file', () => {
      const file = {
        mimetype: 'application/pdf',
        originalname: 'offer.pdf',
        size: 1024 * 1024, // 1MB
      };

      const result = validateUploadedFile(file);
      expect(result.valid).toBe(true);
    });

    it('should accept valid PNG file', () => {
      const file = {
        mimetype: 'image/png',
        originalname: 'offer.png',
        size: 500 * 1024, // 500KB
      };

      const result = validateUploadedFile(file);
      expect(result.valid).toBe(true);
    });

    it('should reject files exceeding size limit', () => {
      const file = {
        mimetype: 'application/pdf',
        originalname: 'large.pdf',
        size: MAX_FILE_SIZE + 1,
      };

      const result = validateUploadedFile(file);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('size');
    });

    it('should reject disallowed MIME types', () => {
      const file = {
        mimetype: 'application/javascript',
        originalname: 'malicious.js',
        size: 1024,
      };

      const result = validateUploadedFile(file);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('type');
    });

    it('should reject files with path traversal in name', () => {
      const file = {
        mimetype: 'application/pdf',
        originalname: '../../../etc/passwd.pdf',
        size: 1024,
      };

      const result = validateUploadedFile(file);
      expect(result.valid).toBe(false);
    });

    it('should reject null file', () => {
      const result = validateUploadedFile(null);
      expect(result.valid).toBe(false);
    });

    it('should have correct allowed MIME types', () => {
      expect(ALLOWED_MIME_TYPES.has('application/pdf')).toBe(true);
      expect(ALLOWED_MIME_TYPES.has('image/png')).toBe(true);
      expect(ALLOWED_MIME_TYPES.has('image/jpeg')).toBe(true);
      expect(ALLOWED_MIME_TYPES.has('text/html')).toBe(false);
      expect(ALLOWED_MIME_TYPES.has('application/javascript')).toBe(false);
    });
  });
});

// ─────────────────────────────────────────────
// Global Error Handler Tests
// ─────────────────────────────────────────────

describe('Global Error Handler', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(express.json());
  });

  it('should handle AppError with correct status code', async () => {
    app.get('/test', (req, res, next) => {
      next(new ValidationError('Test validation error', [{ field: 'email', message: 'Invalid' }]));
    });
    app.use(globalErrorHandler);

    const res = await request(app).get('/test');
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toBeDefined();
  });

  it('should handle 404 not found', async () => {
    app.use(notFoundHandler);
    app.use(globalErrorHandler);

    const res = await request(app).get('/nonexistent-route');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('should handle malformed JSON body', async () => {
    app.use(globalErrorHandler);

    const res = await request(app)
      .post('/test')
      .set('Content-Type', 'application/json')
      .send('{ invalid json }');

    expect(res.status).toBe(400);
  });

  it('should handle Firestore NOT_FOUND error (gRPC code 5)', async () => {
    app.get('/test', (req, res, next) => {
      const firestoreErr = { code: 5, message: 'Document not found' };
      next(firestoreErr);
    });
    app.use(globalErrorHandler);

    const res = await request(app).get('/test');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('should handle Firestore ALREADY_EXISTS error (gRPC code 6)', async () => {
    app.get('/test', (req, res, next) => {
      const firestoreErr = { code: 6, message: 'Document already exists' };
      next(firestoreErr);
    });
    app.use(globalErrorHandler);

    const res = await request(app).get('/test');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT_ERROR');
  });

  it('should handle Firestore PERMISSION_DENIED error (gRPC code 7)', async () => {
    app.get('/test', (req, res, next) => {
      const firestoreErr = { code: 7, message: 'Permission denied' };
      next(firestoreErr);
    });
    app.use(globalErrorHandler);

    const res = await request(app).get('/test');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('AUTHORIZATION_ERROR');
  });

  it('should include requestId in error response', async () => {
    app.use((req, res, next) => {
      req.id = 'test-request-id';
      next();
    });
    app.get('/test', (req, res, next) => {
      next(new NotFoundError('User'));
    });
    app.use(globalErrorHandler);

    const res = await request(app).get('/test');
    expect(res.body.error.requestId).toBe('test-request-id');
  });

  it('should return consistent error response structure', async () => {
    app.get('/test', (req, res, next) => {
      next(new AuthenticationError());
    });
    app.use(globalErrorHandler);

    const res = await request(app).get('/test');
    expect(res.body).toHaveProperty('success', false);
    expect(res.body).toHaveProperty('error');
    expect(res.body.error).toHaveProperty('code');
    expect(res.body.error).toHaveProperty('message');
    expect(res.body.error).toHaveProperty('timestamp');
  });

  it('should handle JWT expired error', async () => {
    app.get('/test', (req, res, next) => {
      const jwtErr = new Error('jwt expired');
      jwtErr.name = 'TokenExpiredError';
      next(jwtErr);
    });
    app.use(globalErrorHandler);

    const res = await request(app).get('/test');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTHENTICATION_ERROR');
  });

  it('should handle JWT invalid error', async () => {
    app.get('/test', (req, res, next) => {
      const jwtErr = new Error('invalid signature');
      jwtErr.name = 'JsonWebTokenError';
      next(jwtErr);
    });
    app.use(globalErrorHandler);

    const res = await request(app).get('/test');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTHENTICATION_ERROR');
  });
});

// ─────────────────────────────────────────────
// Response Helpers Tests
// ─────────────────────────────────────────────

describe('Response Helpers', () => {
  let app;

  beforeEach(() => {
    app = express();
  });

  it('sendSuccess should return 200 with data', async () => {
    app.get('/test', (req, res) => {
      sendSuccess(res, { id: 1, name: 'Test' }, 'Retrieved successfully');
    });

    const res = await request(app).get('/test');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Retrieved successfully');
    expect(res.body.data).toEqual({ id: 1, name: 'Test' });
    expect(res.body.timestamp).toBeDefined();
  });

  it('sendCreated should return 201', async () => {
    app.post('/test', (req, res) => {
      sendCreated(res, { id: 1 });
    });

    const res = await request(app).post('/test');
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });

  it('sendPaginated should include pagination metadata', async () => {
    app.get('/test', (req, res) => {
      sendPaginated(res, [1, 2, 3], { page: 1, limit: 10, total: 25 });
    });

    const res = await request(app).get('/test');
    expect(res.status).toBe(200);
    expect(res.body.pagination).toEqual({
      page: 1,
      limit: 10,
      total: 25,
      totalPages: 3,
      hasNextPage: true,
      hasPrevPage: false,
    });
  });

  it('sendError should return error response', async () => {
    app.get('/test', (req, res) => {
      sendError(res, 'Something went wrong', 500, 'SERVER_ERROR');
    });

    const res = await request(app).get('/test');
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('SERVER_ERROR');
  });
});
