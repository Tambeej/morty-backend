/**
 * Auth Routes
 * Handles user registration, login, token refresh, and logout.
 *
 * Base path: /api/v1/auth
 */

const express = require('express');
const router = express.Router();
const {
  register,
  login,
  refreshToken,
  logout,
  getMe,
} = require('../controllers/authController');
const authMiddleware = require('../middleware/auth');
const authRateLimiter = require('../middleware/rateLimit');

/**
 * @route   POST /api/v1/auth/register
 * @desc    Register a new user
 * @access  Public
 */
router.post('/register', authRateLimiter, register);

/**
 * @route   POST /api/v1/auth/login
 * @desc    Authenticate user and return JWT tokens
 * @access  Public
 */
router.post('/login', authRateLimiter, login);

/**
 * @route   POST /api/v1/auth/refresh
 * @desc    Refresh access token using refresh token
 * @access  Public
 */
router.post('/refresh', refreshToken);

/**
 * @route   POST /api/v1/auth/logout
 * @desc    Invalidate refresh token
 * @access  Private
 */
router.post('/logout', authMiddleware, logout);

/**
 * @route   GET /api/v1/auth/me
 * @desc    Get current authenticated user info
 * @access  Private
 */
router.get('/me', authMiddleware, getMe);

module.exports = router;
