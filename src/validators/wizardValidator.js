/**
 * Joi validation schemas for the public wizard endpoint.
 *
 * Validates the 6-step wizard inputs:
 *   1. propertyPrice  – Total property purchase price (₪)
 *   2. loanAmount     – Requested mortgage loan amount (₪)
 *   3. monthlyIncome  – Combined net monthly income (₪)
 *   4. targetRepayment – Desired monthly repayment (₪)
 *   5. futureFunds    – Expected future lump-sum funds
 *   6. stabilityPreference – Risk/stability slider (1-10)
 *
 * Also validates the consent flag for anonymous data storage.
 */

'use strict';

const Joi = require('joi');

/**
 * Schema for the future funds object.
 * "none" means no expected future funds.
 * Otherwise, a timeframe and optional amount are provided.
 */
const futureFundsSchema = Joi.object({
  timeframe: Joi.string()
    .valid('none', 'within_5_years', 'within_10_years', 'over_10_years')
    .required()
    .messages({
      'any.only': 'timeframe must be one of: none, within_5_years, within_10_years, over_10_years',
      'any.required': 'Future funds timeframe is required',
    }),
  amount: Joi.number()
    .min(0)
    .max(50000000)
    .when('timeframe', {
      is: 'none',
      then: Joi.optional().default(0),
      otherwise: Joi.optional().default(0),
    })
    .messages({
      'number.base': 'Future funds amount must be a number',
      'number.min': 'Future funds amount cannot be negative',
      'number.max': 'Future funds amount exceeds maximum allowed value',
    }),
});

/**
 * Main wizard submission schema.
 *
 * Validates the complete wizard input payload.
 * All monetary values are in Israeli Shekels (₪).
 */
const wizardSubmitSchema = Joi.object({
  inputs: Joi.object({
    propertyPrice: Joi.number()
      .min(100000)
      .max(50000000)
      .required()
      .messages({
        'number.base': 'Property price must be a number',
        'number.min': 'Property price must be at least ₪100,000',
        'number.max': 'Property price cannot exceed ₪50,000,000',
        'any.required': 'Property price is required',
      }),

    loanAmount: Joi.number()
      .min(50000)
      .max(50000000)
      .required()
      .messages({
        'number.base': 'Loan amount must be a number',
        'number.min': 'Loan amount must be at least ₪50,000',
        'number.max': 'Loan amount cannot exceed ₪50,000,000',
        'any.required': 'Loan amount is required',
      }),

    monthlyIncome: Joi.number()
      .min(1000)
      .max(1000000)
      .required()
      .messages({
        'number.base': 'Monthly income must be a number',
        'number.min': 'Monthly income must be at least ₪1,000',
        'number.max': 'Monthly income cannot exceed ₪1,000,000',
        'any.required': 'Monthly income is required',
      }),

    additionalIncome: Joi.number()
      .min(0)
      .max(1000000)
      .optional()
      .default(0)
      .messages({
        'number.base': 'Additional income must be a number',
        'number.min': 'Additional income cannot be negative',
        'number.max': 'Additional income cannot exceed ₪1,000,000',
      }),

    targetRepayment: Joi.number()
      .min(500)
      .max(100000)
      .required()
      .messages({
        'number.base': 'Target repayment must be a number',
        'number.min': 'Target repayment must be at least ₪500',
        'number.max': 'Target repayment cannot exceed ₪100,000',
        'any.required': 'Target repayment is required',
      }),

    futureFunds: futureFundsSchema.required().messages({
      'any.required': 'Future funds information is required',
    }),

    stabilityPreference: Joi.number()
      .integer()
      .min(1)
      .max(10)
      .required()
      .messages({
        'number.base': 'Stability preference must be a number',
        'number.integer': 'Stability preference must be a whole number',
        'number.min': 'Stability preference must be between 1 and 10',
        'number.max': 'Stability preference must be between 1 and 10',
        'any.required': 'Stability preference is required',
      }),
  }).required().messages({
    'any.required': 'Wizard inputs are required',
  }),

  consent: Joi.boolean()
    .required()
    .messages({
      'boolean.base': 'Consent must be a boolean value',
      'any.required': 'Consent flag is required',
    }),
});

/**
 * Custom validation: loanAmount must not exceed propertyPrice.
 * Applied as a post-validation check in the controller.
 *
 * @param {object} inputs - Validated wizard inputs
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateBusinessRules(inputs) {
  const errors = [];

  if (inputs.loanAmount > inputs.propertyPrice) {
    errors.push('Loan amount cannot exceed property price');
  }

  // LTV check (informational, not blocking)
  const ltv = (inputs.loanAmount / inputs.propertyPrice) * 100;
  if (ltv > 75) {
    // Not an error, but we note it for the response
  }

  // Repayment-to-income ratio sanity check
  const totalIncome = inputs.monthlyIncome + (inputs.additionalIncome || 0);
  if (inputs.targetRepayment > totalIncome * 0.8) {
    errors.push('Target repayment exceeds 80% of total income – this is unrealistic');
  }

  return { valid: errors.length === 0, errors };
}

module.exports = {
  wizardSubmitSchema,
  futureFundsSchema,
  validateBusinessRules,
};
