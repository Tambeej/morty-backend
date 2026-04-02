/**
 * Profile Routes
 * Handles user financial profile management.
 *
 * Routes:
 *   GET /api/v1/profile/financials  - Get user's financial profile
 *   PUT /api/v1/profile/financials  - Create or update financial profile
 */

const express = require('express');
const router = express.Router();

const { authenticate } = require('../middleware/auth');
const { validateFinancials } = require('../middleware/validate');
const { getFinancials, upsertFinancials } = require('../controllers/profileController');

// All profile routes require authentication
router.use(authenticate);

router.get('/financials', getFinancials);
router.put('/financials', validateFinancials, upsertFinancials);

module.exports = router;
