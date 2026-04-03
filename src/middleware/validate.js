/**
 * Joi validation middleware
 *
 * Exports individual schemas and a validate() middleware factory.
 * All schemas are used via the validate() factory which returns a
 * standard 422 response on validation failure.
 */

'use strict';

const Joi = require('joi');

// ── Middleware factory ────────────────────────────────────────────────────────

/**
 * Middleware factory: validates req.body against the given Joi schema.
 * Returns 422 with error details on failure.
 *
 * @param {Joi.Schema} schema - Joi schema to validate against
 * @returns {import('express').RequestHandler}
 */
const validate = (schema) => (req, res, next) => {
  const { error, value } = schema.validate(req.body, {
    abortEarly: false,
    stripUnknown: true,
    // Allow empty objects (defaults will be applied by the schema)
    allowUnknown: false,
  });

  if (error) {
    const details = error.details.map((d) => ({
      field: d.path.join('.'),
      message: d.message,
    }));
    return res.status(422).json({
      success: false,
      message: 'Validation failed',
      errors: details,
    });
  }

  req.body = value;
  next();
};

// ── Auth schemas ──────────────────────────────────────────────────────────────

const registerSchema = Joi.object({
  email: Joi.string().email().lowercase().required(),
  password: Joi.string().min(8).required(),
  phone: Joi.string()
    .pattern(/^(\+972|0)[0-9]{8,9}$/)
    .optional()
    .allow(''),
});

const loginSchema = Joi.object({
  email: Joi.string().email().lowercase().required(),
  password: Joi.string().required(),
});

const refreshSchema = Joi.object({
  refreshToken: Joi.string().required(),
});

// ── Financial profile schemas ─────────────────────────────────────────────────

/**
 * Shared debt item schema used in both full and partial financial schemas.
 */
const debtItemSchema = Joi.object({
  type: Joi.string().trim().max(100).required(),
  amount: Joi.number().min(0).required(),
});

/**
 * Full financial profile schema (used for PUT – upsert).
 *
 * All top-level fields are optional; missing fields default to 0 / [].
 * This allows clients to send an empty body `{}` and receive a zeroed
 * profile back (useful for initialising a new profile).
 */
const financialSchema = Joi.object({
  income: Joi.number().min(0).default(0),
  additionalIncome: Joi.number().min(0).default(0),
  expenses: Joi.object({
    housing: Joi.number().min(0).default(0),
    loans: Joi.number().min(0).default(0),
    other: Joi.number().min(0).default(0),
  }).default({ housing: 0, loans: 0, other: 0 }),
  assets: Joi.object({
    savings: Joi.number().min(0).default(0),
    investments: Joi.number().min(0).default(0),
  }).default({ savings: 0, investments: 0 }),
  debts: Joi.array().items(debtItemSchema).default([]),
});

/**
 * Partial financial profile schema (used for PATCH – partial update).
 *
 * At least one field must be provided.
 * No defaults are applied so that only explicitly sent fields are updated.
 */
const patchFinancialSchema = Joi.object({
  income: Joi.number().min(0),
  additionalIncome: Joi.number().min(0),
  expenses: Joi.object({
    housing: Joi.number().min(0),
    loans: Joi.number().min(0),
    other: Joi.number().min(0),
  }),
  assets: Joi.object({
    savings: Joi.number().min(0),
    investments: Joi.number().min(0),
  }),
  debts: Joi.array().items(debtItemSchema),
}).min(1).messages({
  'object.min': 'At least one financial field must be provided',
});

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  validate,
  registerSchema,
  loginSchema,
  refreshSchema,
  financialSchema,
  patchFinancialSchema,
};
