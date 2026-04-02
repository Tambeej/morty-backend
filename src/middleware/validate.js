/**
 * Joi Validation Middleware
 * Validates request body against a provided Joi schema.
 */

const { AppError } = require('../utils/errors');

/**
 * Returns an Express middleware that validates req.body against the given Joi schema.
 *
 * @param {import('joi').Schema} schema - Joi schema to validate against
 * @returns {import('express').RequestHandler}
 */
function validate(schema) {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false,   // collect all errors
      stripUnknown: true,  // remove unknown fields
      convert: true,       // coerce types where possible
    });

    if (error) {
      const messages = error.details.map((d) => d.message).join('; ');
      return next(new AppError(messages, 422));
    }

    // Replace req.body with the sanitised/coerced value
    req.body = value;
    return next();
  };
}

module.exports = { validate };
