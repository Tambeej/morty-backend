/**
 * Authentication controller
 *
 * Handles register, login, token refresh, logout, current-user retrieval,
 * and Google OAuth via Firebase ID token verification.
 *
 * All database operations are delegated to userService (Firestore-backed).
 * Tokens are generated/verified via the jwt utility module.
 * Responses follow the standard { data, message } envelope via response helpers.
 */

'use strict';

const { admin } = require('../config/firebase');
const userService = require('../services/userService');
const { generateAccessToken, generateRefreshToken, verifyRefreshToken } = require('../utils/jwt');
const { sendSuccess, sendCreated, sendError } = require('../utils/response');
const logger = require('../utils/logger');

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build the public auth response payload.
 *
 * @param {string} token        - JWT access token
 * @param {string} refreshToken - JWT refresh token
 * @param {Object} user         - Public user object (no password/refreshToken)
 * @returns {Object}
 */
function buildAuthPayload(token, refreshToken, user) {
  return {
    token,
    refreshToken,
    user: {
      id: user.id,
      email: user.email,
      phone: user.phone || '',
      verified: user.verified || false,
    },
  };
}

// ── Controllers ───────────────────────────────────────────────────────────────

/**
 * POST /api/v1/auth/register
 *
 * Creates a new user account, issues access + refresh tokens.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 */
exports.register = async (req, res) => {
  try {
    const { email, password, phone } = req.body;

    // createUser throws a 409 error if the email is already registered
    const publicUser = await userService.createUser({ email, password, phone });

    const token = generateAccessToken({ id: publicUser.id });
    const refreshToken = generateRefreshToken({ id: publicUser.id });

    // Persist the refresh token in Firestore
    await userService.setRefreshToken(publicUser.id, refreshToken);

    logger.info(`authController.register: new user registered (${email})`);

    return sendCreated(
      res,
      buildAuthPayload(token, refreshToken, publicUser),
      'User registered successfully'
    );
  } catch (err) {
    logger.error(`authController.register error: ${err.message}`);

    if (err.statusCode === 409) {
      return sendError(res, err.message, 409, 'CONFLICT_ERROR');
    }

    return sendError(res, 'Registration failed. Please try again.', 500, 'REGISTER_ERROR');
  }
};

/**
 * POST /api/v1/auth/login
 *
 * Authenticates a user with email + password, issues access + refresh tokens.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 */
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Fetch the full user document (includes hashed password)
    const user = await userService.findByEmail(email);
    if (!user) {
      return sendError(res, 'Invalid credentials', 401, 'INVALID_CREDENTIALS');
    }

    // If the user has no password (Google-only account), reject email/pass login
    if (!user.password) {
      return sendError(
        res,
        'This account uses Google sign-in. Please sign in with Google.',
        401,
        'GOOGLE_ACCOUNT'
      );
    }

    const passwordMatch = await userService.verifyPassword(password, user.password);
    if (!passwordMatch) {
      return sendError(res, 'Invalid credentials', 401, 'INVALID_CREDENTIALS');
    }

    const token = generateAccessToken({ id: user.id });
    const refreshToken = generateRefreshToken({ id: user.id });

    // Persist the new refresh token in Firestore
    await userService.setRefreshToken(user.id, refreshToken);

    logger.info(`authController.login: user logged in (${email})`);

    const publicUser = userService.toPublicUser(user);

    return sendSuccess(
      res,
      buildAuthPayload(token, refreshToken, publicUser),
      'Login successful'
    );
  } catch (err) {
    logger.error(`authController.login error: ${err.message}`);
    return sendError(res, 'Login failed. Please try again.', 500, 'LOGIN_ERROR');
  }
};

/**
 * POST /api/v1/auth/refresh
 *
 * Rotates the refresh token and issues a new access token.
 * Implements refresh-token rotation: the old refresh token is invalidated
 * and a new one is stored.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 */
exports.refresh = async (req, res) => {
  try {
    const { refreshToken } = req.body;

    // Verify the token signature and expiry
    let decoded;
    try {
      decoded = verifyRefreshToken(refreshToken);
    } catch {
      return sendError(res, 'Invalid or expired refresh token', 401, 'INVALID_REFRESH_TOKEN');
    }

    // Fetch the user and validate the stored token matches
    const user = await userService.findById(decoded.id);
    if (!user || user.refreshToken !== refreshToken) {
      return sendError(res, 'Refresh token mismatch or user not found', 401, 'REFRESH_TOKEN_MISMATCH');
    }

    // Rotate tokens
    const newToken = generateAccessToken({ id: user.id });
    const newRefreshToken = generateRefreshToken({ id: user.id });

    await userService.setRefreshToken(user.id, newRefreshToken);

    logger.info(`authController.refresh: tokens rotated for user ${user.id}`);

    return sendSuccess(
      res,
      { token: newToken, refreshToken: newRefreshToken },
      'Token refreshed successfully'
    );
  } catch (err) {
    logger.error(`authController.refresh error: ${err.message}`);
    return sendError(res, 'Token refresh failed. Please log in again.', 500, 'REFRESH_ERROR');
  }
};

