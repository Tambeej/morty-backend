/**
 * Authentication routes
 *
 * POST /api/v1/auth/register  – create account
 * POST /api/v1/auth/login     – authenticate and receive tokens
 * POST /api/v1/auth/refresh   – rotate refresh token
 * POST /api/v1/auth/logout    – invalidate refresh token
 * GET  /api/v1/auth/me        – get current user profile (protected)
 * POST /api/v1/auth/google    – verify Firebase ID token and issue custom JWTs
 */

'use strict';

const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { validate, registerSchema, loginSchema, refreshSchema, googleSchema } = require('../middleware/validate');
const { authLimiter } = require('../middleware/rateLimit');
const { protect } = require('../middleware/auth');

// Apply stricter rate limiting to all auth endpoints
router.use(authLimiter);

/**
 * @route  POST /api/v1/auth/register
 * @desc   Register a new user account
 * @access Public
 */
router.post('/register', validate(registerSchema), authController.register);

/**
 * @route  POST /api/v1/auth/login
 * @desc   Authenticate user and receive JWT tokens
 * @access Public
 */
router.post('/login', validate(loginSchema), authController.login);

/**
 * @route  POST /api/v1/auth/refresh
 * @desc   Rotate refresh token and receive a new access token
 * @access Public
 */
router.post('/refresh', validate(refreshSchema), authController.refresh);

/**
 * @route  POST /api/v1/auth/logout
 * @desc   Invalidate the refresh token (logout)
 * @access Public (optionally authenticated)
 */
router.post('/logout', authController.logout);

/**
 * @route  GET /api/v1/auth/me
 * @desc   Get the currently authenticated user's profile
 * @access Protected
 */
router.get('/me', protect, authController.me);

/**
 * @route  POST /api/v1/auth/google
 * @desc   Verify a Firebase ID token from Google sign-in and issue custom JWTs.
 *         The client obtains the idToken via firebaseUser.getIdToken() after
 *         signInWithPopup(GoogleAuthProvider). The backend verifies the token
 *         using Firebase Admin SDK and returns the same auth payload as login.
 * @access Public
 * @body   { idToken: string }  – Firebase ID token
 */
router.post('/google', validate(googleSchema), authController.googleAuth);

module.exports = router;
