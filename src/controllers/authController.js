/**
 * Authentication controller — Firebase-only auth model.
 *
 * All auth is anchored on Firebase Auth. The client signs in with Firebase
 * (email/password or Google), obtains an ID token via firebaseUser.getIdToken(),
 * and sends it as `Authorization: Bearer <token>` on every request. The
 * `protect` middleware verifies the token via Admin SDK.
 *
 * This controller no longer issues custom JWTs. The endpoints are:
 *   POST /register  – verify Firebase ID token, create Firestore user doc
 *   POST /logout    – no-op (Firebase SDK handles sign-out client-side)
 *   GET  /me        – return the authenticated user's profile
 *   POST /google    – verify Firebase ID token from Google sign-in and
 *                     find-or-create the Firestore user doc
 */

'use strict';

const { admin } = require('../config/firebase');
const userService = require('../services/userService');
const { sendSuccess, sendCreated, sendError } = require('../utils/response');
const logger = require('../utils/logger');

/**
 * POST /api/v1/auth/register
 *
 * Verifies a Firebase ID token (obtained by the client after
 * createUserWithEmailAndPassword or signInWithPopup) and creates the
 * corresponding Firestore user document if it does not yet exist.
 *
 * Body: { idToken: string, phone?: string }
 */
exports.register = async (req, res) => {
  try {
    const { idToken, phone } = req.body;

    let decoded;
    try {
      decoded = await admin.auth().verifyIdToken(idToken);
    } catch (firebaseErr) {
      logger.warn(
        `authController.register: Firebase token verification failed – ${firebaseErr.message}`
      );
      return sendError(
        res,
        'Invalid or expired Firebase ID token. Please sign up again.',
        401,
        'INVALID_FIREBASE_TOKEN'
      );
    }

    const { uid: firebaseUid, email, email_verified: emailVerified, name } = decoded;
    if (!email) {
      return sendError(
        res,
        'Firebase account must have an associated email address.',
        422,
        'MISSING_EMAIL'
      );
    }

    const publicUser = await userService.findOrCreateByFirebaseUser({
      email,
      firebaseUid,
      emailVerified: emailVerified || false,
      displayName: name || '',
      phone: phone || '',
    });

    logger.info(`authController.register: registered ${publicUser.id} (${email})`);
    return sendCreated(res, { user: publicUser }, 'User registered successfully');
  } catch (err) {
    logger.error(`authController.register error: ${err.message}`);
    if (err.statusCode === 409) {
      return sendError(res, err.message, 409, 'CONFLICT_ERROR');
    }
    return sendError(res, 'Registration failed. Please try again.', 500, 'REGISTER_ERROR');
  }
};

/**
 * POST /api/v1/auth/logout
 *
 * No-op. Firebase SDK signs the user out client-side; there is no server
 * session to invalidate.
 */
exports.logout = async (_req, res) => {
  return sendSuccess(res, null, 'Logged out successfully');
};

/**
 * GET /api/v1/auth/me
 *
 * Returns the currently authenticated user's public profile.
 * Requires the `protect` middleware.
 */
exports.me = async (req, res) => {
  try {
    const user = await userService.getUserById(req.user.id);
    if (!user) {
      return sendError(res, 'User not found', 404, 'USER_NOT_FOUND');
    }
    return sendSuccess(res, { user }, 'User profile retrieved');
  } catch (err) {
    logger.error(`authController.me error: ${err.message}`);
    return sendError(res, 'Failed to retrieve user profile.', 500, 'ME_ERROR');
  }
};

/**
 * POST /api/v1/auth/google
 *
 * Verifies a Firebase ID token from Google sign-in on the client and
 * find-or-creates the corresponding Firestore user document.
 *
 * Body: { idToken: string }
 */
exports.googleAuth = async (req, res) => {
  try {
    const { idToken } = req.body;

    let decodedToken;
    try {
      decodedToken = await admin.auth().verifyIdToken(idToken);
    } catch (firebaseErr) {
      logger.warn(
        `authController.googleAuth: Firebase token verification failed – ${firebaseErr.message}`
      );
      return sendError(
        res,
        'Invalid or expired Firebase ID token. Please sign in again.',
        401,
        'INVALID_FIREBASE_TOKEN'
      );
    }

    const { uid: firebaseUid, email, email_verified: emailVerified, name } = decodedToken;
    if (!email) {
      logger.warn(`authController.googleAuth: Firebase token missing email (uid=${firebaseUid})`);
      return sendError(
        res,
        'Google account must have an associated email address.',
        422,
        'MISSING_EMAIL'
      );
    }

    const publicUser = await userService.findOrCreateByFirebaseUser({
      email,
      firebaseUid,
      emailVerified: emailVerified || false,
      displayName: name || '',
    });

    logger.info(
      `authController.googleAuth: Google sign-in successful for user ${publicUser.id} (${email})`
    );
    return sendSuccess(res, { user: publicUser }, 'Google sign-in successful');
  } catch (err) {
    logger.error(`authController.googleAuth error: ${err.message}`);
    if (err.statusCode === 409) {
      return sendError(res, err.message, 409, 'CONFLICT_ERROR');
    }
    return sendError(res, 'Google sign-in failed. Please try again.', 500, 'GOOGLE_AUTH_ERROR');
  }
};
