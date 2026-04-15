/**
 * Analysis routes
 *
 * GET  /api/v1/analysis/:id                  – get analysis results for an offer
 * POST /api/v1/analysis/enhanced/:offerId     – generate enhanced report (paid)
 */
const express = require('express');
const router = express.Router();
const analysisController = require('../controllers/analysisController');
const { protect } = require('../middleware/auth');
const { requirePaidAccess } = require('../middleware/paidAccess');
const { validate } = require('../middleware/validate');
const { enhancedAnalysisSchema } = require('../validators/analysisValidator');

// All analysis routes require authentication
router.use(protect);

/**
 * @route  GET /api/v1/analysis/:id
 * @desc   Get AI analysis results for a specific offer
 * @access Private
 */
router.get('/:id', analysisController.getAnalysis);

/**
 * @route  POST /api/v1/analysis/enhanced/:offerId
 * @desc   Generate enhanced analysis report comparing real offer to optimized model
 * @access Private + Paid
 */
router.post(
  '/enhanced/:offerId',
  requirePaidAccess,
  validate(enhancedAnalysisSchema),
  analysisController.getEnhancedAnalysis
);

module.exports = router;
