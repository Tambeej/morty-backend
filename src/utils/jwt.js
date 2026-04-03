/**
 * JWT utility functions.
 *
 * Provides helpers for generating and verifying access and refresh tokens.
 *
 * Token lifetimes (configurable via environment variables):
 *   - Access token:  JWT_EXPIRES_IN          (default: '15m')
 *   - Refresh token: JWT_REFRESH_EXPIRES_IN   (default: '7d')
 *
 * Secrets (required in production):
 *   - JWT_SECRET         – signs/verifies access tokens
 *   - JWT_REFRESH_SECRET – signs/verifies refresh tokens
 *     Falls back to JWT_SECRET + '_refresh' when not set (dev only).
 */

'use strict';

const jwt = require('jsonwebtoken');

const ACCESS_TOKEN_SECRET = process.env.JWT_SECRET;
const REFRESH_TOKEN_SECRET =
  process.env.JWT_REFRESH_SECRET || (process.env.JWT_SECRET && process.env.JWT_SECRET + '_refresh');

/**
 * Default access token lifetime: 15 minutes.
 *
 * Per architecture spec: short-lived access tokens reduce the window of
 * exposure if a token is leaked. Clients must use the refresh token to
 * obtain a new access token after expiry.
 *
 * Override via JWT_EXPIRES_IN environment variable (e.g. '30m', '1h').
 */
const ACCESS_TOKEN_EXPIRY = process.env.JWT_EXPIRES_IN || '15m';

/**
 * Default refresh token lifetime: 7 days.
 *
 * Override via JWT_REFRESH_EXPIRES_IN environment variable (e.g. '30d').
 */
const REFRESH_TOKEN_EXPIRY = process.env.JWT_REFRESH_EXPIRES_IN || '7d';

/**
 * Generate a short-lived access token.
 *
 * The payload should contain the minimum required claims (e.g. { id }).
 * Do NOT include sensitive data (passwords, raw emails, etc.).
 *
 * @param {Object} payload - Data to encode (e.g. { id: firestoreUserId })
 * @returns {string} Signed JWT access token
 * @throws {Error} When JWT_SECRET is not configured
 */
function generateAccessToken(payload) {
  if (!ACCESS_TOKEN_SECRET) {
    throw new Error('JWT_SECRET environment variable is not set.');
  }
  return jwt.sign(payload, ACCESS_TOKEN_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRY });
}

/**
 * Generate a long-lived refresh token.
 *
 * Refresh tokens are stored in Firestore (one per user) and rotated on
 * every use. They are signed with a separate secret so that a compromised
 * access token cannot be used to forge a refresh token.
 *
 * @param {Object} payload - Data to encode (e.g. { id: firestoreUserId })
 * @returns {string} Signed JWT refresh token
 * @throws {Error} When JWT_REFRESH_SECRET is not configured
 */
function generateRefreshToken(payload) {
  if (!REFRESH_TOKEN_SECRET) {
    throw new Error('JWT_REFRESH_SECRET environment variable is not set.');
  }
  return jwt.sign(payload, REFRESH_TOKEN_SECRET, { expiresIn: REFRESH_TOKEN_EXPIRY });
}

/**
 * Verify and decode an access token.
 *
 * @param {string} token - JWT access token
 * @returns {Object} Decoded payload
 * @throws {JsonWebTokenError}  Token is malformed or signature is invalid
 * @throws {TokenExpiredError}  Token has expired
 */
function verifyAccessToken(token) {
  if (!ACCESS_TOKEN_SECRET) {
    throw new Error('JWT_SECRET environment variable is not set.');
  }
  return jwt.verify(token, ACCESS_TOKEN_SECRET);
}

/**
 * Verify and decode a refresh token.
 *
 * @param {string} token - JWT refresh token
 * @returns {Object} Decoded payload
 * @throws {JsonWebTokenError}  Token is malformed or signature is invalid
 * @throws {TokenExpiredError}  Token has expired
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
