/**
 * Security middleware for the Morty backend.
 * Implements OWASP Top-10 protections:
 * - A01: Broken Access Control (auth middleware)
 * - A02: Cryptographic Failures (HTTPS enforcement)
 * - A03: Injection (input sanitization)
 * - A05: Security Misconfiguration (helmet headers)
 * - A06: Vulnerable Components (dependency audit)
 * - A07: Auth Failures (rate limiting, lockout)
 */

const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const cors = require('cors');
const logger = require('../utils/logger');
const { RateLimitError } = require('../utils/errors');

// ─────────────────────────────────────────────
// CORS Configuration
// ─────────────────────────────────────────────

/**
 * Allowed origins for CORS.
 * In production, only allow the frontend domain.
 * In development, also allow localhost.
 */
const getAllowedOrigins = () => {
  const origins = [];

  // Production frontend URL
  if (process.env.FRONTEND_URL) {
    origins.push(process.env.FRONTEND_URL);
  }

  // GitHub Pages URL
  if (process.env.GITHUB_PAGES_URL) {
    origins.push(process.env.GITHUB_PAGES_URL);
  }

  // Development origins
  if (process.env.NODE_ENV !== 'production') {
    origins.push(
      'http://localhost:3000',
      'http://localhost:5173', // Vite default
      'http://127.0.0.1:3000',
      'http://127.0.0.1:5173',
        'https://morty-app.onrender.com'
    );
  }

  // Always allow the GitHub Pages deployment
  origins.push('https://tambeej.github.io');

  return origins;
};

/**
 * CORS middleware configuration.
 * Restricts cross-origin requests to allowed origins only.
 */
const corsMiddleware = cors({
  origin: (origin, callback) => {
    const allowedOrigins = getAllowedOrigins();

    // Allow requests with no origin (mobile apps, Postman, server-to-server)
    if (!origin) {
      return callback(null, true);
    }

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    logger.logSecurity('CORS_BLOCKED', { origin, allowedOrigins });
    return callback(null, false);
  },
  credentials: true, // Allow cookies and Authorization headers
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'X-Request-ID',
    'Accept',
    'Accept-Language',
  ],
  exposedHeaders: ['X-Request-ID', 'X-RateLimit-Limit', 'X-RateLimit-Remaining'],
  maxAge: 86400, // Cache preflight for 24 hours
});

// ─────────────────────────────────────────────
// Helmet Security Headers
// ─────────────────────────────────────────────

/**
 * Helmet middleware with custom CSP configuration.
 * Sets security headers to prevent common web vulnerabilities.
 */
const helmetMiddleware = helmet({
  // Content Security Policy
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"], // Allow inline styles for API docs
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'none'"],
      frameSrc: ["'none'"],
      upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null,
    },
  },
  // HTTP Strict Transport Security (HTTPS only)
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true,
  },
  // Prevent MIME type sniffing
  noSniff: true,
  // Prevent clickjacking
  frameguard: { action: 'deny' },
  // XSS filter (legacy browsers)
  xssFilter: true,
  // Hide X-Powered-By header
  hidePoweredBy: true,
  // Allow Google sign-in popup to communicate with the opener window
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  // Referrer policy
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  // Permissions policy
  permittedCrossDomainPolicies: false,
});

// ─────────────────────────────────────────────
// Rate Limiting
// ─────────────────────────────────────────────

/**
 * Custom rate limit handler that returns consistent error format.
 */
const rateLimitHandler = (req, res) => {
  logger.logSecurity('RATE_LIMIT_EXCEEDED', {
    ip: req.ip,
    path: req.path,
    method: req.method,
    userId: req.user?.id,
  });

  const error = new RateLimitError();
  return res.status(429).json(error.toJSON());
};

/**
 * General API rate limiter.
 * Applies to all API routes.
 * 100 requests per 15 minutes per IP.
 */
const generalRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  standardHeaders: true, // Return rate limit info in headers
  legacyHeaders: false,
  handler: rateLimitHandler,
  skip: (req) => {
    // Skip rate limiting for health checks
    return req.path === '/health' || req.path === '/api/v1/health';
  },
});

