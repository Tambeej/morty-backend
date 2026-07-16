'use strict';

const Joi = require('joi');
const { ValidationError } = require('../utils/errors');

/**
 * Creates an Express middleware that validates `req.params`, `req.query`,
 * or `req.body` against a Joi schema.
 *
 * @param {import('joi').Schema} schema - Joi schema to validate against.
 * @param {'body'|'params'|'query'} [source='body'] - Which part of the request to validate.
 * @returns {import('express').RequestHandler}
 */
function validate(schema, source = 'body') {
  return (req, res, next) => {
    const { error, value } = schema.validate(req[source], {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      const details = error.details.map((d) => ({
        field: d.path.join('.'),
        message: d.message,
      }));
      return next(new ValidationError('Validation failed', details));
    }

    // Replace the source with the sanitised value
    req[source] = value;
    return next();
  };
}

// ── Financial profile schemas ─────────────────────────────────────────────────

const debtItemSchema = Joi.object({
  type: Joi.string().trim().max(100).required(),
  amount: Joi.number().min(0).required(),
});

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
  debts: Joi.array().items(debtItemSchema).max(20).default([]),
});

const financialDataSchema = financialSchema;

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
  debts: Joi.array().items(debtItemSchema).max(20),
}).min(1).messages({
  'object.min': 'At least one financial field must be provided',
});

module.exports = {
  validate,
  financialSchema,
  financialDataSchema,
  patchFinancialSchema,
};
