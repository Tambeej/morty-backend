'use strict';

const offerService = require('../services/offerService');
const portfolioService = require('../services/portfolioService');
const reportService = require('../services/reportService');
const { sendSuccess } = require('../utils/response');
const { NotFoundError, ForbiddenError } = require('../utils/errors');
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
 * Response shape (201 for new, 200 for cached):
 * {
 *   success: true,
 *   message: string,
 *   data: {
 *     tricks: Array<{
 *       nameHe: string,
 *       nameEn: string,
 *       descriptionHe: string,
 *       descriptionEn: string,
 *       applicability: 'high'|'medium'|'low',
 *       riskLevel: 'low'|'medium'|'high',
 *       potentialSavings: number|null
 *     }>,
 *     negotiationScript: string,
 *     insights: Array<{
 *       titleHe: string,
 *       titleEn: string,
 *       bodyHe: string,
 *       bodyEn: string,
 *       icon: string
 *     }>,
 *     comparison: {
 *       rateDelta: number|null,
 *       monthlySaving: number|null,
 *       totalSaving: number|null,
 *       loanAmount: number,
 *       termYears: number,
 *       bankRate: number|null,
 *       portfolioRate: number|null,
 *       trackComparison: Array<object>
 *     },
 *     generatedAt: string (ISO 8601),
 *     generatedBy: 'ai'|'rule-based-fallback',
 *     processingTimeMs: number
 *   }
 * }
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

    // 1. Verify offer exists and belongs to the user.
    //    findByIdAndUserId returns null when:
    //      a) The offer document does not exist in Firestore.
    //      b) The offer exists but belongs to a different user.
    //    We perform a two-step check to return the correct HTTP status code.
    const offer = await offerService.findByIdAndUserId(offerId, userId);

    if (!offer) {
      // Distinguish between "not found" and "forbidden" by checking existence
      // without the userId filter. This avoids leaking existence information
      // to unauthorised callers while still returning the correct status code
      // for the authenticated owner.
      const existsForAnyUser = await offerService.findById(offerId);

      if (!existsForAnyUser) {
        throw new NotFoundError(`Offer with ID '${offerId}' not found`);
      }

      // Offer exists but belongs to a different user
      throw new ForbiddenError('You do not have permission to access this offer');
    }

    // 2. Return cached report if it already exists (idempotent).
    //    This prevents duplicate AI calls and ensures consistent results.
    if (offer.analysis && offer.analysis.enhanced) {
      logger.info('Returning cached enhanced report', { offerId, userId });

      const cachedReport = offer.analysis.enhanced;

      return sendSuccess(
        res,
        buildResponseData(cachedReport),
        200,
        'Enhanced report retrieved from cache'
      );
    }

    // 3. Fetch user's latest portfolio (null is acceptable — fallback handles it).
    const portfolio = await portfolioService.getUserPortfolio(userId);

    // 4. Generate the enhanced report (AI + fallback).
    //    reportService stores the result in offer.analysis.enhanced via Firestore.
    const enhancedReport = await reportService.generateEnhancedReport(
      offerId,
      userId,
      offer,
      portfolio
    );

    // 5. Return the full enhanced report data.
    logger.info('Enhanced report generated and returned', {
      offerId,
      userId,
      generatedBy: enhancedReport.generatedBy,
      processingTimeMs: enhancedReport.processingTimeMs,
    });

    return sendSuccess(
      res,
      buildResponseData(enhancedReport),
      201,
      'Enhanced report generated successfully'
    );
  } catch (error) {
    next(error);
  }
}

/**
 * Build the standardised response data object from an enhanced report.
 *
 * Ensures all required fields are present and correctly typed before
 * sending to the client. This acts as a final sanitisation layer
 * regardless of whether the report came from AI, fallback, or cache.
 *
 * @param {object} report - Raw enhanced report from reportService or Firestore.
 * @returns {object} Sanitised response data with all required fields.
 */
function buildResponseData(report) {
  return {
    // Mortgage tricks (3-5 strategies, always includes Enticement Track)
    tricks: Array.isArray(report.tricks) ? report.tricks : [],

    // Word-for-word Hebrew negotiation script
    negotiationScript: typeof report.negotiationScript === 'string'
      ? report.negotiationScript
      : '',

    // Strategic insights explaining the WHY behind recommendations
    insights: Array.isArray(report.insights) ? report.insights : [],

    // Rate/payment comparison between bank offer and user's portfolio model
    comparison: report.comparison && typeof report.comparison === 'object'
      ? {
          rateDelta: report.comparison.rateDelta ?? null,
          monthlySaving: report.comparison.monthlySaving ?? null,
          totalSaving: report.comparison.totalSaving ?? null,
          loanAmount: report.comparison.loanAmount ?? 0,
          termYears: report.comparison.termYears ?? 30,
          bankRate: report.comparison.bankRate ?? null,
          portfolioRate: report.comparison.portfolioRate ?? null,
          trackComparison: Array.isArray(report.comparison.trackComparison)
            ? report.comparison.trackComparison
            : [],
        }
      : {
          rateDelta: null,
          monthlySaving: null,
          totalSaving: null,
          loanAmount: 0,
          termYears: 30,
          bankRate: null,
          portfolioRate: null,
          trackComparison: [],
        },

    // Metadata
    generatedAt: typeof report.generatedAt === 'string'
      ? report.generatedAt
      : new Date().toISOString(),

    generatedBy: typeof report.generatedBy === 'string'
      ? report.generatedBy
      : 'unknown',

    processingTimeMs: typeof report.processingTimeMs === 'number'
      ? report.processingTimeMs
      : 0,
  };
}

module.exports = { generateEnhancedReport, buildResponseData };
