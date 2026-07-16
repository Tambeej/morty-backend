'use strict';

const axios = require('axios');
const db = require('../config/firestore');
const logger = require('../utils/logger');

const BASE_URL = process.env.MORNING_BASE_URL || 'https://api.greeninvoice.co.il/api/v1';
const PAYMENTS_COLLECTION = 'payments';

/**
 * Step 1: Secure a rolling OAuth2 Access Token from Morning (Valid for 1 Hour)
 */
async function getAccessToken() {
  try {
    const isSandbox = process.env.MORNING_BASE_URL?.includes('sandbox');
    const tokenUrl = isSandbox
        ? 'https://api.sandbox.morning.dev/idp/v1/oauth/token'
        : 'https://api.morning.co/idp/v1/oauth/token';

    const response = await axios.post(tokenUrl, {
      client_id: process.env.MORNING_CLIENT_ID?.trim(),
      client_secret: process.env.MORNING_CLIENT_SECRET?.trim(),
      grant_type: 'client_credentials'
    });

    return response.data.accessToken;
  } catch (err) {
    //️ Log the exact error object coming back from Morning's auth gateway
    logger.error(`Morning Auth Token Generation Failed: ${err.response?.data?.error_description || err.response?.data?.message || err.message}`);
    throw new Error('Payment service authentication failed.');
  }
}

/**
 * Step 2: Generate Morning Hosted Checkout Page Link
 */
async function createCheckoutSession({ userId, userEmail, portfolioId = null, successUrl }) {
  const token = await getAccessToken();

  try {
    // Build Morning-compliant payment payload structure
    const paymentFormPayload = {
      amount: 50, // Price in ILS
      currency: 'ILS',
      maxPayments: 1, // Single payment layout
      language: 'he', // Renders the UI natively in Hebrew
      successUrl: successUrl,
      failureUrl: successUrl, // Redirect back to manage flow if rejected
      notifyUrl: `${process.env.BACKEND_API_URL}/api/v1/stripe/webhook`, // Pointing to your webhook route

      // Custom metadata map attached to the checkout request tracking context
      custom: JSON.stringify({ userId, portfolioId }),

      // Pre-fills customer identity inside Morning's billing form
      client: {
        email: userEmail,
        emails: [userEmail]
      }
    };

    const response = await axios.post(`${BASE_URL}/payments/form`, paymentFormPayload, {
      headers: { Authorization: `Bearer ${token}` }
    });

    // Morning returns a session token parameter and a direct structural checkout path
    const { id, url } = response.data;

    // Persist your internal system audit log in Firestore.
    // consumed:false marks this payment as an unused upload voucher —
    // it flips to true exactly once, when an upload is accepted.
    await db.collection(PAYMENTS_COLLECTION).doc(id).set({
      userId,
      sessionId: id,
      portfolioId: portfolioId || null,
      product: 'expert_analysis',
      status: 'pending',
      consumed: false,
      createdAt: new Date().toISOString()
    });

    return { sessionId: id, url: url };
  } catch (err) {
    logger.error(`Morning Checkout Form Generation Failed: ${err.response?.data?.errorMessage || err.message}`);
    throw err;
  }
}

/**
 * Checks if the user has a valid active payment
 */
