/**
 * Auth Controller
 * Handles user registration, login, token refresh, and logout.
 */

const jwt = require('jsonwebtoken');
const User = require('../models/User');
const logger = require('../utils/logger');
const Joi = require('joi');

// ─── Validation Schemas ───────────────────────────────────────────────────────

const registerSchema = Joi.object({
  email: Joi.string().email().lowercase().trim().required().messages({
    'string.email': 'Please provide a valid email address',
    'any.required': 'Email is required',
  }),
  password: Joi.string().min(8).required().messages({
    'string.min': 'Password must be at least 8 characters',
    'any.required': 'Password is required',
  }),
  phone: Joi.string()
    .pattern(/^(\+972|0)[0-9]{8,9}$/)
    .optional()
    .messages({
      'string.pattern.base': 'Please provide a valid Israeli phone number',
    }),
});

const loginSchema = Joi.object({
  email: Joi.string().email().lowercase().trim().required(),
  password: Joi.string().required(),
});

// ─── Token Helpers ────────────────────────────────────────────────────────────

/**
 * Generate a short-lived access token (24h).
 */
const generateAccessToken = (user) =>
  jwt.sign(
    { id: user._id, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
  );

/**
 * Generate a long-lived refresh token (7d).
 */
const generateRefreshToken = (user) =>
  jwt.sign(
    { id: user._id },
    process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );

// ─── Controllers ─────────────────────────────────────────────────────────────

/**
 * POST /api/v1/auth/register
 */
const register = async (req, res) => {
  try {
    const { error, value } = registerSchema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      return res.status(422).json({
        success: false,
        message: 'Validation failed',
        errors: error.details.map((d) => ({ field: d.path.join('.'), message: d.message })),
      });
    }

    const existingUser = await User.findOne({ email: value.email });
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: 'An account with this email already exists',
      });
    }

    const user = await User.create(value);

    const token = generateAccessToken(user);
    const refresh = generateRefreshToken(user);

    // Store refresh token hash in DB
    user.refreshToken = refresh;
    await user.save({ validateBeforeSave: false });

    logger.info('New user registered', { userId: user._id, email: user.email });

    return res.status(201).json({
      success: true,
      message: 'Account created successfully',
      token,
      refreshToken: refresh,
      user: {
        id: user._id,
        email: user.email,
        phone: user.phone,
        verified: user.verified,
        createdAt: user.createdAt,
      },
    });
  } catch (err) {
    logger.error('Register error', { error: err.message });
    return res.status(500).json({ success: false, message: 'Registration failed' });
  }
};

/**
 * POST /api/v1/auth/login
 */
const login = async (req, res) => {
  try {
    const { error, value } = loginSchema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      return res.status(422).json({
        success: false,
        message: 'Validation failed',
        errors: error.details.map((d) => ({ field: d.path.join('.'), message: d.message })),
      });
    }

    const user = await User.findOne({ email: value.email }).select('+password +refreshToken');
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    const isMatch = await user.comparePassword(value.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    const token = generateAccessToken(user);
    const refresh = generateRefreshToken(user);

    user.refreshToken = refresh;
    await user.save({ validateBeforeSave: false });

    logger.info('User logged in', { userId: user._id });

    return res.status(200).json({
      success: true,
      message: 'Login successful',
      token,
      refreshToken: refresh,
      user: {
        id: user._id,
        email: user.email,
        phone: user.phone,
        verified: user.verified,
        createdAt: user.createdAt,
      },
    });
  } catch (err) {
    logger.error('Login error', { error: err.message });
    return res.status(500).json({ success: false, message: 'Login failed' });
  }
};

/**
 * POST /api/v1/auth/refresh
 */
const refreshToken = async (req, res) => {
  try {
    const { refreshToken: token } = req.body;

    if (!token) {
      return res.status(401).json({ success: false, message: 'Refresh token required' });
    }

    const decoded = jwt.verify(
      token,
      process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET
    );

    const user = await User.findById(decoded.id).select('+refreshToken');
    if (!user || user.refreshToken !== token) {
      return res.status(401).json({ success: false, message: 'Invalid refresh token' });
    }

    const newAccessToken = generateAccessToken(user);
    const newRefreshToken = generateRefreshToken(user);

    user.refreshToken = newRefreshToken;
    await user.save({ validateBeforeSave: false });

    return res.status(200).json({
      success: true,
      token: newAccessToken,
      refreshToken: newRefreshToken,
    });
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid or expired refresh token' });
  }
};

/**
 * POST /api/v1/auth/logout
 */
const logout = async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.user.id, { refreshToken: null });
    logger.info('User logged out', { userId: req.user.id });
    return res.status(200).json({ success: true, message: 'Logged out successfully' });
  } catch (err) {
    logger.error('Logout error', { error: err.message });
    return res.status(500).json({ success: false, message: 'Logout failed' });
  }
};

/**
 * GET /api/v1/auth/me
 */
const getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    return res.status(200).json({
      success: true,
      user: {
        id: user._id,
        email: user.email,
        phone: user.phone,
        verified: user.verified,
        createdAt: user.createdAt,
      },
    });
  } catch (err) {
    logger.error('getMe error', { error: err.message });
    return res.status(500).json({ success: false, message: 'Failed to fetch user' });
  }
};

module.exports = { register, login, refreshToken, logout, getMe };
