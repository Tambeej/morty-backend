/**
 * Profile Controller
 * Handles retrieval and update of user financial profiles.
 */

const Financial = require('../models/Financial');
const { AppError } = require('../utils/errors');
const logger = require('../utils/logger');

/**
 * GET /api/v1/profile/financials
 * Retrieve the authenticated user's financial profile.
 *
 * @param {Object} req - Authenticated request
 * @param {Object} res
 * @param {Function} next
 */
const getFinancials = async (req, res, next) => {
  try {
    const financial = await Financial.findOne({ userId: req.user.id }).lean({ virtuals: true });

    if (!financial) {
      return res.status(200).json({
        success: true,
        data: { financial: null },
        message: 'No financial profile found. Please create one.',
      });
    }

    res.status(200).json({
      success: true,
      data: { financial },
    });
  } catch (error) {
    logger.error('getFinancials error:', error);
    next(error);
  }
};

/**
 * PUT /api/v1/profile/financials
 * Create or update the authenticated user's financial profile.
 * Uses upsert to handle both create and update in one operation.
 *
 * @param {Object} req - Authenticated request with validated body
 * @param {Object} res
 * @param {Function} next
 */
const upsertFinancials = async (req, res, next) => {
  try {
    const { income, expenses, assets, debts } = req.body;
    const userId = req.user.id;

    const financial = await Financial.findOneAndUpdate(
      { userId },
      { income, expenses, assets, debts, updatedAt: new Date() },
      {
        new: true, // Return updated document
        upsert: true, // Create if doesn't exist
        runValidators: true,
        setDefaultsOnInsert: true,
      }
    ).lean({ virtuals: true });

    logger.info(`Financial profile updated for user ${userId}`);

    res.status(200).json({
      success: true,
      message: 'Financial profile saved successfully.',
      data: { financial },
    });
  } catch (error) {
    logger.error('upsertFinancials error:', error);
    next(error);
  }
};

module.exports = { getFinancials, upsertFinancials };
