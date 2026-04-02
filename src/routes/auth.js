/**
 * Authentication routes
 * POST /api/v1/auth/register
 * POST /api/v1/auth/login
 * POST /api/v1/auth/refresh
 * POST /api/v1/auth/logout
 */
const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { validate, registerSchema, loginSchema, refreshSchema } = require('../middleware/validate');
const { authLimiter } = require('../middleware/rateLimit');

// Apply stricter rate limiting to auth endpoints
router.use(authLimiter);

/**
 * @route  POST /api/v1/auth/register
 * @desc   Register a new user
 * @access Public
 */
router.post('/register', validate(registerSchema), authController.register);

/**
 * @route  POST /api/v1/auth/login
 * @desc   Login and receive JWT tokens
 * @access Public
 */
router.post('/login', validate(loginSchema), authController.login);

/**
 * @route  POST /api/v1/auth/refresh
 * @desc   Refresh access token using refresh token
 * @access Public
 */
router.post('/refresh', validate(refreshSchema), authController.refresh);

/**
 * @route  POST /api/v1/auth/logout
 * @desc   Logout and invalidate refresh token
 * @access Public
 */
router.post('/logout', authController.logout);

module.exports = router;
