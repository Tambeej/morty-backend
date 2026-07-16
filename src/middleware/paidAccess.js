'use strict';

// ── Real implementation (disabled while payment flow is mocked) ──────────────
// To restore: delete the MOCK export at the bottom, uncomment the block below,
// and un-comment the require lines above.
/*
const { AppError, ForbiddenError } = require('../utils/errors');
const logger = require('../utils/logger');

function paidAccess(req, res, next) {
  try {
    if (!req.user) {
      throw new ForbiddenError('Authentication required before paid access check');
    }

    if (!req.user.paidAnalyses) {
      logger.warn('Paid access denied', {
        uid: req.user.uid,
        paidAnalyses: req.user.paidAnalyses,
      });
      throw new AppError(
        'Payment required to analyze mortgage offers. Please complete checkout to continue.',
        402,
        'PAYMENT_REQUIRED'
      );
    }

    next();
  } catch (error) {
    next(error);
  }
}
*/

// MOCK — payment gate is bypassed during development. Always allow through.
function paidAccess(_req, _res, next) {
  return next();
}

module.exports = { paidAccess };
