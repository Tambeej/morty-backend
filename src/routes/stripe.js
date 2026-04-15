/**
 * Stripe Payment Routes
 *
 * POST /api/v1/stripe/checkout  – Create a Stripe Checkout Session (auth required)
 * POST /api/v1/stripe/webhook   – Handle Stripe webhook events (Stripe signature)
 * GET  /api/v1/stripe/status    – Check payment status (auth required)
 *
 * IMPORTANT: The webhook endpoint uses express.raw() for the request body
 * (not express.json()) because Stripe signature verification requires the
 * raw body bytes. This is configured in index.js where the route is mounted.
 *
 * @module routes/stripe
 */

'use strict';

const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');
const { protect } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { checkoutSchema } = require('../validators/paymentValidator');
const rateLimit = require('express-rate-limit');

/**
 * Rate limiter for checkout endpoint.
 * 10 requests per 15 minutes per user – prevents abuse.
 */
const checkoutLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || req.ip,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many checkout attempts. Please wait and try again.',
      timestamp: new Date().toISOString(),
    },
  },
});

/**
 * @route  POST /api/v1/stripe/checkout
 * @desc   Create a Stripe Checkout Session for expert analysis
 * @access Private (requires authentication)
 * @body   { portfolioId?: string, successUrl: string, cancelUrl?: string }
 * @returns { sessionId: string, url: string }
 */
router.post(
  '/checkout',
  protect,
  checkoutLimiter,
  validate(checkoutSchema),
  paymentController.createCheckout
);

/**
 * @route  POST /api/v1/stripe/webhook
 * @desc   Handle Stripe webhook events (signature verified)
 * @access Stripe (verified via Stripe-Signature header)
 * @note   This endpoint receives raw body (not JSON-parsed).
 *         The raw body middleware is configured in index.js.
 */
router.post(
  '/webhook',
  paymentController.handleWebhook
);

/**
 * @route  GET /api/v1/stripe/status
 * @desc   Check the current user's payment status
 * @access Private (requires authentication)
 * @returns { hasPaid: boolean, payments: Array }
 */
router.get(
  '/status',
  protect,
  paymentController.getPaymentStatus
);

module.exports = router;
