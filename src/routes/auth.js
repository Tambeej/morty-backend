/**
 * Authentication routes — Firebase-only.
 *
 * POST /api/v1/auth/register  – verify Firebase ID token, create Firestore user
 * POST /api/v1/auth/logout    – no-op (Firebase SDK handles sign-out client-side)
 * GET  /api/v1/auth/me        – get current user profile (protected)
 * POST /api/v1/auth/google    – verify Firebase ID token from Google sign-in
 */

'use strict';

const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { validate } = require('../middleware/validate');
const { registerSchema, googleSchema } = require('../validators/authValidators');
const { authLimiter } = require('../middleware/rateLimit');
const { protect } = require('../middleware/auth');

// Apply stricter rate limiting to all auth endpoints
router.use(authLimiter);

router.post('/register', validate(registerSchema), authController.register);
router.post('/logout', authController.logout);
router.get('/me', protect, authController.me);
router.post('/google', validate(googleSchema), authController.googleAuth);

module.exports = router;
