/**
 * Joi validation schemas for analysis endpoints.
 *
 * Validates the request body for the enhanced analysis endpoint
 * to ensure the portfolio data is well-formed before processing.
 */

'use strict';

const Joi = require('joi');

/**
 * Schema for a single portfolio track.
 */
const trackSchema = Joi.object({
  type: Joi.string()
    .valid('fixed', 'cpi', 'prime', 'variable')
    .required()
    .messages({
      'any.only': 'Track type must be one of: fixed, cpi, prime, variable',
      'any.required': 'Track type is required',
    }),
  name: Joi.string().max(200).optional(),
  nameEn: Joi.string().max(200).optional(),
  percentage: Joi.number()
    .min(1)
    .max(100)
    .required()
    .messages({
      'number.min': 'Track percentage must be at least 1%',
      'number.max': 'Track percentage cannot exceed 100%',
      'any.required': 'Track percentage is required',
    }),
  rate: Joi.number()
    .min(0)
    .max(30)
    .required()
    .messages({
      'number.min': 'Track rate cannot be negative',
      'number.max': 'Track rate cannot exceed 30%',
      'any.required': 'Track rate is required',
    }),
  rateDisplay: Joi.string().max(50).optional(),
  amount: Joi.number().min(0).optional(),
  monthlyPayment: Joi.number().min(0).optional(),
  totalCost: Joi.number().min(0).optional(),
  totalInterest: Joi.number().min(0).optional(),
}).options({ allowUnknown: true });

/**
 * Schema for the portfolio object in the enhanced analysis request.
 */
const portfolioSchema = Joi.object({
  id: Joi.string()
    .trim()
    .min(1)
    .max(100)
    .required()
    .messages({
      'string.empty': 'Portfolio ID cannot be empty',
      'any.required': 'Portfolio ID is required',
    }),
  type: Joi.string().max(100).optional(),
  name: Joi.string()
    .trim()
    .min(1)
    .max(200)
    .required()
    .messages({
      'string.empty': 'Portfolio name cannot be empty',
      'any.required': 'Portfolio name is required',
    }),
  nameHe: Joi.string().max(200).optional(),
  description: Joi.string().max(1000).optional(),
  termYears: Joi.number()
    .integer()
    .min(1)
    .max(40)
    .required()
    .messages({
      'number.min': 'Term must be at least 1 year',
      'number.max': 'Term cannot exceed 40 years',
      'any.required': 'Term years is required',
    }),
  tracks: Joi.array()
    .items(trackSchema)
    .min(1)
    .max(10)
    .required()
    .messages({
      'array.min': 'Portfolio must have at least one track',
      'array.max': 'Portfolio cannot have more than 10 tracks',
      'any.required': 'Portfolio tracks are required',
    }),
  monthlyRepayment: Joi.number()
    .min(1)
    .required()
    .messages({
      'number.min': 'Monthly repayment must be positive',
      'any.required': 'Monthly repayment is required',
    }),
  totalCost: Joi.number()
    .min(1)
    .required()
    .messages({
      'number.min': 'Total cost must be positive',
      'any.required': 'Total cost is required',
    }),
  totalInterest: Joi.number()
    .min(0)
    .required()
    .messages({
      'number.min': 'Total interest cannot be negative',
      'any.required': 'Total interest is required',
    }),
  interestSavings: Joi.number().min(0).optional(),
  fitnessScore: Joi.number().min(0).max(100).optional(),
  recommended: Joi.boolean().optional(),
}).options({ allowUnknown: true });

/**
 * Schema for POST /api/v1/analysis/enhanced/:offerId
 *
 * Validates the request body containing the portfolio data
 * to compare against the OCR-extracted bank offer.
 */
const enhancedAnalysisSchema = Joi.object({
  portfolio: portfolioSchema.required().messages({
    'any.required': 'Portfolio data is required',
  }),
  portfolioId: Joi.string().max(100).optional(),
});

module.exports = {
  enhancedAnalysisSchema,
  portfolioSchema,
  trackSchema,
};
