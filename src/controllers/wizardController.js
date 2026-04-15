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
 *     communityTips: [],
 *     metadata: {
 *       generatedAt: ISO string,
 *       ratesSource: string,
 *       generationMethod: string,
 *       processingTimeMs: number,
 *       inputSummary: { ... }
 *     }
 *   }
 * }
 */

'use strict';

const wizardService = require('../services/wizardService');
const { validateBusinessRules } = require('../validators/wizardValidator');
const logger = require('../utils/logger');
const { sendSuccess, sendError } = require('../utils/response');

/**
 * POST /api/v1/public/wizard/submit
 *
 * Receives validated wizard inputs and generates up to 4 mortgage
 * portfolio scenarios using Bank of Israel rates and AI.
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

    // Generate portfolios
    const result = await wizardService.generatePortfolios(inputs, consent);

    if (!result || !result.portfolios || result.portfolios.length === 0) {
      return sendError(
        res,
        'Failed to generate portfolio scenarios. Please try again.',
        500,
        'PORTFOLIO_GENERATION_FAILED'
      );
    }

    // Build response per architecture contract
    const responseData = {
      portfolios: result.portfolios,
      communityTips: [], // Populated by community service in a future task
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
