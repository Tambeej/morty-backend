/**
 * Profile controller
 *
 * Handles reading and upserting a user's financial profile.
 * Delegates all Firestore operations to financialService.
 *
 * Routes:
 *   GET  /api/v1/profile  → getFinancials
 *   PUT  /api/v1/profile  → upsertFinancials
 */

'use strict';

const financialService = require('../services/financialService');
const logger = require('../utils/logger');

/**
 * GET /api/v1/profile
 *
 * Returns the authenticated user's financial profile.
 * Responds with `{ data: null }` when no profile has been created yet.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 */
exports.getFinancials = async (req, res) => {
  try {
    const userId = req.user.id;
    const financial = await financialService.getFinancials(userId);

    return res.status(200).json({
      success: true,
      data: financial,
      message: financial ? 'Financial profile retrieved' : 'No financial profile found',
    });
  } catch (err) {
    logger.error(`profileController.getFinancials error: ${err.message}`);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve financial profile',
    });
  }
};

/**
 * PUT /api/v1/profile
 *
 * Creates or fully replaces the authenticated user's financial profile.
 * Accepts a partial or full financial shape; missing fields default to 0 / [].
 *
 * Request body (all fields optional):
 * {
 *   income:           number,
 *   additionalIncome: number,
 *   expenses:         { housing, loans, other },
 *   assets:           { savings, investments },
 *   debts:            [{ type, amount }]
 * }
 *
 * Response: { success: true, data: financialShape, message: string }
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 */
exports.upsertFinancials = async (req, res) => {
  try {
    const userId = req.user.id;
    const { income, additionalIncome, expenses, assets, debts } = req.body;

    const financial = await financialService.upsertFinancials(userId, {
      income,
      additionalIncome,
      expenses,
      assets,
      debts,
    });

    return res.status(200).json({
      success: true,
      data: financial,
      message: 'Financial profile updated successfully',
    });
  } catch (err) {
    logger.error(`profileController.upsertFinancials error: ${err.message}`);
    return res.status(500).json({
      success: false,
      message: 'Failed to update financial profile',
    });
  }
};
