/**
 * Joi validation middleware factory.
 *
 * Creates an Express middleware that validates `req.body` against
 * the provided Joi schema. On validation failure, returns a 400
 * response with detailed error messages.
 *
 * Usage:
 *   const { validate } = require('../middleware/validate');
 *   const { mySchema } = require('../validators/myValidator');
 *   router.post('/endpoint', validate(mySchema), controller.handler);
 *
 * @module middleware/validate
 */

'use strict';

/**
 * Create a validation middleware for the given Joi schema.
 *
 * @param {import('joi').ObjectSchema} schema - Joi validation schema
 * @param {string} [property='body'] - Request property to validate ('body', 'query', 'params')
 * @returns {import('express').RequestHandler} Express middleware
 */
const validate = (schema, property = 'body') => {
  return (req, res, next) => {
    if (!schema || typeof schema.validate !== 'function') {
      return next();
    }

    const { error, value } = schema.validate(req[property], {
      abortEarly: false,
      stripUnknown: false,
      allowUnknown: true,
    });

    if (error) {
      const details = error.details.map((d) => ({

        field: d.path.join('.'),
        message: d.message,
      }));


      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: details,
      });
    }

    // Replace the request property with the validated (and possibly coerced) value
    req[property] = value;
    next();
  };
};

module.exports = { validate };
