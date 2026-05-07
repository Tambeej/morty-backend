'use strict';

const { getFirestore } = require('./firebase');
const logger = require('../utils/logger');

let db;

/**
 * Get the Firestore database instance (singleton).
 * @returns {FirebaseFirestore.Firestore}
 */
function getDb() {
  if (!db) {
    db = getFirestore();
    logger.info('Firestore connection established');
  }
  return db;
}

module.exports = { getDb };
