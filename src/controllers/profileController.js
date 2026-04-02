/**
 * Profile Controller
 * Handles user financial profile operations
 */

const Financial = require('../models/Financial');
const logger = require('../utils/logger');
const { AppError } = require('../utils/errors');

/**
 * GET /api/v1/profile
 */
const getFinancials = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const financial = await Financial.findOne({ userId }).lean();

    if (!financial) {
      return res.status(200).json({
        success: true,
        data: null,
        message: 'No financial profile found. Please create one.',
      });
    }

    res.status(200).json({
      success: true,
      data: financial,
    });
  } catch (error) {
    logger.error('Get financials error:', error.message);
    next(error);
  }
};

/**
 * PUT /api/v1/profile
 */
const upsertFinancials = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { income, expenses, assets, debts } = req.body;

    const financial = await Financial.findOneAndUpdate(
      { userId },
      {
        userId,
        income,
        expenses: expenses || {},
        assets: assets || {},
        debts: debts || [],
        updatedAt: new Date(),
      },
      {
        new: true,
        upsert: true,
        runValidators: true,
      }
    );

    logger.info(`Financial profile updated for user: ${userId}`);

    res.status(200).json({
      success: true,
      data: financial,
      message: 'Financial profile updated successfully',
    });
  } catch (error) {
    logger.error('Upsert financials error:', error.message);
    next(error);
  }
};

module.exports = { getFinancials, upsertFinancials };
