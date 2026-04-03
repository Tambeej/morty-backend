/**
 * JWT authentication middleware
 *
 * Verifies the Bearer JWT in the Authorization header and attaches the
 * authenticated user's public profile to `req.user`.
 *
 * Uses the Firestore-backed userService instead of the legacy Mongoose model.
 */

'use strict';

const { verifyAccessToken } = require('../utils/jwt');
const userService = require('../services/userService');
const logger = require('../utils/logger');

/**
 * protect – Express middleware that validates the JWT access token.
 *
 * On success: attaches `req.user` (public user object) and calls `next()`.
 * On failure: returns 401 with an appropriate error message.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
const protect = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];

    // Verify signature and expiry using the jwt utility
    let decoded;
    try {
      decoded = verifyAccessToken(token);
    } catch (tokenErr) {
      if (tokenErr.name === 'TokenExpiredError') {
        return res.status(401).json({ success: false, message: 'Token expired' });
      }
      return res.status(401).json({ success: false, message: 'Invalid token' });
    }

    // Fetch the user from Firestore (returns public profile – no password/refreshToken)
    const user = await userService.getUserById(decoded.id);
    if (!user) {
      return res.status(401).json({ success: false, message: 'User not found' });
    }

    req.user = user;
    next();
  } catch (err) {
    logger.warn(`auth middleware error: ${err.message}`);
    return res.status(401).json({ success: false, message: 'Authentication failed' });
  }
};

module.exports = { protect };
