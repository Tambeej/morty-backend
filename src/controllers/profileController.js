/**
 * Profile controller
 * Handles reading and upserting a user's financial profile.
 */
const Financial = require('../models/Financial');
const logger = require('../utils/logger');

/**
 * GET /api/v1/profile/financials
 */
exports.getFinancials = async (req, res) => {
  try {
    const financial = await Financial.findOne({ userId: req.user._id });
    if (!financial) {
      return res.status(200).json({ success: true, data: null });
    }
    return res.status(200).json({ success: true, data: financial });
  } catch (err) {
    logger.error('getFinancials error: ' + err.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * PUT /api/v1/profile/financials
 */
exports.upsertFinancials = async (req, res) => {
  try {
    const { income, additionalIncome, expenses, assets, debts } = req.body;

    const financial = await Financial.findOneAndUpdate(
      { userId: req.user._id },
      { userId: req.user._id, income, additionalIncome, expenses, assets, debts, updatedAt: new Date() },
      { upsert: true, new: true, runValidators: true }
    );

    return res.status(200).json({ success: true, data: financial });
  } catch (err) {
    logger.error('upsertFinancials error: ' + err.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};
