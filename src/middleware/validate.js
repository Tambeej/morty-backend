/**
 * Request Validation Middleware
 *
 * Factory function that returns an Express middleware which validates
 * req.body (or req.query / req.params) against a Joi schema.
 *
 * Usage:
 *   router.post('/register', validate(registerSchema), authController.register);
 */

'use strict';

const { ValidationError } = require('../utils/errors');

/**
 * @param {import('joi').Schema} schema - Joi schema to validate against
 * @param {'body'|'query'|'params'} [source='body'] - Request property to validate
 * @returns {import('express').RequestHandler}
 */
const validate = (schema, source = 'body') => (req, _res, next) => {
  const { error, value } = schema.validate(req[source], {
    abortEarly: false,   // collect all errors, not just the first
    stripUnknown: true,  // remove unknown keys (security)
    convert: true,       // coerce types where possible
  });

  if (error) {
    const details = error.details.map((d) => ({
      field: d.path.join('.'),
      message: d.message.replace(/"/g, "'"),
    }));
    return next(new ValidationError('Validation failed', details));
  }

  // Replace req[source] with the sanitised/coerced value
  req[source] = value;
  next();
};

module.exports = { validate };
