/**
 * Wizard routes
 *
 * Public endpoints for the mortgage wizard.
 *
 * POST /api/v1/public/wizard/submit – Generate portfolio scenarios from wizard inputs
 */

'use strict';

const express = require('express');
const router = express.Router();
const wizardController = require('../controllers/wizardController');
const { validate } = require('../middleware/validate');
const { wizardSubmitSchema } = require('../validators/wizardValidator');
const rateLimit = require('express-rate-limit');

/**
 * Rate limiter for wizard submit endpoint.
 * 5 requests per minute per IP – prevents abuse of the AI-powered endpoint.
 * Per architecture: "Rate-limit 5/min/IP"
 */
const wizardLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many wizard submissions. Please wait a moment and try again.',
      timestamp: new Date().toISOString(),
    },
  },
});

/**
 * @route  POST /api/v1/public/wizard/submit
 * @desc   Generate up to 4 mortgage portfolio scenarios based on wizard inputs
 * @access Public (no auth required)
 * @body   { inputs: { propertyPrice, loanAmount, monthlyIncome, additionalIncome?,
 *           targetRepayment, futureFunds: { timeframe, amount? }, stabilityPreference },
 *           consent: boolean }
 * @returns { portfolios: Portfolio[], communityTips: [], metadata: {} }
 */
router.post(
  '/submit',
  wizardLimiter,
  validate(wizardSubmitSchema),
  wizardController.submitWizard
);

module.exports = router;
