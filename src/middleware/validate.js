/**
 * Validation Middleware
 * Joi-based request validation
 */

const Joi = require('joi');
const { ValidationError } = require('../utils/errors');

/**
 * Create validation middleware for a given Joi schema
 * @param {Object} schema - Joi validation schema
 * @param {string} source - Request property to validate ('body', 'query', 'params')
 * @returns {Function} Express middleware
 */
const validate = (schema, source) => {
  const src = source || 'body';
  return (req, res, next) => {
    const { error, value } = schema.validate(req[src], {
      abortEarly: false,
      stripUnknown: true,
      convert: true,
    });

    if (error) {
      const details = error.details.map((d) => ({
        field: d.path.join('.'),
        message: d.message.replace(/"/g, ''),
      }));

      return next(new ValidationError('Validation failed', details));
    }

    req[src] = value;
    next();
  };
};

// ─── Validation Schemas ──────────────────────────────────────────────────────

const schemas = {
  register: Joi.object({
    email: Joi.string().email().lowercase().trim().required(),
    password: Joi.string().min(8).max(128).required(),
    phone: Joi.string()
      .pattern(/^(\+972|0)[0-9]{8,9}$/)
      .optional()
      .allow(''),
  }),

  login: Joi.object({
    email: Joi.string().email().lowercase().trim().required(),
    password: Joi.string().required(),
  }),

  refreshToken: Joi.object({
    refreshToken: Joi.string().required(),
  }),

  financials: Joi.object({
    income: Joi.number().min(0).max(10000000).required(),
    expenses: Joi.object({
      housing: Joi.number().min(0).max(1000000).default(0),
      loans: Joi.number().min(0).max(1000000).default(0),
      other: Joi.number().min(0).max(1000000).default(0),
    }).default({}),
    assets: Joi.object({
      savings: Joi.number().min(0).max(100000000).default(0),
      investments: Joi.number().min(0).max(100000000).default(0),
    }).default({}),
    debts: Joi.array()
      .items(
        Joi.object({
          type: Joi.string().max(100).required(),
          amount: Joi.number().min(0).required(),
        })
      )
      .default([]),
  }),

  pagination: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(10),
    status: Joi.string().valid('pending', 'analyzed', 'error').optional(),
  }),
};

module.exports = { validate, schemas };
