/**
 * Dashboard Routes
 * Handles dashboard summary and statistics
 */

const express = require('express');
const router = express.Router();
const { getDashboardSummary } = require('../controllers/analysisController');
const authMiddleware = require('../middleware/auth');

// All dashboard routes require authentication
router.use(authMiddleware);

/**
 * @route   GET /api/v1/dashboard
 * @desc    Get dashboard summary with stats, best rates, and recent offers
 * @access  Private
 */
router.get('/', getDashboardSummary);

module.exports = router;
