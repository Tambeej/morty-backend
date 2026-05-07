'use strict';

const { getAuth } = require('../config/firebase');
const { getDb } = require('../config/db');
const COLLECTIONS = require('../config/collections');
const { UnauthorizedError } = require('../utils/errors');
const logger = require('../utils/logger');

/**
 * `protect` middleware — verifies Firebase ID token from Authorization header
 * and attaches the full user document to `req.user`.
 *
 * Expected header: `Authorization: Bearer <firebase-id-token>`
 */
async function protect(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedError('No authentication token provided');
    }

    const idToken = authHeader.split('Bearer ')[1].trim();
    if (!idToken) {
      throw new UnauthorizedError('Invalid authorization header format');
    }

    // Verify Firebase ID token
    let decodedToken;
    try {
      decodedToken = await getAuth().verifyIdToken(idToken);
    } catch (firebaseError) {
      logger.warn('Firebase token verification failed', {
        error: firebaseError.message,
        code: firebaseError.code,
      });
      throw new UnauthorizedError('Invalid or expired authentication token');
    }

    const uid = decodedToken.uid;

    // Fetch user document from Firestore
    const db = getDb();
    const userDoc = await db.collection(COLLECTIONS.USERS).doc(uid).get();

    if (!userDoc.exists) {
      throw new UnauthorizedError('User account not found');
    }

    const userData = userDoc.data();

    // Attach user to request
    req.user = {
      uid,
      id: uid,
      email: decodedToken.email || userData.email,
      ...userData,
    };

    logger.debug('User authenticated', { uid });
    next();
  } catch (error) {
    next(error);
  }
}

module.exports = { protect };
