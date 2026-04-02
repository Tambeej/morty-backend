/**
 * Authentication controller
 * Handles register, login, token refresh, and logout.
 */
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const logger = require('../utils/logger');

/** Generate a short-lived access token (24 h) */
const generateAccessToken = (userId) =>
  jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: '24h' });

/** Generate a long-lived refresh token (7 d) */
const generateRefreshToken = (userId) =>
  jwt.sign({ id: userId }, process.env.JWT_REFRESH_SECRET, { expiresIn: '7d' });

/**
 * POST /api/v1/auth/register
 */
exports.register = async (req, res) => {
  try {
    const { email, password, phone } = req.body;

    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(409).json({ success: false, message: 'Email already registered' });
    }

    const hashed = await bcrypt.hash(password, 12);
    const user = await User.create({ email, password: hashed, phone: phone || '' });

    const token = generateAccessToken(user._id);
    const refreshToken = generateRefreshToken(user._id);

    user.refreshToken = refreshToken;
    await user.save();

    logger.info(`New user registered: ${email}`);

    return res.status(201).json({
      success: true,
      token,
      refreshToken,
      user: { id: user._id, email: user.email, phone: user.phone },
    });
  } catch (err) {
    logger.error('Register error: ' + err.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * POST /api/v1/auth/login
 */
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const token = generateAccessToken(user._id);
    const refreshToken = generateRefreshToken(user._id);

    user.refreshToken = refreshToken;
    await user.save();

    logger.info(`User logged in: ${email}`);

    return res.status(200).json({
      success: true,
      token,
      refreshToken,
      user: { id: user._id, email: user.email, phone: user.phone },
    });
  } catch (err) {
    logger.error('Login error: ' + err.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * POST /api/v1/auth/refresh
 */
exports.refresh = async (req, res) => {
  try {
    const { refreshToken } = req.body;

    let decoded;
    try {
      decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    } catch {
      return res.status(401).json({ success: false, message: 'Invalid or expired refresh token' });
    }

    const user = await User.findById(decoded.id);
    if (!user || user.refreshToken !== refreshToken) {
      return res.status(401).json({ success: false, message: 'Refresh token mismatch' });
    }

    const newToken = generateAccessToken(user._id);
    const newRefreshToken = generateRefreshToken(user._id);

    user.refreshToken = newRefreshToken;
    await user.save();

    return res.status(200).json({ success: true, token: newToken, refreshToken: newRefreshToken });
  } catch (err) {
    logger.error('Refresh error: ' + err.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * POST /api/v1/auth/logout
 */
exports.logout = async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) {
      await User.findOneAndUpdate({ refreshToken }, { refreshToken: null });
    }
    return res.status(200).json({ success: true, message: 'Logged out successfully' });
  } catch (err) {
    logger.error('Logout error: ' + err.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};
