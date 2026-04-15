/**
 * Rates routes
 *
 * Public endpoints for Bank of Israel mortgage rate data.
 *
 * GET /api/v1/public/rates/latest  – Get latest average mortgage rates (public, cached 1h)
 */

'use strict';

const express = require('express');
const router = express.Router();
const ratesController = require('../controllers/ratesController');
const rateLimit = require('express-rate-limit');

/**
 * Rate limiter for public rates endpoint.
 * 30 requests per 15 minutes per IP – generous for a read-only cached endpoint.
 */
const ratesLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests for rates data. Please try again later.',
    },
  },
});

/**
 * @route  GET /api/v1/public/rates/latest
 * @desc   Get latest Bank of Israel average mortgage rates
 * @access Public (no auth required)
 */
router.get('/latest', ratesLimiter, ratesController.getLatestRates);

module.exports = router;
