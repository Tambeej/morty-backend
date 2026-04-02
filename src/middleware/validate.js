/**
 * Validation middleware using Joi schemas.
 * Provides request body, params, and query validation
 * with consistent error formatting.
 */

const Joi = require('joi');
const { ValidationError } = require('../utils/errors');

/**
 * Israeli phone number regex pattern.
 * Supports formats: +972-XX-XXXXXXX, 05X-XXXXXXX, 05XXXXXXXX
 */
const ISRAELI_PHONE_REGEX = /^(\+972|0)(5[0-9])([-]?)(\d{7})$/;

/**
 * Password strength regex.
 * Requires: min 8 chars, at least 1 uppercase, 1 lowercase, 1 digit.
 */
const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;

// ─────────────────────────────────────────────
// Reusable field schemas
// ─────────────────────────────────────────────

const emailSchema = Joi.string()
  .email({ tlds: { allow: false } })
  .lowercase()
  .trim()
  .max(254)
  .required()
  .messages({
    'string.email': 'Please provide a valid email address',
    'string.max': 'Email must not exceed 254 characters',
    'any.required': 'Email is required',
  });

const passwordSchema = Joi.string()
  .min(8)
  .max(128)
  .pattern(PASSWORD_REGEX)
  .required()
  .messages({
    'string.min': 'Password must be at least 8 characters',
    'string.max': 'Password must not exceed 128 characters',
    'string.pattern.base':
      'Password must contain at least one uppercase letter, one lowercase letter, and one digit',
    'any.required': 'Password is required',
  });

const phoneSchema = Joi.string()
  .pattern(ISRAELI_PHONE_REGEX)
  .optional()
  .allow('')
  .messages({
    'string.pattern.base': 'Please provide a valid Israeli phone number (e.g., 050-1234567)',
  });

const positiveNumberSchema = (label) =>
  Joi.number().min(0).max(100_000_000).optional().default(0).messages({
    'number.min': `${label} must be a non-negative number`,
    'number.max': `${label} must not exceed 100,000,000`,
    'number.base': `${label} must be a valid number`,
  });

const mongoIdSchema = Joi.string()
  .pattern(/^[0-9a-fA-F]{24}$/)
  .required()
  .messages({
    'string.pattern.base': 'Invalid ID format',
    'any.required': 'ID is required',
  });

// ─────────────────────────────────────────────
// Auth schemas
// ─────────────────────────────────────────────

/**
 * Schema for POST /api/v1/auth/register
 */
const registerSchema = Joi.object({
  email: emailSchema,
  password: passwordSchema,
  phone: phoneSchema,
  name: Joi.string().trim().min(2).max(100).optional().messages({
    'string.min': 'Name must be at least 2 characters',
    'string.max': 'Name must not exceed 100 characters',
  }),
});

/**
 * Schema for POST /api/v1/auth/login
 */
const loginSchema = Joi.object({
  email: emailSchema,
  password: Joi.string().required().messages({
    'any.required': 'Password is required',
  }),
});

/**
 * Schema for POST /api/v1/auth/refresh
 */
const refreshTokenSchema = Joi.object({
  refreshToken: Joi.string().required().messages({
    'any.required': 'Refresh token is required',
  }),
});

/**
 * Schema for POST /api/v1/auth/logout
 */
const logoutSchema = Joi.object({
  refreshToken: Joi.string().optional(),
});

// ─────────────────────────────────────────────
// Financial data schemas
// ─────────────────────────────────────────────

/**
 * Schema for PUT /api/v1/profile/financials
 */
const financialDataSchema = Joi.object({
  income: positiveNumberSchema('Monthly income'),
  expenses: Joi.object({
    housing: positiveNumberSchema('Housing expenses'),
    loans: positiveNumberSchema('Loan expenses'),
    other: positiveNumberSchema('Other expenses'),
  }).optional().default({}),
  assets: Joi.object({
    savings: positiveNumberSchema('Savings'),
    investments: positiveNumberSchema('Investments'),
  }).optional().default({}),
  debts: Joi.array()
    .items(
      Joi.object({
        type: Joi.string().trim().max(100).required().messages({
          'any.required': 'Debt type is required',
          'string.max': 'Debt type must not exceed 100 characters',
        }),
        amount: Joi.number().min(0).max(100_000_000).required().messages({
          'any.required': 'Debt amount is required',
          'number.min': 'Debt amount must be non-negative',
        }),
      })
    )
    .max(20)
    .optional()
    .default([])
    .messages({
      'array.max': 'Cannot have more than 20 debt entries',
    }),
});

