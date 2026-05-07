'use strict';

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

module.exports = { validate };
