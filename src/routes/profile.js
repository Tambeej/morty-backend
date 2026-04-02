/**
 * Profile Routes
 * Handles financial profile CRUD operations.
 * All routes require JWT authentication.
 *
 * Base path: /api/v1/profile
 */

const express = require('express');
const router = express.Router();
const { getFinancials, updateFinancials } = require('../controllers/profileController');
const authMiddleware = require('../middleware/auth');

/**
 * @route   GET /api/v1/profile/financials
 * @desc    Get authenticated user's financial profile
 * @access  Private (JWT required)
 * @returns {Object} Financial profile data with computed metrics
 */
router.get('/financials', authMiddleware, getFinancials);

/**
 * @route   PUT /api/v1/profile/financials
 * @desc    Create or update authenticated user's financial profile
 * @access  Private (JWT required)
 * @body    { income, additionalIncome, expenses, assets, debts }
 * @returns {Object} Updated financial profile with computed metrics
 */
router.put('/financials', authMiddleware, updateFinancials);

module.exports = router;
