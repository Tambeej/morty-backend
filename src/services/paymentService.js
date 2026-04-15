/**
 * Payment Service – Stripe Integration for Expert Analysis Paywall
 *
 * Handles Stripe Checkout Session creation and webhook event processing.
 * When a user pays for expert analysis, this service:
 *   1. Creates a Stripe Checkout Session with the analysis product/price
 *   2. Processes the `checkout.session.completed` webhook event
 *   3. Sets `paidAnalyses: true` on the user's Firestore document
 *
 * SCA-compliant via Stripe Checkout (hosted payment page).
 *
 * Environment variables required:
 *   - STRIPE_SECRET_KEY:     Stripe API secret key
 *   - STRIPE_WEBHOOK_SECRET: Stripe webhook endpoint signing secret
 *   - STRIPE_PRICE_ID:       Stripe Price ID for the analysis product
 *
 * @module paymentService
 */

'use strict';

const Stripe = require('stripe');
const db = require('../config/firestore');
const logger = require('../utils/logger');

// ── Stripe Client Initialisation ──────────────────────────────────────────────

let stripe;
if (process.env.STRIPE_SECRET_KEY) {
  stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: '2024-06-20',
    appInfo: {
      name: 'Morty',
      version: '1.0.0',
    },
  });
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** Default analysis price in ILS (agorot) – ₪149 */
const DEFAULT_PRICE_AMOUNT = 14900;

/** Currency for payments */
const CURRENCY = 'ils';

/** Firestore collection for payment records */
const PAYMENTS_COLLECTION = 'payments';

/** Firestore collection for users */
const USERS_COLLECTION = 'users';

// ── Checkout Session Creation ─────────────────────────────────────────────────

/**
 * Create a Stripe Checkout Session for the expert analysis product.
 *
 * The session is configured for a one-time payment using Stripe's
 * hosted payment page (SCA-compliant). Metadata includes the userId
 * and optional portfolioId for post-payment processing.
 *
 * @param {object} params
 * @param {string} params.userId       - Authenticated user's Firestore ID
 * @param {string} params.userEmail    - User's email for Stripe customer
 * @param {string} [params.portfolioId] - Optional portfolio ID to link
 * @param {string} params.successUrl   - URL to redirect after successful payment
 * @param {string} [params.cancelUrl]  - URL to redirect if payment is cancelled
 * @returns {Promise<{ sessionId: string, url: string }>} Checkout session details
 * @throws {Error} If Stripe is not configured or session creation fails
 */
async function createCheckoutSession({
  userId,
  userEmail,
  portfolioId = null,
  successUrl,
  cancelUrl = null,
}) {
  if (!stripe) {
    const err = new Error('Stripe is not configured. Set STRIPE_SECRET_KEY environment variable.');
    err.statusCode = 503;
    err.errorCode = 'STRIPE_NOT_CONFIGURED';
    throw err;
  }

  if (!userId) {
    const err = new Error('userId is required to create a checkout session');
    err.statusCode = 400;
    throw err;
  }

  if (!successUrl) {
    const err = new Error('successUrl is required to create a checkout session');
    err.statusCode = 400;
    throw err;
  }

  // Check if user already has paid access
  const userDoc = await db.collection(USERS_COLLECTION).doc(userId).get();
  if (userDoc.exists && userDoc.data().paidAnalyses === true) {
    const err = new Error('User already has paid access to expert analysis');
    err.statusCode = 409;
    err.errorCode = 'ALREADY_PAID';
    throw err;
  }

  logger.info(`paymentService.createCheckoutSession: creating session for user ${userId}`);

  try {
    // Build line items – use configured Price ID or create ad-hoc price
    const lineItems = buildLineItems();

    // Build session parameters
    const sessionParams = {
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: lineItems,
      success_url: successUrl,
      cancel_url: cancelUrl || successUrl,
      client_reference_id: userId,
      customer_email: userEmail || undefined,
      metadata: {
        userId,
        portfolioId: portfolioId || '',
        product: 'expert_analysis',
      },
      payment_intent_data: {
        metadata: {
          userId,
          portfolioId: portfolioId || '',
          product: 'expert_analysis',
        },
      },
      locale: 'he',
    };

    const session = await stripe.checkout.sessions.create(sessionParams);

    logger.info(`paymentService.createCheckoutSession: session ${session.id} created for user ${userId}`);

    // Store a pending payment record in Firestore
    await storePendingPayment(userId, session.id, portfolioId);

    return {
      sessionId: session.id,
      url: session.url,
    };
  } catch (err) {
    // Re-throw known errors
    if (err.statusCode) throw err;

    logger.error(`paymentService.createCheckoutSession error: ${err.message}`);
    const wrappedErr = new Error('Failed to create payment session. Please try again.');
    wrappedErr.statusCode = 500;
    wrappedErr.errorCode = 'CHECKOUT_SESSION_FAILED';
    throw wrappedErr;
  }
}

/**
 * Build Stripe line items for the checkout session.
 *
 * Uses STRIPE_PRICE_ID if configured (recommended for production),
 * otherwise creates an ad-hoc price_data object.
 *
 * @returns {Array<object>} Stripe line items array
 */