// ─────────────────────────────────────────────
// Offer schemas
// ─────────────────────────────────────────────

/**
 * Schema for POST /api/v1/offers (multipart metadata)
 */
const offerUploadSchema = Joi.object({
  bankName: Joi.string().trim().max(100).optional().messages({
    'string.max': 'Bank name must not exceed 100 characters',
  }),
  notes: Joi.string().trim().max(500).optional().allow('').messages({
    'string.max': 'Notes must not exceed 500 characters',
  }),
});

/**
 * Schema for GET /api/v1/analysis/:id params
 */
const offerIdParamSchema = Joi.object({
  id: mongoIdSchema,
});

/**
 * Schema for pagination query params
 */
const paginationSchema = Joi.object({
  page: Joi.number().integer().min(1).default(1).messages({
    'number.min': 'Page must be at least 1',
    'number.integer': 'Page must be an integer',
  }),
  limit: Joi.number().integer().min(1).max(100).default(10).messages({
    'number.min': 'Limit must be at least 1',
    'number.max': 'Limit must not exceed 100',
    'number.integer': 'Limit must be an integer',
  }),
});

// ─────────────────────────────────────────────
// Middleware factory
// ─────────────────────────────────────────────

/**
 * Create a validation middleware for a given Joi schema.
 * Validates the specified part of the request (body, params, query).
 *
 * @param {Joi.Schema} schema - Joi validation schema
 * @param {'body'|'params'|'query'} [source='body'] - Request part to validate
 * @returns {Function} Express middleware function
 *
 * @example
 * router.post('/register', validate(registerSchema), authController.register);
 * router.get('/:id', validate(offerIdParamSchema, 'params'), controller.getById);
 */
const validate = (schema, source = 'body') => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req[source], {
      abortEarly: false, // Collect all errors, not just the first
      stripUnknown: true, // Remove unknown fields
      convert: true, // Type coercion (string '1' → number 1)
    });

    if (error) {
      const details = error.details.map((detail) => ({
        field: detail.path.join('.'),
        message: detail.message.replace(/"/g, ''),
      }));

      return next(new ValidationError('Validation failed', details));
    }

    // Replace request data with validated (and sanitized) value
    req[source] = value;
    return next();
  };
};

/**
 * Validate multiple sources at once.
 *
 * @param {Object} schemas - Object with keys 'body', 'params', 'query'
 * @returns {Function} Express middleware function
 *
 * @example
 * router.get('/:id', validateMultiple({ params: idSchema, query: paginationSchema }), handler);
 */
const validateMultiple = (schemas) => {
  return (req, res, next) => {
    const errors = [];

    for (const [source, schema] of Object.entries(schemas)) {
      const { error, value } = schema.validate(req[source], {
        abortEarly: false,
        stripUnknown: true,
        convert: true,
      });

      if (error) {
        errors.push(
          ...error.details.map((detail) => ({
            source,
            field: detail.path.join('.'),
            message: detail.message.replace(/"/g, ''),
          }))
        );
      } else {
        req[source] = value;
      }
    }

    if (errors.length > 0) {
      return next(new ValidationError('Validation failed', errors));
    }

    return next();
  };
};

module.exports = {
  // Schemas
  registerSchema,
  loginSchema,
  refreshTokenSchema,
  logoutSchema,
  financialDataSchema,
  offerUploadSchema,
  offerIdParamSchema,
  paginationSchema,
  // Middleware factories
  validate,
  validateMultiple,
  // Reusable field schemas
  emailSchema,
  passwordSchema,
  phoneSchema,
  mongoIdSchema,
};
