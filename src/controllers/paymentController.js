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
    // Handle known error types with appropriate status codes
    if (err.statusCode) {
      return sendError(
        res,
        err.message,
        err.statusCode,
        err.errorCode || 'CHECKOUT_ERROR'
      );
    }

    logger.error(`paymentController.createCheckout error: ${err.message}`);
    return sendError(
      res,
      'Failed to create checkout session',
      500,
      'CHECKOUT_ERROR'
    );
  }
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
  const signature = req.headers['stripe-signature'];

  if (!signature) {
    logger.warn('paymentController.handleWebhook: missing Stripe-Signature header');
    return res.status(400).json({
      success: false,
      message: 'Missing Stripe-Signature header',
    });
  }

  let event;
  try {
    event = paymentService.constructWebhookEvent(req.body, signature);
  } catch (err) {
    logger.warn(`paymentController.handleWebhook: signature verification failed: ${err.message}`);
    return res.status(err.statusCode || 400).json({
      success: false,
      message: err.message || 'Webhook signature verification failed',
    });
  }

  try {
    const result = await paymentService.handleWebhookEvent(event);

    logger.info(`paymentController.handleWebhook: ${event.type} processed`, {
      handled: result.handled,
      message: result.message,
    });

    // Always return 200 to acknowledge receipt
    return res.status(200).json({
      received: true,
      type: event.type,
      handled: result.handled,
    });
  } catch (err) {
    logger.error(`paymentController.handleWebhook: error processing ${event.type}: ${err.message}`);
    // Return 500 so Stripe retries the webhook
    return res.status(500).json({
      success: false,
      message: 'Webhook processing failed',
    });
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
    logger.error(`paymentController.getPaymentStatus error: ${err.message}`);
    return sendError(
      res,
      'Failed to retrieve payment status',
      500,
      'PAYMENT_STATUS_ERROR'
    );
  }
};