/**
 * POST /api/v1/auth/logout
 *
 * Invalidates the refresh token stored in Firestore.
 * Accepts an optional `refreshToken` in the request body; if omitted,
 * falls back to clearing the token for the authenticated user (req.user).
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 */
exports.logout = async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (refreshToken) {
      // Clear by token value (no auth required for logout)
      await userService.clearRefreshTokenByValue(refreshToken);
    } else if (req.user && req.user.id) {
      // Fallback: clear by userId if the request is authenticated
      await userService.clearRefreshToken(req.user.id);
    }
    // If neither is available, the token will expire naturally

    logger.info('authController.logout: user logged out');

    return sendSuccess(res, null, 'Logged out successfully');
  } catch (err) {
    logger.error(`authController.logout error: ${err.message}`);
    return sendError(res, 'Logout failed. Please try again.', 500, 'LOGOUT_ERROR');
  }
};

/**
 * GET /api/v1/auth/me
 *
 * Returns the currently authenticated user's public profile.
 * Requires the `protect` middleware to be applied on the route.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 */
exports.me = async (req, res) => {
  try {
    // req.user is attached by the protect middleware
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
 * Verifies a Firebase ID token obtained from Google sign-in on the client.
 * On success, finds or creates the corresponding Firestore user document
 * and issues custom access + refresh JWT tokens compatible with the
 * existing auth flow.
 *
 * Request body:
 *   { idToken: string }  – Firebase ID token from firebaseUser.getIdToken()
 *
 * Response (200):
 *   { data: { token, refreshToken, user: { id, email, phone, verified } } }
 *
 * Error codes:
 *   401 INVALID_FIREBASE_TOKEN  – token verification failed (expired, invalid, etc.)
 *   500 GOOGLE_AUTH_ERROR       – unexpected server-side failure
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 */
exports.googleAuth = async (req, res) => {
  try {
    const { idToken } = req.body;

    // ── Step 1: Verify the Firebase ID token via Admin SDK ────────────────────
    // verifyIdToken checks the token signature, audience (project ID),
    // issuer, and expiry. It rejects replayed or tampered tokens.
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

    // ── Step 2: Extract verified claims ──────────────────────────────────────
    const { uid: firebaseUid, email, email_verified: emailVerified, name } = decodedToken;

    if (!email) {
      // Google accounts always have an email, but guard defensively
      logger.warn(`authController.googleAuth: Firebase token missing email (uid=${firebaseUid})`);
      return sendError(
        res,
        'Google account must have an associated email address.',
        422,
        'MISSING_EMAIL'
      );
    }

    // ── Step 3: Find or create the Firestore user ─────────────────────────────
    // Delegate to userService (implemented in a subsequent task).
    // For this task we only wire up the token verification layer;
    // the service call is included so the route is fully functional
    // once userService.findOrCreateByFirebaseUser is available.
    const publicUser = await userService.findOrCreateByFirebaseUser({
      email,
      firebaseUid,
      emailVerified: emailVerified || false,
      displayName: name || '',
    });

    // ── Step 4: Issue custom JWTs ─────────────────────────────────────────────
    const token = generateAccessToken({ id: publicUser.id });
    const refreshToken = generateRefreshToken({ id: publicUser.id });

    // ── Step 5: Persist refresh token ────────────────────────────────────────
    await userService.setRefreshToken(publicUser.id, refreshToken);

    logger.info(
      `authController.googleAuth: Google sign-in successful for user ${publicUser.id} (${email})`
    );

    return sendSuccess(
      res,
      buildAuthPayload(token, refreshToken, publicUser),
      'Google sign-in successful'
    );
  } catch (err) {
    logger.error(`authController.googleAuth error: ${err.message}`);

    if (err.statusCode === 409) {
      return sendError(res, err.message, 409, 'CONFLICT_ERROR');
    }

    return sendError(
      res,
      'Google sign-in failed. Please try again.',
      500,
      'GOOGLE_AUTH_ERROR'
    );
  }
};
