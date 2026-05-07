'use strict';

const { getDb } = require('../config/db');
const COLLECTIONS = require('../config/collections');
const { NotFoundError, ForbiddenError } = require('../utils/errors');
const logger = require('../utils/logger');

/**
 * Find an offer by its ID and verify it belongs to the given user.
 *
 * @param {string} offerId - Firestore document ID of the offer.
 * @param {string} userId - UID of the authenticated user.
 * @returns {Promise<{id: string, ...offerData}>} The offer document data.
 * @throws {NotFoundError} If the offer does not exist.
 * @throws {ForbiddenError} If the offer belongs to a different user.
 */
async function findByIdAndUserId(offerId, userId) {
  const db = getDb();
  const offerRef = db.collection(COLLECTIONS.OFFERS).doc(offerId);
  const offerDoc = await offerRef.get();

  if (!offerDoc.exists) {
    logger.warn('Offer not found', { offerId, userId });
    throw new NotFoundError(`Offer with ID '${offerId}' not found`);
  }

  const offerData = offerDoc.data();

  // Ownership check
  if (offerData.userId !== userId) {
    logger.warn('Offer ownership mismatch', {
      offerId,
      requestingUser: userId,
      ownerUser: offerData.userId,
    });
    throw new ForbiddenError('You do not have permission to access this offer');
  }

  return { id: offerId, ...offerData };
}

/**
 * Update the analysis.enhanced field of an offer document.
 *
 * @param {string} offerId - Firestore document ID.
 * @param {object} enhancedReport - The enhanced report data to store.
 * @returns {Promise<void>}
 */
async function updateEnhancedAnalysis(offerId, enhancedReport) {
  const db = getDb();
  await db.collection(COLLECTIONS.OFFERS).doc(offerId).update({
    'analysis.enhanced': enhancedReport,
    updatedAt: new Date().toISOString(),
  });
  logger.info('Enhanced analysis stored', { offerId });
}

module.exports = { findByIdAndUserId, updateEnhancedAnalysis };
