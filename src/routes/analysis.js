'use strict';

const express = require('express');
const { protect } = require('../middleware/auth');
const { paidAccess } = require('../middleware/paidAccess');
const { paidEndpointLimiter } = require('../middleware/rateLimit');
const { validateOfferId } = require('../validators/analysisValidator');
const { generateEnhancedReport } = require('../controllers/analysisController');

const router = express.Router();

/**
 * POST /api/v1/analysis/:offerId/enhanced
 *
 * Generate an AI-powered enhanced mortgage analysis report.
 *
 * Middleware chain:
 *   1. protect          — Verify Firebase ID token, attach req.user
 *   2. paidAccess       — Ensure req.user.paidAnalyses === true
 *   3. paidEndpointLimiter — Rate limit: 5 req/min per user
 *   4. validateOfferId  — Validate :offerId param format
 *   5. generateEnhancedReport — Controller
 *
 * @returns {object} { success: true, data: enhancedReport }
 */
router.post(
  '/:offerId/enhanced',
  protect,
  paidAccess,
  paidEndpointLimiter,
  validateOfferId,
  generateEnhancedReport
);

module.exports = router;