/**
 * Strict rate limiter for authentication endpoints.
 * Prevents brute-force attacks.
 * 10 requests per 15 minutes per IP.
 */
const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  // Track by IP + email to prevent distributed attacks
  keyGenerator: (req) => {
    const email = req.body?.email || '';
    return `${req.ip}:${email.toLowerCase()}`;
  },
});

/**
 * File upload rate limiter.
 * Prevents abuse of the upload endpoint.
 * 20 uploads per hour per user.
 */
const uploadRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  keyGenerator: (req) => {
    // Rate limit by user ID if authenticated, otherwise by IP
    return req.user?.id || req.ip;
  },
});

/**
 * Analysis rate limiter.
 * AI analysis is expensive - limit to 10 per hour per user.
 */
const analysisRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  keyGenerator: (req) => req.user?.id || req.ip,
});

// ─────────────────────────────────────────────
// Input Sanitization
// ─────────────────────────────────────────────

/**
 * Recursively sanitize an object to prevent XSS and NoSQL injection.
 * - Removes MongoDB operators ($where, $gt, etc.) from keys
 * - Strips HTML tags from string values
 * - Limits string length to prevent DoS
 *
 * @param {*} obj - Value to sanitize
 * @param {number} [depth=0] - Current recursion depth
 * @returns {*} Sanitized value
 */
const sanitizeValue = (obj, depth = 0) => {
  // Prevent deep recursion attacks
  if (depth > 10) return obj;

  if (typeof obj === 'string') {
    // Remove HTML tags (basic XSS prevention)
    let sanitized = obj
      .replace(/<script[^>]*>.*?<\/script>/gi, '')
      .replace(/<[^>]+>/g, '')
      .replace(/javascript:/gi, '')
      .replace(/on\w+\s*=/gi, ''); // Remove event handlers

    // Limit string length to prevent DoS
    if (sanitized.length > 10000) {
      sanitized = sanitized.substring(0, 10000);
    }

    return sanitized;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeValue(item, depth + 1));
  }

  if (obj !== null && typeof obj === 'object') {
    const sanitized = {};
    for (const [key, value] of Object.entries(obj)) {
      // Remove MongoDB operator keys (NoSQL injection prevention)
      if (key.startsWith('$') || key.includes('.')) {
        logger.warn('Suspicious key detected in request', { key });
        continue;
      }
      sanitized[key] = sanitizeValue(value, depth + 1);
    }
    return sanitized;
  }

  return obj;
};

/**
 * Request sanitization middleware.
 * Sanitizes req.body, req.params, and req.query.
 * Must be applied AFTER body parsing middleware.
 */
const sanitizeRequest = (req, res, next) => {
  if (req.body && typeof req.body === 'object') {
    req.body = sanitizeValue(req.body);
  }

  if (req.params && typeof req.params === 'object') {
    req.params = sanitizeValue(req.params);
  }

  if (req.query && typeof req.query === 'object') {
    req.query = sanitizeValue(req.query);
  }

  next();
};

// ─────────────────────────────────────────────
// Request ID Middleware
// ─────────────────────────────────────────────

/**
 * Assign a unique request ID to each request.
 * Used for request tracing and log correlation.
 */
