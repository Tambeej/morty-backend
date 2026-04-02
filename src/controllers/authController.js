/**
 * Authentication Controller
 * Handles user registration, login, token refresh, and logout
 */

const jwt = require('jsonwebtoken');
const User = require('../models/User');
const logger = require('../utils/logger');
const { AppError, AuthError } = require('../utils/errors');

const generateAccessToken = (userId) => {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '24h',
  });
};

const generateRefreshToken = (userId) => {
  return jwt.sign({ id: userId }, process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  });
};

/**
 * POST /api/v1/auth/register
 */
const register = async (req, res, next) => {
  try {
    const { email, password, phone } = req.body;

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return next(new AppError('Email already registered', 409));
    }

    const user = await User.create({ email, password, phone });

    const accessToken = generateAccessToken(user._id);
    const refreshTokenValue = generateRefreshToken(user._id);

    user.refreshToken = refreshTokenValue;
    await user.save({ validateBeforeSave: false });

    logger.info(`New user registered: ${email}`);

    res.status(201).json({
      success: true,
      data: {
        token: accessToken,
        refreshToken: refreshTokenValue,
        user: {
          id: user._id,
          email: user.email,
          phone: user.phone,
          verified: user.verified,
          createdAt: user.createdAt,
        },
      },
    });
  } catch (error) {
    logger.error('Register error:', error.message);
    next(error);
  }
};

/**
 * POST /api/v1/auth/login
 */
const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email }).select('+password +refreshToken');

    if (!user) {
      return next(new AuthError('Invalid email or password'));
    }

    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      return next(new AuthError('Invalid email or password'));
    }

    const accessToken = generateAccessToken(user._id);
    const refreshTokenValue = generateRefreshToken(user._id);

    user.refreshToken = refreshTokenValue;
    await user.save({ validateBeforeSave: false });

    logger.info(`User logged in: ${email}`);

    res.status(200).json({
      success: true,
      data: {
        token: accessToken,
        refreshToken: refreshTokenValue,
        user: {
          id: user._id,
          email: user.email,
          phone: user.phone,
          verified: user.verified,
          createdAt: user.createdAt,
        },
      },
    });
  } catch (error) {
    logger.error('Login error:', error.message);
    next(error);
  }
};

/**
 * POST /api/v1/auth/refresh
 */
const refreshToken = async (req, res, next) => {
  try {
    const { refreshToken: token } = req.body;

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET);
    } catch (err) {
      return next(new AuthError('Invalid or expired refresh token'));
    }

    const user = await User.findById(decoded.id).select('+refreshToken');

    if (!user || user.refreshToken !== token) {
      return next(new AuthError('Invalid refresh token'));
    }

    const newAccessToken = generateAccessToken(user._id);
    const newRefreshToken = generateRefreshToken(user._id);

    user.refreshToken = newRefreshToken;
    await user.save({ validateBeforeSave: false });

    res.status(200).json({
      success: true,
      data: {
        token: newAccessToken,
        refreshToken: newRefreshToken,
      },
    });
  } catch (error) {
    logger.error('Refresh token error:', error.message);
    next(error);
  }
};

/**
 * POST /api/v1/auth/logout
 */
const logout = async (req, res, next) => {
  try {
    const userId = req.user.id;
    await User.findByIdAndUpdate(userId, { refreshToken: null });
    logger.info(`User logged out: ${userId}`);
    res.status(200).json({
      success: true,
      message: 'Logged out successfully',
    });
  } catch (error) {
    logger.error('Logout error:', error.message);
    next(error);
  }
};

/**
 * GET /api/v1/auth/me
 */
const getMe = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id).lean();

    if (!user) {
      return next(new AuthError('User not found'));
    }

    res.status(200).json({
      success: true,
      data: {
        user: {
          id: user._id,
          email: user.email,
          phone: user.phone,
          verified: user.verified,
          createdAt: user.createdAt,
        },
      },
    });
  } catch (error) {
    logger.error('Get me error:', error.message);
    next(error);
  }
};

module.exports = { register, login, refreshToken, logout, getMe };
