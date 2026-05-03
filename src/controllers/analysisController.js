/**
 * Analysis Controller
 *
 * Handles analysis-related endpoints:
 *   GET  /api/v1/analysis/:id                  – get full offer analysis
 *   POST /api/v1/analysis/enhanced/:offerId     – generate enhanced report (paid)
 *
 * The enhanced analysis compares a user's real bank offer (OCR-extracted)
 * against their selected optimized portfolio model, generating:
 *   - Track-by-track comparison
 *   - Mortgage tricks and strategies
 *   - Personalized Hebrew negotiation script
 *   - Strategic insights
 */

'use strict';

const offerService = require('../services/offerService');
const reportService = require('../services/reportService');
const logger = require('../utils/logger');

/**
 * GET /api/v1/analysis/:id
 *
 * Fetches the full offer document (including analysis sub-object) from
 * Firestore and returns it. Ownership is enforced via findByIdAndUserId.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 */
exports.getAnalysis = async (req, res) => {
  try {
    const userId  = req.user.id;
    const offerId = req.params.id;

    if (!offerId) {
      return res.status(400).json({ success: false, message: 'Offer ID is required' });
    }

    // Fetch offer and enforce ownership in a single call
    const offer = await offerService.findByIdAndUserId(offerId, userId);
    if (!offer) {
      return res.status(404).json({ success: false, message: 'Offer not found' });
    }

    // Return the full OfferShape so the frontend can render all fields
    return res.status(200).json({
      success: true,
      data: offer,
    });
  } catch (err) {
    logger.error(`analysisController.getAnalysis error: ${err.message}`);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * POST /api/v1/analysis/enhanced/:offerId
 *
 * Generates an enhanced analysis report comparing the user's real bank
 * offer (OCR-extracted) to their selected optimized portfolio model.
 *
 * Requires:
 *   - Authentication (protect middleware)
 *   - Paid access (requirePaidAccess middleware)
 *   - The offer must be in 'analyzed' status (OCR completed)
 *
 * Request body:
 *   {
 *     portfolioId: string,           // Portfolio scenario type
 *     portfolio: {                    // Full portfolio object
 *       id: string,
 *       name: string,
 *       nameHe: string,
 *       termYears: number,
 *       tracks: Array<{ type, percentage, rate, rateDisplay, amount }>,
 *       monthlyRepayment: number,
 *       totalCost: number,
 *       totalInterest: number
 *     }
 *   }
 *
 * Response:
 *   {
 *     success: true,
 *     data: {
 *       offerId: string,
 *       portfolioId: string,
 *       portfolioName: string,
 *       portfolioNameHe: string,
 *       generatedAt: ISO string,
 *       processingTimeMs: number,
 *       comparison: { ... },
 *       tricks: Array<{ nameHe, nameEn, descriptionHe, descriptionEn, potentialSavings, riskLevel, applicability }>,
 *       negotiationScript: string (Hebrew),
 *       insights: Array<{ titleHe, titleEn, bodyHe, bodyEn, icon }>,
 *       summary: string,
 *       summaryHe: string
 *     }
 *   }
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 */
exports.getEnhancedAnalysis = async (req, res) => {
  try {
    const userId  = req.user.id;
    const offerId = req.params.offerId;

    if (!offerId) {
      return res.status(400).json({
        success: false,
        message: 'Offer ID is required',
      });
    }

    const { portfolio } = req.body;

    if (!portfolio) {
      return res.status(400).json({
        success: false,
        message: 'Portfolio data is required in the request body',
      });
    }

    // Generate the enhanced report
    const report = await reportService.generateEnhancedReport(
      offerId,
      userId,
      portfolio
    );

    return res.status(200).json({
      success: true,
      data: report,
    });
  } catch (err) {
    // Handle known error types with appropriate status codes
    if (err.statusCode) {
      return res.status(err.statusCode).json({
        success: false,
        message: err.message,
      });
    }

    logger.error(`analysisController.getEnhancedAnalysis error: ${err.message}`);
    return res.status(500).json({
      success: false,
      message: 'Failed to generate enhanced analysis report',
    });
  }
};
