/**
 * Authentication Controller
 * Handles user registration, login, token refresh, and logout.
 */

const User = require('../models/User');
const { generateAccessToken, generateRefreshToken, verifyRefreshToken } = require('../utils/jwt');
const { AppError } = require('../utils/errors');
const logger = require('../utils/logger');

/**
 * POST /api/v1/auth/register
 * Register a new user account.
 */
async function register(req, res, next) {
  try {
    const { email, password, phone } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return next(new AppError('Email address is already registered.', 409));
    }

    // Create new user (password hashing handled by User model pre-save hook)
    const user = new User({
      email: email.toLowerCase(),
      password,
      phone: phone || undefined,
    });

    // Generate refresh token and attach to user
    const refreshToken = generateRefreshToken({ id: user._id.toString() });
    user.refreshToken = refreshToken;

    await user.save();

    // Generate access token
    const accessToken = generateAccessToken({
      id: user._id.toString(),
      email: user.email,
    });

    logger.info(`New user registered: ${user.email}`);

    return res.status(201).json({
      success: true,
      message: 'Registration successful.',
      token: accessToken,
      refreshToken,
      user: {
        id: user._id,
        email: user.email,
        phone: user.phone,
        verified: user.verified,
        createdAt: user.createdAt,
      },
    });
  } catch (err) {
    logger.error('Register error:', err);
    return next(err);
  }
}

/**
 * POST /api/v1/auth/login
 * Authenticate an existing user and return tokens.
 */
async function login(req, res, next) {
  try {
    const { email, password } = req.body;

    // Find user by email (include password field explicitly)
    const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
    if (!user) {
      return next(new AppError('Invalid email or password.', 401));
    }

    // Verify password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return next(new AppError('Invalid email or password.', 401));
    }

    // Generate tokens
    const accessToken = generateAccessToken({
      id: user._id.toString(),
      email: user.email,
    });
    const refreshToken = generateRefreshToken({ id: user._id.toString() });

    // Persist refresh token
    user.refreshToken = refreshToken;
    await user.save();

    logger.info(`User logged in: ${user.email}`);

    return res.status(200).json({
      success: true,
      message: 'Login successful.',
      token: accessToken,
      refreshToken,
      user: {
        id: user._id,
        email: user.email,
        phone: user.phone,
        verified: user.verified,
        createdAt: user.createdAt,
      },
    });
  } catch (err) {
    logger.error('Login error:', err);
    return next(err);
  }
}

/**
 * POST /api/v1/auth/refresh
 * Issue a new access token using a valid refresh token.
 */
async function refresh(req, res, next) {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return next(new AppError('Refresh token is required.', 400));
    }

    // Verify the refresh token signature and expiry
    let payload;
    try {
      payload = verifyRefreshToken(refreshToken);
    } catch (err) {
      return next(new AppError('Invalid or expired refresh token.', 401));
    }

    // Ensure the token matches what is stored (rotation / revocation check)
    const user = await User.findById(payload.id);
    if (!user || user.refreshToken !== refreshToken) {
      return next(new AppError('Refresh token has been revoked.', 401));
    }

    // Issue new tokens (rotate refresh token)
    const newAccessToken = generateAccessToken({
      id: user._id.toString(),
      email: user.email,
    });
    const newRefreshToken = generateRefreshToken({ id: user._id.toString() });

    user.refreshToken = newRefreshToken;
    await user.save();

    logger.info(`Tokens refreshed for user: ${user.email}`);

    return res.status(200).json({
      success: true,
      token: newAccessToken,
      refreshToken: newRefreshToken,
    });
  } catch (err) {
    logger.error('Refresh error:', err);
    return next(err);
  }
}

/**
 * POST /api/v1/auth/logout
 * Invalidate the user's refresh token (requires valid access token).
 */
async function logout(req, res, next) {
  try {
    // req.user is set by the auth middleware
    const user = await User.findById(req.user.id);
    if (user) {
      user.refreshToken = undefined;
      await user.save();
      logger.info(`User logged out: ${user.email}`);
    }

    return res.status(200).json({
      success: true,
      message: 'Logged out successfully.',
    });
  } catch (err) {
    logger.error('Logout error:', err);
    return next(err);
  }
}

/**
 * GET /api/v1/auth/me
 * Return the currently authenticated user's profile.
 */
async function me(req, res, next) {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return next(new AppError('User not found.', 404));
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
    logger.error('Me error:', err);
    return next(err);
  }
}

module.exports = { register, login, refresh, logout, me };
