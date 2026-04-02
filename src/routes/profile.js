/**
 * Profile / financial data routes
 * GET  /api/v1/profile/financials
 * PUT  /api/v1/profile/financials
 */
const express = require('express');
const router = express.Router();
const profileController = require('../controllers/profileController');
const { validate, financialSchema } = require('../middleware/validate');
const { protect } = require('../middleware/auth');

// All profile routes require authentication
router.use(protect);

/**
 * @route  GET /api/v1/profile/financials
 * @desc   Get the authenticated user's financial profile
 * @access Private
 */
router.get('/financials', profileController.getFinancials);

/**
 * @route  PUT /api/v1/profile/financials
 * @desc   Create or update the authenticated user's financial profile
 * @access Private
 */
router.put('/financials', validate(financialSchema), profileController.upsertFinancials);

module.exports = router;
