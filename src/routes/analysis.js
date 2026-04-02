/**
 * Analysis routes
 * GET /api/v1/analysis/:id  – get analysis results for an offer
 */
const express = require('express');
const router = express.Router();
const analysisController = require('../controllers/analysisController');
const { protect } = require('../middleware/auth');

router.use(protect);

/**
 * @route  GET /api/v1/analysis/:id
 * @desc   Get AI analysis results for a specific offer
 * @access Private
 */
router.get('/:id', analysisController.getAnalysis);

module.exports = router;
