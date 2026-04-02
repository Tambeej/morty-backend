/**
 * Joi validation middleware
 * Exports individual schemas and a validate() middleware factory
 */
const Joi = require('joi');

/**
 * Middleware factory: validates req.body against the given Joi schema.
 * Returns 422 with error details on failure.
 */
const validate = (schema) => (req, res, next) => {
  const { error, value } = schema.validate(req.body, { abortEarly: false, stripUnknown: true });
  if (error) {
    const details = error.details.map((d) => ({ field: d.path.join('.'), message: d.message }));
    return res.status(422).json({ success: false, message: 'Validation failed', errors: details });
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

// ── Financial profile schema ──────────────────────────────────────────────────

const financialSchema = Joi.object({
  income: Joi.number().min(0).required(),
  additionalIncome: Joi.number().min(0).default(0),
  expenses: Joi.object({
    housing: Joi.number().min(0).default(0),
    loans: Joi.number().min(0).default(0),
    other: Joi.number().min(0).default(0),
  }).default(),
  assets: Joi.object({
    savings: Joi.number().min(0).default(0),
    investments: Joi.number().min(0).default(0),
  }).default(),
  debts: Joi.array()
    .items(
      Joi.object({
        type: Joi.string().required(),
        amount: Joi.number().min(0).required(),
      })
    )
    .default([]),
});

module.exports = {
  validate,
  registerSchema,
  loginSchema,
  refreshSchema,
  financialSchema,
};