function buildLineItems() {
  const priceId = process.env.STRIPE_PRICE_ID;

  if (priceId) {
    // Use pre-configured Stripe Price
    return [
      {
        price: priceId,
        quantity: 1,
      },
    ];
  }

  // Ad-hoc price (for development / when no Price ID is configured)
  return [
    {
      price_data: {
        currency: CURRENCY,
        unit_amount: DEFAULT_PRICE_AMOUNT,
        product_data: {
          name: 'ניתוח משכנתא מקצועי – Morty',
          description:
            'ניתוח OCR מקצועי, טריקים למשכנתא, סקריפט משא ומתן בעברית, ותובנות אסטרטגיות',
        },
      },
      quantity: 1,
    },
  ];
}

// ── Webhook Processing ────────────────────────────────────────────────────────

/**
 * Verify and construct a Stripe webhook event from the raw request body.
 *
 * Uses the Stripe webhook signing secret to verify the event signature,
 * preventing replay attacks and ensuring the event originated from Stripe.
 *
 * @param {Buffer|string} rawBody  - Raw request body (must NOT be parsed as JSON)
 * @param {string}        signature - Stripe-Signature header value
 * @returns {object} Verified Stripe event object
 * @throws {Error} If signature verification fails
 */
function constructWebhookEvent(rawBody, signature) {
  if (!stripe) {
    const err = new Error('Stripe is not configured');
    err.statusCode = 503;
    throw err;
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    const err = new Error('STRIPE_WEBHOOK_SECRET is not configured');
    err.statusCode = 503;
    throw err;
  }

  try {
    return stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    logger.warn(`paymentService.constructWebhookEvent: signature verification failed: ${err.message}`);
    const verifyErr = new Error('Webhook signature verification failed');
    verifyErr.statusCode = 400;
    verifyErr.errorCode = 'WEBHOOK_SIGNATURE_INVALID';
    throw verifyErr;
  }
}

/**
 * Handle a verified Stripe webhook event.
 *
 * Currently handles:
 *   - `checkout.session.completed`: Unlocks paid analysis for the user
 *   - `checkout.session.expired`: Marks the payment record as expired
 *
 * Unknown event types are logged and acknowledged (200) to prevent
 * Stripe from retrying them.
 *
 * @param {object} event - Verified Stripe event object
 * @returns {Promise<{ handled: boolean, type: string, message: string }>}
 */
async function handleWebhookEvent(event) {
  const eventType = event.type;

  logger.info(`paymentService.handleWebhookEvent: processing ${eventType} (${event.id})`);

  switch (eventType) {
    case 'checkout.session.completed':
      return handleCheckoutCompleted(event.data.object);

    case 'checkout.session.expired':
      return handleCheckoutExpired(event.data.object);

    default:
      logger.info(`paymentService.handleWebhookEvent: unhandled event type ${eventType}`);
      return {
        handled: false,
        type: eventType,
        message: `Event type ${eventType} not handled`,
      };
  }
}

/**
 * Handle a completed checkout session.
 *
 * Sets `paidAnalyses: true` on the user's Firestore document and
 * updates the payment record to 'completed' status.
 *
 * @param {object} session - Stripe Checkout Session object
 * @returns {Promise<{ handled: boolean, type: string, message: string }>}
 */
async function handleCheckoutCompleted(session) {
  const userId = session.metadata?.userId || session.client_reference_id;
  const portfolioId = session.metadata?.portfolioId || null;
  const sessionId = session.id;
  const paymentIntentId = session.payment_intent;
  const amountTotal = session.amount_total;
  const currency = session.currency;
  const customerEmail = session.customer_details?.email || session.customer_email;

  if (!userId) {
    logger.error(`paymentService.handleCheckoutCompleted: no userId in session ${sessionId}`);
    return {
      handled: false,
      type: 'checkout.session.completed',
      message: 'Missing userId in session metadata',
    };
  }

  logger.info(
    `paymentService.handleCheckoutCompleted: unlocking paid access for user ${userId} ` +
    `(session: ${sessionId}, amount: ${amountTotal} ${currency})`
  );

  try {
    // 1. Set paidAnalyses flag on user document
    const userRef = db.collection(USERS_COLLECTION).doc(userId);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      logger.error(`paymentService.handleCheckoutCompleted: user ${userId} not found in Firestore`);
      return {
        handled: false,
        type: 'checkout.session.completed',
        message: `User ${userId} not found`,
      };
    }

    await userRef.update({
      paidAnalyses: true,
      paidAt: new Date().toISOString(),
      stripeSessionId: sessionId,
      stripePaymentIntentId: paymentIntentId || null,
      updatedAt: new Date().toISOString(),
    });

    logger.info(`paymentService.handleCheckoutCompleted: paidAnalyses set to true for user ${userId}`);

    // 2. Update payment record
    await updatePaymentRecord(sessionId, {
      status: 'completed',
      paymentIntentId: paymentIntentId || null,
      amountTotal,
      currency,
      customerEmail: customerEmail || null,
      completedAt: new Date().toISOString(),
    });

    return {
      handled: true,
      type: 'checkout.session.completed',
      message: `Paid access unlocked for user ${userId}`,
    };
  } catch (err) {
    logger.error(
      `paymentService.handleCheckoutCompleted error for user ${userId}: ${err.message}`
    );
    // Re-throw so the webhook endpoint returns 500 and Stripe retries
    throw err;
  }
}