async function hasUserPaid(userId) {
  /*try {
    // 1. Look up the user's latest payment record in your Firestore
    const paymentsSnapshot = await db.collection(PAYMENTS_COLLECTION)
      .where('userId', '==', userId)
      .where('status', '==', 'completed')
      .limit(1)
      .get();

    if (!paymentsSnapshot.empty) {
      return true;
    }

    // 2. Fallback / Deep Sync: Check pending transactions directly against Morning's API
    const pendingSnapshot = await db.collection(PAYMENTS_COLLECTION)
      .where('userId', '==', userId)
      .where('status', '==', 'pending')
      .get();

    if (pendingSnapshot.empty) return false;

    const token = await getAccessToken();

    // Verify the state of the payment form directly via Morning's system
    for (const doc of pendingSnapshot.docs) {
      const paymentData = doc.data();

      // Morning endpoint to fetch details of a specific payment form setup
      const response = await axios.get(`${BASE_URL}/payments/form/${paymentData.sessionId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      // If Morning confirms it was filled out successfully and a document was generated
      if (response.data.isCompleted || response.data.documentId) {
        // Update your internal database status so next time it ends at step 1
        await doc.ref.update({ status: 'completed', completedAt: new Date().toISOString() });
        return true;
      }
    }

    return false;
  } catch (err) {
    logger.error(`Error verifying Morning payment status for user ${userId}: ${err.message}`);
    return false;
  }*/
  logger.info(`🕵️‍♂️ Mocking hasUserPaid check for user: ${userId} -> Returning TRUE`);
  // FORCE TRUE: Instantly passes the frontend payment guard wall
  return true;
}

/**
 * Retrieves the historical payment ledger for a user profile
 */
async function getPaymentHistory(userId) {
  /*try {
    const snapshot = await db.collection(PAYMENTS_COLLECTION)
      .where('userId', '==', userId)
      .orderBy('createdAt', 'desc')
      .get();

    if (snapshot.empty) return [];

    return snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
  } catch (err) {
    logger.error(`Error fetching payment history for user ${userId}: ${err.message}`);
    return [];
  }*/
  logger.info(`🕵️‍♂️ Mocking getPaymentHistory for user: ${userId}`);
  // Return a dummy array matching the data structure your UI map functions expect
  return [
    {
      id: "mock_payment_123",
      amount: 149,
      currency: "ILS",
      status: "completed",
      createdAt: new Date().toISOString(),
      product: "expert_analysis"
    }
  ];
}


/**
 * Atomically consume a payment session for one upload (pay-per-upload).
 *
 * Called by the upload controller right before the upload is accepted, so a
 * failure earlier in the flow (bad file, storage error) never burns the
 * user's payment. The client keeps the sessionId until the upload returns
 * success; a genuine retry reuses the same session — only `consumed: true`
 * blocks reuse. The Firestore transaction prevents double-spend from
 * concurrent/duplicate requests.
 *
 * @param {string} userId           - Authenticated user's Firestore doc ID
 * @param {string} paymentSessionId - Morning checkout session ID (the voucher)
 * @returns {Promise<boolean>} true if the session was valid and is now consumed
 */
async function consumePaymentForUpload(userId, paymentSessionId) {
  // ── Real implementation (disabled while payment flow is mocked) ────────────
  // To restore: delete the MOCK return at the bottom and uncomment this block.
  /*
  if (!paymentSessionId) return false;

  const paymentRef = db.collection(PAYMENTS_COLLECTION).doc(paymentSessionId);

  try {
    return await db.runTransaction(async (tx) => {
      const snap = await tx.get(paymentRef);
      if (!snap.exists) return false;

      const payment = snap.data();
      if (payment.userId !== userId) return false;   // not their voucher
      if (payment.consumed === true) return false;   // already spent
      if (payment.status !== 'completed') return false; // not paid (webhook/status-verify sets this)

      tx.update(paymentRef, {
        consumed: true,
        consumedAt: new Date().toISOString(),
      });
      return true;
    });
  } catch (err) {
    logger.error(`consumePaymentForUpload failed (session=${paymentSessionId}): ${err.message}`);
    return false;
  }
  */

  // MOCK pay-per-upload: pass only if a (fake) voucher was supplied this time.
  // Lets the frontend exercise the full pay-every-time redirect loop without
  // real Morning charges.
  logger.info(`🕵 Mock consumePaymentForUpload: session=${paymentSessionId}`);
  return Boolean(paymentSessionId);
}

module.exports = {
  createCheckoutSession,
  hasUserPaid,
  getPaymentHistory,
  consumePaymentForUpload
};