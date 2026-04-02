/**
 * Profile Routes
 * Handles user financial profile CRUD operations
 */

const express = require('express');
const router = express.Router();
const { getFinancials, upsertFinancials } = require('../controllers/profileController');
const authMiddleware = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validate');

router.use(authMiddleware);

/**
 * @route   GET /api/v1/profile
 * @desc    Get user financial profile
 * @access  Private
 */
router.get('/', getFinancials);

/**
 * @route   PUT /api/v1/profile
 * @desc    Create or update user financial profile
 * @access  Private
 */
router.put('/', validate(schemas.financials), upsertFinancials);

module.exports = router;
