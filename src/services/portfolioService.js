'use strict';

const { getDb } = require('../config/db');
const COLLECTIONS = require('../config/collections');
const logger = require('../utils/logger');

/**
 * Retrieve the user's latest mortgage portfolio.
 *
 * Strategy:
 * 1. Check the user document for an embedded `portfolio` field (wizard output).
 * 2. Fall back to the most recently updated document in the `portfolios` collection.
 * 3. Return null if no portfolio exists.
 *
 * @param {string} userId - UID of the authenticated user.
 * @returns {Promise<object|null>} Portfolio data or null.
 */
async function getUserPortfolio(userId) {
  const db = getDb();

  // 1. Check user document for embedded portfolio
  const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
  if (userDoc.exists) {
    const userData = userDoc.data();
    if (userData.portfolio && Object.keys(userData.portfolio).length > 0) {
      logger.debug('Portfolio found in user document', { userId });
      return userData.portfolio;
    }
  }

  // 2. Query portfolios collection for the user's latest portfolio
  const portfoliosSnap = await db
    .collection(COLLECTIONS.PORTFOLIOS)
    .where('userId', '==', userId)
    .orderBy('updatedAt', 'desc')
    .limit(1)
    .get();

  if (!portfoliosSnap.empty) {
    const portfolioDoc = portfoliosSnap.docs[0];
    logger.debug('Portfolio found in portfolios collection', {
      userId,
      portfolioId: portfolioDoc.id,
    });
    return { id: portfolioDoc.id, ...portfolioDoc.data() };
  }

  logger.debug('No portfolio found for user', { userId });
  return null;
}

module.exports = { getUserPortfolio };
