/**
 * Profile / financial data routes
 *
 * Mounted at /api/v1/profile in src/index.js.
 *
 * Endpoints:
 *   GET   /api/v1/profile  – retrieve the authenticated user's financial profile
 *   PUT   /api/v1/profile  – create or fully replace the financial profile
 *   PATCH /api/v1/profile  – partially update specific financial fields
 */

'use strict';

const express = require('express');
const router = express.Router();
const profileController = require('../controllers/profileController');
const { validate, financialSchema, patchFinancialSchema } = require('../middleware/validate');
const { protect } = require('../middleware/auth');

// All profile routes require a valid JWT
router.use(protect);

/**
 * @route  GET /api/v1/profile
 * @desc   Get the authenticated user's financial profile
 * @access Private
 *
 * Response: { success: true, data: financialShape | null, message: string }
 */
router.get('/', profileController.getFinancials);

/**
 * @route  PUT /api/v1/profile
 * @desc   Create or fully replace the authenticated user's financial profile
 * @access Private
 *
 * Body: financialShape (all fields optional; missing fields default to 0 / [])
 * Response: { success: true, data: financialShape, message: string }
 */
router.put('/', validate(financialSchema), profileController.upsertFinancials);

/**
 * @route  PATCH /api/v1/profile
 * @desc   Partially update specific fields of the financial profile
 * @access Private
 *
 * Body: partial financialShape (at least one field required)
 * Response: { success: true, data: financialShape, message: string }
 */
router.patch('/', validate(patchFinancialSchema), profileController.patchFinancials);

module.exports = router;
