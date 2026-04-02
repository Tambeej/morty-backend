/**
 * Rate Limiting Middleware
 * Stricter rate limit for authentication endpoints to prevent brute-force attacks.
 */

const rateLimit = require('express-rate-limit');

/**
 * Auth-specific rate limiter: 10 requests per 15 minutes per IP.
 */
const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many authentication attempts. Please try again in 15 minutes.',
  },
  skipSuccessfulRequests: false,
});

module.exports = authRateLimiter;
