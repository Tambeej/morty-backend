'use strict';

const { getAuth } = require('../config/firebase');
const userService = require('../services/userService');
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

    // Look up the Firestore user doc by firebaseUid field — the document ID
    // is an auto-generated Firestore ID, not the Firebase UID itself.
    const userData = await userService.findByFirebaseUid(uid);
    if (!userData) {
      throw new UnauthorizedError('User account not found');
    }

    // Attach user to request. id is the Firestore doc ID (used by services);
    // uid is the Firebase UID (used for re-verification).
    req.user = {
      uid,
      id: userData.id,
      email: decodedToken.email || userData.email,
      ...userData,
    };

    logger.debug('User authenticated', { uid, id: userData.id });
    next();
  } catch (error) {
    next(error);
  }
}

module.exports = { protect };
