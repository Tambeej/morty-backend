/**
 * Wizard Controller
 *
 * Handles HTTP requests for the public mortgage wizard.
 *
 * Routes:
 *   POST /api/v1/public/wizard/submit – Generate portfolio scenarios
 *
 * Response shape (per architecture contract):
 * {
 *   success: true,
 *   data: {
 *     portfolios: Portfolio[],
 *     communityTips: CommunityTip[],
 *     metadata: {
 *       generatedAt: ISO string,
 *       ratesSource: string,
 *       generationMethod: string,
 *       processingTimeMs: number,
 *       inputSummary: { ... }
 *     }
 *   }
 * }
 *
 * CommunityTip shape:
 * {
 *   type: 'winning_offer' | 'rate_comparison' | 'community_size',
 *   priority: number,
 *   bank?: string,
 *   branch?: string,
 *   messageHe: string,
 *   messageEn: string,
 *   ... (type-specific fields)
 * }
 */

'use strict';

const wizardService = require('../services/wizardService');
const communityService = require('../services/communityService');
const ratesService = require('../services/ratesService');
const { validateBusinessRules } = require('../validators/wizardValidator');
const logger = require('../utils/logger');
const { sendSuccess, sendError } = require('../utils/response');

/**
 * POST /api/v1/public/wizard/submit
 *
 * Receives validated wizard inputs and generates up to 4 mortgage
 * portfolio scenarios using Bank of Israel rates and AI.
 * Also queries the community intelligence engine for hyper-local
 * bank/branch recommendations from similar anonymized profiles.
 *
 * This is a public endpoint (no authentication required).
 * Rate-limited to 5 requests per minute per IP.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 */
exports.submitWizard = async (req, res) => {
  try {
    const { inputs, consent } = req.body;

    // Additional business rule validation beyond Joi schema
    const businessValidation = validateBusinessRules(inputs);
    if (!businessValidation.valid) {
      return sendError(
        res,
        'Validation failed',
        422,
        'BUSINESS_VALIDATION_ERROR',
        businessValidation.errors
      );
    }

    logger.info('wizardController.submitWizard: generating portfolios', {
      propertyPrice: inputs.propertyPrice,
      loanAmount: inputs.loanAmount,
      stabilityPreference: inputs.stabilityPreference,
      consent,
    });

    // Run portfolio generation and community tips in parallel for speed
    const [result, currentRates] = await Promise.all([
      wizardService.generatePortfolios(inputs, consent),
      ratesService.getCurrentAverages().catch((err) => {
        logger.warn(`wizardController: failed to get rates for community tips: ${err.message}`);
        return null;
      }),
    ]);

    if (!result || !result.portfolios || result.portfolios.length === 0) {
      return sendError(
        res,
        'Failed to generate portfolio scenarios. Please try again.',
        500,
        'PORTFOLIO_GENERATION_FAILED'
      );
    }

    // Get community intelligence tips (non-blocking – degrades gracefully)
    let communityTips = [];
    try {
      communityTips = await communityService.getCommunityTips(inputs, currentRates);
    } catch (err) {
      logger.warn(`wizardController.submitWizard: community tips failed: ${err.message}`);
      // Continue without community tips – not critical
    }

    // Store anonymous profile if user consented (fire-and-forget)
    if (consent) {
      communityService.storeAnonymousProfile(inputs).catch((err) => {
        logger.warn(`wizardController.submitWizard: anonymous profile storage failed: ${err.message}`);
      });
    }

    // Build response per architecture contract
    const responseData = {
      portfolios: result.portfolios,
      communityTips,
      metadata: result.metadata,
    };

    return sendSuccess(
      res,
      responseData,
      'Portfolio scenarios generated successfully'
    );
  } catch (err) {
    logger.error(`wizardController.submitWizard error: ${err.message}`);
    return sendError(
      res,
      'An error occurred while generating portfolio scenarios',
      500,
      'WIZARD_SUBMIT_ERROR'
    );
  }
};
