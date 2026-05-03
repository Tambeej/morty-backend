/**
 * Paid Access Middleware
 *
 * Checks that the authenticated user has paid for enhanced analysis.
 * Must be used AFTER the `protect` middleware (requires `req.user`).
 *
 * The user's paid status is stored as `paidAnalyses: true` on the
 * `users` Firestore document. This flag is set by the payment webhook
 * (Stripe) when a successful payment is processed.
 *
 * Usage:
 *   router.post('/analysis/enhanced/:offerId', protect, requirePaidAccess, handler);
 *
 * @module middleware/paidAccess
 */

'use strict';

const db = require('../config/firestore');
const logger = require('../utils/logger');

/**
 * requirePaidAccess – Express middleware that verifies the user has
 * paid for enhanced analysis features.
 *
 * On success: calls `next()`.
 * On failure: returns 403 with an appropriate error message.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
const requirePaidAccess = async (req, res, next) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    // Check the user's paid status from Firestore
    // We read directly from Firestore to get the latest status
    // (the req.user object from the auth middleware may be stale)
    const userDoc = await db.collection('users').doc(req.user.id).get();

    if (!userDoc.exists) {
      return res.status(401).json({
        success: false,
        message: 'User not found',
      });
    }

    const userData = userDoc.data();

    if (!userData.paidAnalyses) {
      logger.info(`paidAccess: user ${req.user.id} attempted to access paid feature without payment`);
      return res.status(403).json({
        success: false,
        message: 'This feature requires a paid subscription. Please complete payment to access enhanced analysis.',
        errorCode: 'PAYMENT_REQUIRED',
        paymentUrl: '/paywall',
      });
    }

    // User has paid – proceed
    next();
  } catch (err) {
    logger.error(`paidAccess middleware error: ${err.message}`);
    return res.status(500).json({
      success: false,
      message: 'Failed to verify payment status',
    });
  }
};

module.exports = { requirePaidAccess };
