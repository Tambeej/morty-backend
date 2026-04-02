/**
 * Dashboard routes
 * GET /api/v1/dashboard  – summary data for the authenticated user
 */
const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboardController');
const { protect } = require('../middleware/auth');

router.use(protect);

/**
 * @route  GET /api/v1/dashboard
 * @desc   Get dashboard summary (best rate, savings, offer count)
 * @access Private
 */
router.get('/', dashboardController.getSummary);

module.exports = router;
