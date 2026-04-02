/**
 * Auth Controller
 * Handles user registration, login, token refresh, and logout.
 */

const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { AppError } = require('../utils/errors');
const logger = require('../utils/logger');

/**
 * Generate a JWT access token (24h expiry).
 *
 * @param {Object} payload - { id, email }
 * @returns {string} JWT token
 */
const generateAccessToken = (payload) => {
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '24h',
  });
};

/**
 * Generate a JWT refresh token (7d expiry).
 *
 * @param {Object} payload - { id }
 * @returns {string} JWT refresh token
 */
const generateRefreshToken = (payload) => {
  return jwt.sign(payload, process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET, {
    expiresIn: '7d',
  });
};

/**
 * POST /api/v1/auth/register
 * Register a new user account.
 *
 * @param {Object} req - { body: { email, password, phone } }
 * @param {Object} res
 * @param {Function} next
 */
const register = async (req, res, next) => {
  try {
    const { email, password, phone } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return next(new AppError('An account with this email already exists.', 409));
    }

    // Create user (password hashed by pre-save hook)
    const user = await User.create({ email, password, phone });

    // Generate tokens
    const accessToken = generateAccessToken({ id: user._id, email: user.email });
    const refreshToken = generateRefreshToken({ id: user._id });

    // Store refresh token hash in DB
    user.refreshToken = refreshToken;
    await user.save({ validateBeforeSave: false });

    logger.info(`New user registered: ${email}`);

    res.status(201).json({
      success: true,
      message: 'Account created successfully.',
      data: {
        token: accessToken,
        refreshToken,
        user: {
          id: user._id,
          email: user.email,
          phone: user.phone,
          createdAt: user.createdAt,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/v1/auth/login
 * Authenticate user and return tokens.
 *
 * @param {Object} req - { body: { email, password } }
 * @param {Object} res
 * @param {Function} next
 */
const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    // Find user and include password for comparison
    const user = await User.findOne({ email }).select('+password +refreshToken');
    if (!user) {
      return next(new AppError('Invalid email or password.', 401));
    }

    // Verify password
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      return next(new AppError('Invalid email or password.', 401));
    }

    // Generate tokens
    const accessToken = generateAccessToken({ id: user._id, email: user.email });
    const refreshToken = generateRefreshToken({ id: user._id });

    // Update refresh token in DB
    user.refreshToken = refreshToken;
    await user.save({ validateBeforeSave: false });

    logger.info(`User logged in: ${email}`);

    res.status(200).json({
      success: true,
      message: 'Login successful.',
      data: {
        token: accessToken,
        refreshToken,
        user: {
          id: user._id,
          email: user.email,
          phone: user.phone,
          createdAt: user.createdAt,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/v1/auth/refresh
 * Exchange a valid refresh token for a new access token.
 *
 * @param {Object} req - { body: { refreshToken } }
 * @param {Object} res
 * @param {Function} next
 */
const refreshToken = async (req, res, next) => {
  try {
    const { refreshToken: token } = req.body;

    if (!token) {
      return next(new AppError('Refresh token is required.', 400));
    }

    // Verify the refresh token
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET);
    } catch (err) {
      return next(new AppError('Invalid or expired refresh token. Please log in again.', 401));
    }

    // Find user and verify stored refresh token matches
    const user = await User.findById(decoded.id).select('+refreshToken');
    if (!user || user.refreshToken !== token) {
      return next(new AppError('Refresh token is invalid or has been revoked.', 401));
    }

    // Issue new access token
    const newAccessToken = generateAccessToken({ id: user._id, email: user.email });

    res.status(200).json({
      success: true,
      data: { token: newAccessToken },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/v1/auth/logout
 * Invalidate the user's refresh token.
 *
 * @param {Object} req - Authenticated request (req.user set by auth middleware)
 * @param {Object} res
 * @param {Function} next
 */
const logout = async (req, res, next) => {
  try {
    await User.findByIdAndUpdate(req.user.id, { refreshToken: null });

    logger.info(`User logged out: ${req.user.email}`);

    res.status(200).json({
      success: true,
      message: 'Logged out successfully.',
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { register, login, refreshToken, logout };
