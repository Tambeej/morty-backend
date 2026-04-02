/**
 * Auth Routes
 * Handles user registration, login, token refresh, and logout.
 *
 * Routes:
 *   POST /api/v1/auth/register  - Register a new user
 *   POST /api/v1/auth/login     - Login and receive tokens
 *   POST /api/v1/auth/refresh   - Refresh access token
 *   POST /api/v1/auth/logout    - Invalidate refresh token
 */

const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');

const { validateRegister, validateLogin } = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const {
  register,
  login,
  refreshToken,
  logout,
} = require('../controllers/authController');

/**
 * Stricter rate limit for auth endpoints to prevent brute-force attacks.
 * 10 requests per 15 minutes per IP.
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      message: 'Too many authentication attempts. Please try again in 15 minutes.',
      statusCode: 429,
    },
  },
});

router.post('/register', authLimiter, validateRegister, register);
router.post('/login', authLimiter, validateLogin, login);
router.post('/refresh', refreshToken);
router.post('/logout', authenticate, logout);

module.exports = router;
