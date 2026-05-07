'use strict';

const { ForbiddenError } = require('../utils/errors');
const logger = require('../utils/logger');

/**
 * `paidAccess` middleware — ensures the authenticated user has paid for
 * enhanced analysis access.
 *
 * Checks `req.user.paidAnalyses === true`.
 * Must be used AFTER the `protect` middleware.
 *
 * @throws {ForbiddenError} 403 if user has not paid.
 */
function paidAccess(req, res, next) {
  try {
    if (!req.user) {
      // Should not happen if protect runs first, but guard anyway
      throw new ForbiddenError('Authentication required before paid access check');
    }

    if (!req.user.paidAnalyses) {
      logger.warn('Paid access denied', {
        uid: req.user.uid,
        paidAnalyses: req.user.paidAnalyses,
      });
      throw new ForbiddenError(
        'This feature requires a paid subscription. Please unlock the Closer Report to continue.'
      );
    }

    logger.debug('Paid access granted', { uid: req.user.uid });
    next();
  } catch (error) {
    next(error);
  }
}

module.exports = { paidAccess };
