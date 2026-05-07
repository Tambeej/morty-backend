'use strict';

const offerService = require('../services/offerService');
const portfolioService = require('../services/portfolioService');
const reportService = require('../services/reportService');
const { sendSuccess } = require('../utils/response');
const logger = require('../utils/logger');

/**
 * POST /api/v1/analysis/:offerId/enhanced
 *
 * Generate (or retrieve cached) enhanced AI analysis report for a paid user.
 *
 * Middleware chain: protect → paidAccess → paidEndpointLimiter → validateOfferId
 *
 * Flow:
 * 1. Validate ownership: offerService.findByIdAndUserId(offerId, userId)
 * 2. If enhanced report already exists, return it immediately (idempotent).
 * 3. Fetch user portfolio: portfolioService.getUserPortfolio(userId)
 * 4. Generate report: reportService.generateEnhancedReport(offerId, userId, offer, portfolio)
 * 5. Respond with { success: true, data: enhancedReport }
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function generateEnhancedReport(req, res, next) {
  try {
    const { offerId } = req.params;
    const userId = req.user.uid;

    logger.info('Enhanced report requested', { offerId, userId });

    // 1. Verify offer exists and belongs to the user
    const offer = await offerService.findByIdAndUserId(offerId, userId);

    // 2. Return cached report if it already exists (idempotent)
    if (offer.analysis && offer.analysis.enhanced) {
      logger.info('Returning cached enhanced report', { offerId, userId });
      return sendSuccess(res, offer.analysis.enhanced, 200, 'Enhanced report retrieved from cache');
    }

    // 3. Fetch user's latest portfolio
    const portfolio = await portfolioService.getUserPortfolio(userId);

    // 4. Generate the enhanced report (AI + fallback)
    const enhancedReport = await reportService.generateEnhancedReport(
      offerId,
      userId,
      offer,
      portfolio
    );

    // 5. Respond with the report
    logger.info('Enhanced report generated and returned', {
      offerId,
      userId,
      generatedBy: enhancedReport.generatedBy,
      processingTimeMs: enhancedReport.processingTimeMs,
    });

    return sendSuccess(res, enhancedReport, 201, 'Enhanced report generated successfully');
  } catch (error) {
    next(error);
  }
}

module.exports = { generateEnhancedReport };
