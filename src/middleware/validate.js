/**
 * Validation Middleware
 * Joi-based request validation for all API endpoints.
 * Provides consistent error formatting for validation failures.
 */

const Joi = require('joi');
const { AppError } = require('../utils/errors');

/**
 * Generic validation factory.
 * Creates a middleware that validates req.body against a Joi schema.
 *
 * @param {Object} schema - Joi schema object
 * @returns {Function} Express middleware
 */
const validate = (schema) => (req, res, next) => {
  const { error, value } = schema.validate(req.body, {
    abortEarly: false, // Return all errors, not just the first
    stripUnknown: true, // Remove unknown fields
    convert: true, // Type coercion (e.g., string '123' → number 123)
  });

  if (error) {
    const details = error.details.map((d) => ({
      field: d.path.join('.'),
      message: d.message.replace(/"/g, ''),
    }));
    return next(new AppError('Validation failed', 422, details));
  }

  // Replace req.body with sanitized/coerced values
  req.body = value;
  next();
};

// ─── Auth Schemas ────────────────────────────────────────────────────────────

/**
 * POST /api/v1/auth/register
 */
const registerSchema = Joi.object({
  email: Joi.string().email().lowercase().trim().required().messages({
    'string.email': 'Please provide a valid email address',
    'any.required': 'Email is required',
  }),
  password: Joi.string().min(8).max(128).required().messages({
    'string.min': 'Password must be at least 8 characters',
    'any.required': 'Password is required',
  }),
  phone: Joi.string()
    .pattern(/^(\+972|0)[0-9]{8,9}$/)
    .optional()
    .messages({
      'string.pattern.base': 'Phone must be a valid Israeli number (e.g., +972501234567 or 0501234567)',
    }),
});

/**
 * POST /api/v1/auth/login
 */
const loginSchema = Joi.object({
  email: Joi.string().email().lowercase().trim().required().messages({
    'string.email': 'Please provide a valid email address',
    'any.required': 'Email is required',
  }),
  password: Joi.string().required().messages({
    'any.required': 'Password is required',
  }),
});

// ─── Financial Profile Schemas ────────────────────────────────────────────────

/**
 * PUT /api/v1/profile/financials
 */
const financialsSchema = Joi.object({
  income: Joi.number().min(0).max(10000000).required().messages({
    'number.min': 'Income cannot be negative',
    'any.required': 'Monthly income is required',
  }),
  expenses: Joi.object({
    housing: Joi.number().min(0).max(10000000).default(0),
    loans: Joi.number().min(0).max(10000000).default(0),
    other: Joi.number().min(0).max(10000000).default(0),
  }).default({}),
  assets: Joi.object({
    savings: Joi.number().min(0).max(100000000).default(0),
    investments: Joi.number().min(0).max(100000000).default(0),
  }).default({}),
  debts: Joi.array()
    .items(
      Joi.object({
        type: Joi.string().trim().max(100).required(),
        amount: Joi.number().min(0).max(100000000).required(),
      })
    )
    .max(20)
    .default([]),
});

// ─── Offer Upload Schema ──────────────────────────────────────────────────────

/**
 * POST /api/v1/offers
 * Validates optional body fields alongside the file upload.
 * The file itself is validated by Multer middleware.
 */
const offerUploadSchema = Joi.object({
  bankName: Joi.string().trim().max(100).optional().allow('').messages({
    'string.max': 'Bank name cannot exceed 100 characters',
  }),
});

// ─── Exported Middleware ──────────────────────────────────────────────────────

module.exports = {
  validateRegister: validate(registerSchema),
  validateLogin: validate(loginSchema),
  validateFinancials: validate(financialsSchema),
  validateOfferUpload: validate(offerUploadSchema),
};
