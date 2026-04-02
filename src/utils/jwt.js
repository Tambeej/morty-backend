/**
 * JWT utility functions.
 * Provides helpers for generating and verifying access and refresh tokens.
 */

const jwt = require('jsonwebtoken');

const ACCESS_TOKEN_SECRET = process.env.JWT_SECRET;
const REFRESH_TOKEN_SECRET = process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET + '_refresh';
const ACCESS_TOKEN_EXPIRY = process.env.JWT_EXPIRES_IN || '24h';
const REFRESH_TOKEN_EXPIRY = process.env.JWT_REFRESH_EXPIRES_IN || '7d';

/**
 * Generate a short-lived access token.
 * @param {Object} payload - Data to encode (e.g. { id, email })
 * @returns {string} Signed JWT access token
 */
function generateAccessToken(payload) {
  if (!ACCESS_TOKEN_SECRET) {
    throw new Error('JWT_SECRET environment variable is not set.');
  }
  return jwt.sign(payload, ACCESS_TOKEN_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRY });
}

/**
 * Generate a long-lived refresh token.
 * @param {Object} payload - Data to encode (e.g. { id })
 * @returns {string} Signed JWT refresh token
 */
function generateRefreshToken(payload) {
  if (!REFRESH_TOKEN_SECRET) {
    throw new Error('JWT_REFRESH_SECRET environment variable is not set.');
  }
  return jwt.sign(payload, REFRESH_TOKEN_SECRET, { expiresIn: REFRESH_TOKEN_EXPIRY });
}

/**
 * Verify and decode an access token.
 * @param {string} token - JWT access token
 * @returns {Object} Decoded payload
 * @throws {JsonWebTokenError|TokenExpiredError}
 */
function verifyAccessToken(token) {
  if (!ACCESS_TOKEN_SECRET) {
    throw new Error('JWT_SECRET environment variable is not set.');
  }
  return jwt.verify(token, ACCESS_TOKEN_SECRET);
}

/**
 * Verify and decode a refresh token.
 * @param {string} token - JWT refresh token
 * @returns {Object} Decoded payload
 * @throws {JsonWebTokenError|TokenExpiredError}
 */
function verifyRefreshToken(token) {
  if (!REFRESH_TOKEN_SECRET) {
    throw new Error('JWT_REFRESH_SECRET environment variable is not set.');
  }
  return jwt.verify(token, REFRESH_TOKEN_SECRET);
}

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
};