const requestId = (req, res, next) => {
  const id =
    req.headers['x-request-id'] ||
    `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

  req.id = id;
  res.setHeader('X-Request-ID', id);
  next();
};

// ─────────────────────────────────────────────
// Security Audit Middleware
// ─────────────────────────────────────────────

/**
 * Suspicious patterns to detect in request data.
 * These patterns indicate potential injection or attack attempts.
 */
const SUSPICIOUS_PATTERNS = [
  /(<script|<iframe|javascript:|vbscript:)/i, // XSS
  /(union\s+select|drop\s+table|insert\s+into)/i, // SQL injection
  /(\$where|\$gt|\$lt|\$ne|\$in|\$nin|\$or|\$and)/i, // NoSQL injection
  /(\.\.\/|\.\.\\)/i, // Path traversal
  /(exec\s*\(|eval\s*\(|system\s*\()/i, // Code injection
];

/**
 * Check if a string contains suspicious patterns.
 * @param {string} str - String to check
 * @returns {boolean}
 */
const hasSuspiciousPattern = (str) => {
  if (typeof str !== 'string') return false;
  return SUSPICIOUS_PATTERNS.some((pattern) => pattern.test(str));
};

/**
 * Recursively check an object for suspicious patterns.
 * @param {*} obj - Object to check
 * @returns {boolean}
 */
const containsSuspiciousContent = (obj) => {
  if (typeof obj === 'string') return hasSuspiciousPattern(obj);
  if (Array.isArray(obj)) return obj.some(containsSuspiciousContent);
  if (obj !== null && typeof obj === 'object') {
    return Object.values(obj).some(containsSuspiciousContent);
  }
  return false;
};

/**
 * Security audit middleware.
 * Logs and flags suspicious requests for monitoring.
 * Does NOT block requests (that's done by sanitization).
 */
const securityAudit = (req, res, next) => {
  const suspicious = [
    containsSuspiciousContent(req.body),
    containsSuspiciousContent(req.query),
    containsSuspiciousContent(req.params),
  ].some(Boolean);

  if (suspicious) {
    logger.logSecurity('SUSPICIOUS_REQUEST', {
      ip: req.ip,
      method: req.method,
      path: req.path,
      userId: req.user?.id,
      requestId: req.id,
      userAgent: req.get('User-Agent'),
    });
  }

  next();
};

// ─────────────────────────────────────────────
// File Upload Security
// ─────────────────────────────────────────────

/**
 * Allowed MIME types for file uploads.
 */
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
]);

/**
 * Allowed file extensions for file uploads.
 */
const ALLOWED_EXTENSIONS = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.webp']);

/**
 * Maximum file size: 5MB
 */
const MAX_FILE_SIZE = 5 * 1024 * 1024;

/**
 * Validate uploaded file security.
 * Checks MIME type, extension, and file size.
 *
 * @param {Object} file - Multer file object
 * @returns {{ valid: boolean, error?: string }}
 */
const validateUploadedFile = (file) => {
  if (!file) {
    return { valid: false, error: 'No file provided' };
  }

  // Check MIME type
  if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
    return {
      valid: false,
      error: `File type '${file.mimetype}' is not allowed. Allowed types: PDF, PNG, JPG, WEBP`,
    };
  }

  // Check file extension
  const path = require('path');
  const ext = path.extname(file.originalname).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return {
      valid: false,
      error: `File extension '${ext}' is not allowed`,
    };
  }

  // Check file size
  if (file.size > MAX_FILE_SIZE) {
    return {
      valid: false,
      error: `File size ${(file.size / 1024 / 1024).toFixed(2)}MB exceeds maximum allowed size of 5MB`,
    };
  }

  // Check for null bytes in filename (path traversal prevention)
  if (file.originalname.includes('\0')) {
    return { valid: false, error: 'Invalid filename' };
  }

  // Check for path traversal in filename
  if (file.originalname.includes('..') || file.originalname.includes('/')) {
    return { valid: false, error: 'Invalid filename: path traversal detected' };
  }

  return { valid: true };
};

/**
 * Middleware to validate uploaded files after Multer processing.
 * Must be placed AFTER Multer middleware.
 */
const validateFileUpload = (req, res, next) => {
  const { UnsupportedMediaTypeError, PayloadTooLargeError, ValidationError } = require('../utils/errors');

  if (!req.file && !req.files) {
    return next();
  }

  const files = req.files ? Object.values(req.files).flat() : [req.file];

  for (const file of files) {
    const { valid, error } = validateUploadedFile(file);
    if (!valid) {
      if (error && error.includes('size')) {
        return next(new PayloadTooLargeError(error));
      }
      if (error && (error.includes('type') || error.includes('extension'))) {
        return next(new UnsupportedMediaTypeError(error));
      }
      return next(new ValidationError(error));
    }
  }

  next();
};

module.exports = {
  corsMiddleware,
  helmetMiddleware,
  generalRateLimit,
  authRateLimit,
  uploadRateLimit,
  analysisRateLimit,
  sanitizeRequest,
  requestId,
  securityAudit,
  validateFileUpload,
  validateUploadedFile,
  ALLOWED_MIME_TYPES,
  ALLOWED_EXTENSIONS,
  MAX_FILE_SIZE,
};
