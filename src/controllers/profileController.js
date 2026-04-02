/**
 * Profile Controller
 * Handles GET and PUT operations for user financial profiles.
 * All routes are protected by JWT authentication middleware.
 */

const Financial = require('../models/Financial');
const { updateFinancialsSchema } = require('../validators/financialValidator');
const logger = require('../utils/logger');

/**
 * GET /api/v1/profile/financials
 * Retrieve the authenticated user's financial profile.
 * Returns an empty profile structure if none exists yet.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
const getFinancials = async (req, res) => {
  try {
    const userId = req.user.id;

    let financial = await Financial.findOne({ userId }).lean();

    if (!financial) {
      // Return a default empty profile — not an error
      return res.status(200).json({
        success: true,
        data: {
          userId,
          income: 0,
          additionalIncome: 0,
          expenses: { housing: 0, loans: 0, other: 0 },
          assets: { savings: 0, investments: 0 },
          debts: [],
          metrics: {
            totalIncome: 0,
            totalExpenses: 0,
            totalAssets: 0,
            totalDebt: 0,
            disposableIncome: 0,
            debtToIncomeRatio: null,
          },
          updatedAt: null,
        },
      });
    }

    // Compute derived metrics using model method
    const financialDoc = await Financial.findOne({ userId });
    const metrics = financialDoc.computeMetrics();

    return res.status(200).json({
      success: true,
      data: {
        ...financial,
        metrics,
      },
    });
  } catch (error) {
    logger.error('getFinancials error', { error: error.message, userId: req.user?.id });
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve financial profile',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

/**
 * PUT /api/v1/profile/financials
 * Create or update the authenticated user's financial profile.
 * Supports partial updates — only provided fields are updated.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
const updateFinancials = async (req, res) => {
  try {
    const userId = req.user.id;

    // Validate request body
    const { error, value } = updateFinancialsSchema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      const details = error.details.map((d) => ({
        field: d.path.join('.'),
        message: d.message,
      }));
      return res.status(422).json({
        success: false,
        message: 'Validation failed',
        errors: details,
      });
    }

    // Build update object — only include provided fields
    const updateData = { updatedAt: new Date() };

    if (value.income !== undefined) updateData.income = value.income;
    if (value.additionalIncome !== undefined)
      updateData.additionalIncome = value.additionalIncome;

    // Merge nested objects to allow partial expense/asset updates
    if (value.expenses) {
      if (value.expenses.housing !== undefined)
        updateData['expenses.housing'] = value.expenses.housing;
      if (value.expenses.loans !== undefined)
        updateData['expenses.loans'] = value.expenses.loans;
      if (value.expenses.other !== undefined)
        updateData['expenses.other'] = value.expenses.other;
    }

    if (value.assets) {
      if (value.assets.savings !== undefined)
        updateData['assets.savings'] = value.assets.savings;
      if (value.assets.investments !== undefined)
        updateData['assets.investments'] = value.assets.investments;
    }

    // Debts replace the entire array when provided
    if (value.debts !== undefined) updateData.debts = value.debts;

    // Upsert: create if not exists, update if exists
    const financial = await Financial.findOneAndUpdate(
      { userId },
      { $set: updateData },
      {
        new: true,        // return updated document
        upsert: true,     // create if not found
        runValidators: true,
        setDefaultsOnInsert: true,
      }
    );

    const metrics = financial.computeMetrics();

    logger.info('Financial profile updated', { userId });

    return res.status(200).json({
      success: true,
      message: 'Financial profile updated successfully',
      data: {
        ...financial.toObject(),
        metrics,
      },
    });
  } catch (error) {
    logger.error('updateFinancials error', { error: error.message, userId: req.user?.id });
    return res.status(500).json({
      success: false,
      message: 'Failed to update financial profile',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

module.exports = {
  getFinancials,
  updateFinancials,
};
