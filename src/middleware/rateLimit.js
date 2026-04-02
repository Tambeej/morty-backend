/**
 * Rate Limiting Middleware
 *
 * Provides multiple rate limiters for different route categories:
 * - generalLimiter: applied to all /api/ routes
 * - authLimiter:    stricter limit for auth endpoints (login/register)
 * - uploadLimiter:  limit for file upload endpoints
 */

'use strict';

const rateLimit = require('express-rate-limit');
const logger = require('../utils/logger');

/**
 * Creates a standardised rate-limit response handler.
 * @param {string} message - Human-readable error message
 */
const createHandler = (message) => (req, res) => {
  logger.warn(`Rate limit exceeded: ${req.ip} → ${req.originalUrl}`);
  res.status(429).json({
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message,
    },
  });
};

/**
 * General API rate limiter — 100 requests per 15 minutes per IP.
 */
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  handler: createHandler(
    'Too many requests. Please wait 15 minutes before trying again.'
  ),
});

/**
 * Auth rate limiter — 10 attempts per 15 minutes per IP.
 * Applied specifically to /auth/login and /auth/register.
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: createHandler(
    'Too many authentication attempts. Please wait 15 minutes.'
  ),
});

/**
 * Upload rate limiter — 20 uploads per hour per IP.
 */
const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: createHandler(
    'Upload limit reached. You can upload up to 20 files per hour.'
  ),
});

module.exports = { generalLimiter, authLimiter, uploadLimiter };
