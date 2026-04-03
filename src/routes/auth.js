/**
 * Authentication routes
 *
 * POST /api/v1/auth/register  – create account
 * POST /api/v1/auth/login     – authenticate and receive tokens
 * POST /api/v1/auth/refresh   – rotate refresh token
 * POST /api/v1/auth/logout    – invalidate refresh token
 * GET  /api/v1/auth/me        – get current user profile (protected)
 */

'use strict';

const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { validate, registerSchema, loginSchema, refreshSchema } = require('../middleware/validate');
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

module.exports = router;
