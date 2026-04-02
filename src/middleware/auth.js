/**
 * JWT Authentication Middleware
 * Verifies the Bearer token from the Authorization header.
 * Attaches the decoded user payload to req.user.
 */

const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      message: 'Access denied. No token provided.',
    });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // { id, email, iat, exp }
    next();
  } catch (error) {
    logger.warn('Invalid JWT token', { error: error.message });

    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token expired. Please log in again.',
      });
    }

    return res.status(401).json({
      success: false,
      message: 'Invalid token.',
    });
  }
};

module.exports = authMiddleware;