/**
 * Handle an expired checkout session.
 *
 * Updates the payment record to 'expired' status.
 *
 * @param {object} session - Stripe Checkout Session object
 * @returns {Promise<{ handled: boolean, type: string, message: string }>}
 */
async function handleCheckoutExpired(session) {
  const sessionId = session.id;
  const userId = session.metadata?.userId || session.client_reference_id;

  logger.info(`paymentService.handleCheckoutExpired: session ${sessionId} expired for user ${userId || 'unknown'}`);

  try {
    await updatePaymentRecord(sessionId, {
      status: 'expired',
      expiredAt: new Date().toISOString(),
    });

    return {
      handled: true,
      type: 'checkout.session.expired',
      message: `Session ${sessionId} marked as expired`,
    };
  } catch (err) {
    logger.warn(`paymentService.handleCheckoutExpired error: ${err.message}`);
    // Non-fatal – acknowledge the event
    return {
      handled: true,
      type: 'checkout.session.expired',
      message: `Session ${sessionId} expired (record update failed)`,
    };
  }
}

// ── Payment Record Helpers ────────────────────────────────────────────────────

/**
 * Store a pending payment record in Firestore.
 *
 * This creates an audit trail for all checkout attempts.
 *
 * @param {string} userId      - User's Firestore ID
 * @param {string} sessionId   - Stripe Checkout Session ID
 * @param {string|null} portfolioId - Optional portfolio ID
 * @returns {Promise<void>}
 */
async function storePendingPayment(userId, sessionId, portfolioId) {
  try {
    const now = new Date().toISOString();
    await db.collection(PAYMENTS_COLLECTION).doc(sessionId).set({
      userId,
      sessionId,
      portfolioId: portfolioId || null,
      product: 'expert_analysis',
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    });
    logger.debug(`paymentService.storePendingPayment: stored pending payment ${sessionId}`);
  } catch (err) {
    // Non-fatal – the payment can still proceed without the record
    logger.warn(`paymentService.storePendingPayment error: ${err.message}`);
  }
}

/**
 * Update a payment record in Firestore.
 *
 * @param {string} sessionId - Stripe Checkout Session ID (document ID)
 * @param {object} updates   - Fields to update
 * @returns {Promise<void>}
 */
async function updatePaymentRecord(sessionId, updates) {
  try {
    const docRef = db.collection(PAYMENTS_COLLECTION).doc(sessionId);
    const doc = await docRef.get();

    if (doc.exists) {
      await docRef.update({
        ...updates,
        updatedAt: new Date().toISOString(),
      });
    } else {
      // Create the record if it doesn't exist (e.g., webhook arrived before storePendingPayment)
      await docRef.set({
        sessionId,
        ...updates,
        updatedAt: new Date().toISOString(),
      });
    }
  } catch (err) {
    logger.warn(`paymentService.updatePaymentRecord error (${sessionId}): ${err.message}`);
  }
}

// ── Query Helpers ─────────────────────────────────────────────────────────────

/**
 * Check if a user has paid for expert analysis.
 *
 * Reads directly from Firestore to get the latest status.
 *
 * @param {string} userId - User's Firestore ID
 * @returns {Promise<boolean>} True if user has paid access
 */
async function hasUserPaid(userId) {
  if (!userId) return false;

  try {
    const userDoc = await db.collection(USERS_COLLECTION).doc(userId).get();
    if (!userDoc.exists) return false;
    return userDoc.data().paidAnalyses === true;
  } catch (err) {
    logger.error(`paymentService.hasUserPaid error (userId=${userId}): ${err.message}`);
    return false;
  }
}

/**
 * Get payment history for a user.
 *
 * @param {string} userId - User's Firestore ID
 * @returns {Promise<Array<object>>} Payment records sorted by createdAt desc
 */
async function getPaymentHistory(userId) {
  if (!userId) return [];

  try {
    const snap = await db
      .collection(PAYMENTS_COLLECTION)
      .where('userId', '==', userId)
      .orderBy('createdAt', 'desc')
      .limit(20)
      .get();

    return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  } catch (err) {
    logger.error(`paymentService.getPaymentHistory error (userId=${userId}): ${err.message}`);
    return [];
  }
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  // Checkout
  createCheckoutSession,
  buildLineItems,

  // Webhook
  constructWebhookEvent,
  handleWebhookEvent,
  handleCheckoutCompleted,
  handleCheckoutExpired,

  // Queries
  hasUserPaid,
  getPaymentHistory,

  // Internal helpers (exported for testing)
  storePendingPayment,
  updatePaymentRecord,

  // Constants
  DEFAULT_PRICE_AMOUNT,
  CURRENCY,
  PAYMENTS_COLLECTION,
  USERS_COLLECTION,
};
