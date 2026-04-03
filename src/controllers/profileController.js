/**
 * Profile controller
 *
 * Handles reading and upserting a user's financial profile.
 * Delegates all Firestore operations to financialService.
 *
 * Routes (mounted at /api/v1/profile):
 *   GET   /api/v1/profile  → getFinancials
 *   PUT   /api/v1/profile  → upsertFinancials  (full replace / create)
 *   PATCH /api/v1/profile  → patchFinancials   (partial update)
 *
 * All responses follow the envelope: { success, data, message }
 */

'use strict';

const financialService = require('../services/financialService');
const logger = require('../utils/logger');

// ── GET /api/v1/profile ───────────────────────────────────────────────────────

/**
 * GET /api/v1/profile
 *
 * Returns the authenticated user's financial profile.
 * Responds with `{ data: null }` when no profile has been created yet
 * (HTTP 200 – absence of data is not an error).
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 */
exports.getFinancials = async (req, res) => {
  try {
    const userId = req.user.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'User ID not found in token',
      });
    }

    const financial = await financialService.getFinancials(userId);

    return res.status(200).json({
      success: true,
      data: financial,
      message: financial
        ? 'Financial profile retrieved'
        : 'No financial profile found',
    });
  } catch (err) {
    logger.error(`profileController.getFinancials error: ${err.message}`);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve financial profile',
    });
  }
};

// ── PUT /api/v1/profile ───────────────────────────────────────────────────────

/**
 * PUT /api/v1/profile
 *
 * Creates or fully replaces the authenticated user's financial profile.
 * Accepts a partial or full financial shape; missing fields default to 0 / [].
 * This is an upsert – safe to call even when no profile exists yet.
 *
 * Request body (all fields optional, validated by financialSchema middleware):
 * {
 *   income:           number  (default 0)
 *   additionalIncome: number  (default 0)
 *   expenses:         { housing: number, loans: number, other: number }
 *   assets:           { savings: number, investments: number }
 *   debts:            [{ type: string, amount: number }]
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

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'User ID not found in token',
      });
    }

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

// ── PATCH /api/v1/profile ─────────────────────────────────────────────────────

/**
 * PATCH /api/v1/profile
 *
 * Partially updates the authenticated user's financial profile.
 * Only the provided fields are written; existing fields are preserved.
 * Falls back to a full upsert if no profile exists yet.
 *
 * Request body (at least one field required):
 * {
 *   income?:           number
 *   additionalIncome?: number
 *   expenses?:         { housing?, loans?, other? }
 *   assets?:           { savings?, investments? }
 *   debts?:            [{ type: string, amount: number }]
 * }
 *
 * Response: { success: true, data: financialShape, message: string }
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 */
exports.patchFinancials = async (req, res) => {
  try {
    const userId = req.user.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'User ID not found in token',
      });
    }

    // Reject empty PATCH bodies
    if (!req.body || Object.keys(req.body).length === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one financial field must be provided for a partial update',
      });
    }

    const { income, additionalIncome, expenses, assets, debts } = req.body;

    // Build a partial update object – only include fields that were sent
    const updates = {};
    if (income !== undefined) updates.income = income;
    if (additionalIncome !== undefined) updates.additionalIncome = additionalIncome;
    if (expenses !== undefined) updates.expenses = expenses;
    if (assets !== undefined) updates.assets = assets;
    if (debts !== undefined) updates.debts = debts;

    const financial = await financialService.updateFinancials(userId, updates);

    return res.status(200).json({
      success: true,
      data: financial,
      message: 'Financial profile partially updated',
    });
  } catch (err) {
    logger.error(`profileController.patchFinancials error: ${err.message}`);
    return res.status(500).json({
      success: false,
      message: 'Failed to partially update financial profile',
    });
  }
};
