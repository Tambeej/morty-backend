/**
 * Analysis Routes
 * Handles mortgage analysis retrieval endpoints
 */

const express = require('express');
const router = express.Router();
const {
  getAnalysis,
  getAllAnalyses,
  reanalyzeOffer,
  streamAnalysisStatus,
} = require('../controllers/analysisController');
const authMiddleware = require('../middleware/auth');

// All analysis routes require authentication
router.use(authMiddleware);

/**
 * @route   GET /api/v1/analysis
 * @desc    Get all analysis results for the authenticated user
 * @access  Private
 * @query   status - Filter by status (pending|analyzed|error)
 * @query   page - Page number (default: 1)
 * @query   limit - Results per page (default: 10)
 */
router.get('/', getAllAnalyses);

/**
 * @route   GET /api/v1/analysis/:id
 * @desc    Get analysis results for a specific offer
 * @access  Private
 */
router.get('/:id', getAnalysis);

/**
 * @route   GET /api/v1/analysis/:id/stream
 * @desc    SSE stream for real-time analysis status updates
 * @access  Private
 */
router.get('/:id/stream', streamAnalysisStatus);

/**
 * @route   POST /api/v1/analysis/:id/reanalyze
 * @desc    Trigger re-analysis for a specific offer
 * @access  Private
 */
router.post('/:id/reanalyze', reanalyzeOffer);

module.exports = router;
