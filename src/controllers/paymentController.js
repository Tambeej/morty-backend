/**
 * Payment Controller
 *
 * Handles HTTP requests for Stripe payment integration:
 *   POST /api/v1/stripe/checkout  – Create a Stripe Checkout Session (auth required)
 *   POST /api/v1/stripe/webhook   – Handle Stripe webhook events (Stripe signature)
 *
 * The checkout endpoint creates a Stripe Checkout Session for the expert
 * analysis product (₪149). After successful payment, the webhook sets
 * `paidAnalyses: true` on the user's Firestore document.
 *
 * @module controllers/paymentController
 */

'use strict';

const paymentService = require('../services/paymentService');
const logger = require('../utils/logger');
const { sendSuccess, sendError } = require('../utils/response');

/**
 * POST /api/v1/stripe/checkout
 *
 * Creates a Stripe Checkout Session for the expert analysis product.
 * Requires authentication (protect middleware).
 *
 * Request body:
 *   {
 *     portfolioId: string (optional),
 *     successUrl: string (required),
 *     cancelUrl: string (optional)
 *   }
 *
 * Response:
 *   {
 *     success: true,
 *     data: {
 *       sessionId: string,
 *       url: string
 *     }
 *   }
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 */
// ── Real implementation (disabled while payment flow is mocked) ──────────────
// To restore: uncomment the block below, delete the MOCK export that follows,
// and tighten checkoutSchema in validators/paymentValidator.js (make
// successUrl required again).
/*
exports.createCheckout = async (req, res) => {
  try {
    const userId = req.user.id;
    const userEmail = req.user.email;
    const { portfolioId, successUrl, cancelUrl } = req.body;

    logger.info(`paymentController.createCheckout: user ${userId} requesting checkout`, {
      portfolioId: portfolioId || 'none',
    });

    const result = await paymentService.createCheckoutSession({
      userId,
      userEmail,
      portfolioId: portfolioId || null,
      successUrl,
      cancelUrl: cancelUrl || undefined,
    });

    return sendSuccess(res, result, 'Checkout session created successfully');
  } catch (err) {
    if (err.statusCode) {
      return sendError(res, err.message, err.statusCode, err.errorCode || 'CHECKOUT_ERROR');
    }
    logger.error(`paymentController.createCheckout error: ${err.message}`);
    return sendError(res, 'Failed to create checkout session', 500, 'CHECKOUT_ERROR');
  }
};
*/

// MOCK — payment gate is bypassed during development.
exports.createCheckout = async (req, res) => {
  const { successUrl } = req.body;
  return sendSuccess(
    res,
    {
      sessionId: 'mock_session_12345',
      url: successUrl || 'http://localhost:3000/payment-success',
    },
    'Checkout session created successfully'
  );
};

/**
 * POST /api/v1/stripe/webhook
 *
 * Handles incoming Stripe webhook events.
 * Verifies the event signature using the Stripe webhook secret.
 *
 * IMPORTANT: This endpoint must receive the raw request body (not parsed
 * as JSON) for signature verification to work. The route is configured
 * with express.raw() middleware instead of express.json().
 *
 * Response: Always returns 200 to acknowledge receipt (even for unhandled
 * event types) to prevent Stripe from retrying.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 */
exports.handleWebhook = async (req, res) => {
  try {
    // Morning's standard webhook payload arrives as pre-parsed JSON,
    // unlike Stripe which strictly required the raw request body buffer.
    const event = req.body;

    logger.info(`Morning payment webhook event received: ${event.type}`);

    // Morning flags a successful transaction processing event via this type string:
    if (event.type === 'payment.success' || event.event === 'document.created') {

      // Extract the custom metadata context map we attached in Phase 2
      const metadata = JSON.parse(event.custom || '{}');
      const { userId, portfolioId } = metadata;

      if (userId) {
        // Pay-per-upload: mark the payment session completed so it becomes a
        // valid upload voucher. Do NOT touch `consumed` here — the record is
        // created with consumed:false at checkout time, and webhook retries
        // must never re-arm a voucher that an upload already spent.
        if (event.paymentFormId) {
          await db.collection('payments').doc(event.paymentFormId).update({
            status: 'completed',
            completedAt: new Date().toISOString()
          });
        }

        logger.info(`Payment session completed (upload voucher ready) for user: ${userId}`);
      }
    }

    // Always acknowledge with a 200 to halt delivery retries from Morning's queues
    return res.status(200).json({ received: true });
  } catch (err) {
    // 🕵️‍♂️ ADD THIS TEMPORARY LINE RIGHT HERE:
    console.error("🕵️‍♂️ DETECTED BUG IN CHKOUT FLOW:", err.response?.data || err);

    if (err.statusCode) {
      return sendError(res, err.message, err.statusCode, err.errorCode || 'CHECKOUT_ERROR');
    }

    return sendError(res, 'Failed to create checkout session', 500, 'CHECKOUT_ERROR');

    //logger.error(`Morning Webhook Processing Exception thrown: ${err.message}`);
    //return res.status(500).json({ success: false, message: 'Internal processing error' });
  }
};

/**
 * GET /api/v1/stripe/status
 *
 * Check the current user's payment status.
 * Requires authentication (protect middleware).
 *
 * Response:
 *   {
 *     success: true,
 *     data: {
 *       hasPaid: boolean,
 *       payments: Array<object>
 *     }
 *   }
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 */

// ── Real implementation (disabled while payment flow is mocked) ──────────────
// To restore: uncomment the block below, delete the MOCK export that follows,
// and re-enable the `protect` middleware on GET /stripe/status in routes/stripe.js.
/*
exports.getPaymentStatus = async (req, res) => {
  try {
    const userId = req.user.id;

    const [hasPaid, payments] = await Promise.all([
      paymentService.hasUserPaid(userId),
      paymentService.getPaymentHistory(userId),
    ]);

    return sendSuccess(res, {
      hasPaid,
      payments,
    }, 'Payment status retrieved');
  } catch (err) {
    logger.error('paymentController.getPaymentStatus error:', err);
    return sendError(
      res,
      'Failed to retrieve payment status',
      500,
      'PAYMENT_STATUS_ERROR'
    );
  }
};
*/

// MOCK — payment gate is bypassed during development.
exports.getPaymentStatus = async (_req, res) => {
  return sendSuccess(res, {
    hasPaid: true,
    payments: [],
  }, 'Payment status retrieved');
};
