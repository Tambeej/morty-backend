'use strict';

const rateLimit = require('express-rate-limit');
const logger = require('../utils/logger');

/**
 * General API rate limiter.
 * 100 requests per minute per IP.
 */
const generalLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests. Please try again later.',
    },
  },
  handler: (req, res, next, options) => {
    logger.warn('Rate limit exceeded', {
      ip: req.ip,
      path: req.path,
    });
    res.status(429).json(options.message);
  },
});

/**
 * Strict rate limiter for paid/expensive endpoints.
 * 5 requests per minute per user (keyed by user ID when available, else IP).
 */
const paidEndpointLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: parseInt(process.env.PAID_RATE_LIMIT_MAX, 10) || 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Use authenticated user ID if available, otherwise fall back to IP
    return req.user ? req.user.uid : req.ip;
  },
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many enhanced report requests. Please wait before trying again.',
    },
  },
  handler: (req, res, next, options) => {
    logger.warn('Paid endpoint rate limit exceeded', {
      uid: req.user ? req.user.uid : null,
      ip: req.ip,
      path: req.path,
    });
    res.status(429).json(options.message);
  },
});

module.exports = { generalLimiter, paidEndpointLimiter };
