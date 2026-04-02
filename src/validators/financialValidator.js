/**
 * Joi validation schemas for financial data endpoints.
 * Validates all incoming financial profile data before processing.
 */

const Joi = require('joi');

/**
 * Schema for a single debt entry.
 */
const debtSchema = Joi.object({
  type: Joi.string().trim().max(100).required().messages({
    'string.empty': 'Debt type cannot be empty',
    'string.max': 'Debt type must be at most 100 characters',
    'any.required': 'Debt type is required',
  }),
  amount: Joi.number().min(0).required().messages({
    'number.base': 'Debt amount must be a number',
    'number.min': 'Debt amount cannot be negative',
    'any.required': 'Debt amount is required',
  }),
});

/**
 * Schema for updating financial profile.
 * All top-level fields are optional to allow partial updates.
 */
const updateFinancialsSchema = Joi.object({
  income: Joi.number().min(0).messages({
    'number.base': 'Income must be a number',
    'number.min': 'Income cannot be negative',
  }),

  additionalIncome: Joi.number().min(0).messages({
    'number.base': 'Additional income must be a number',
    'number.min': 'Additional income cannot be negative',
  }),

  expenses: Joi.object({
    housing: Joi.number().min(0).messages({
      'number.base': 'Housing expense must be a number',
      'number.min': 'Housing expense cannot be negative',
    }),
    loans: Joi.number().min(0).messages({
      'number.base': 'Loans expense must be a number',
      'number.min': 'Loans expense cannot be negative',
    }),
    other: Joi.number().min(0).messages({
      'number.base': 'Other expense must be a number',
      'number.min': 'Other expense cannot be negative',
    }),
  }),

  assets: Joi.object({
    savings: Joi.number().min(0).messages({
      'number.base': 'Savings must be a number',
      'number.min': 'Savings cannot be negative',
    }),
    investments: Joi.number().min(0).messages({
      'number.base': 'Investments must be a number',
      'number.min': 'Investments cannot be negative',
    }),
  }),

  debts: Joi.array().items(debtSchema).max(20).messages({
    'array.max': 'You can have at most 20 debt entries',
  }),
}).min(1).messages({
  'object.min': 'At least one financial field must be provided',
});

module.exports = {
  updateFinancialsSchema,
};
