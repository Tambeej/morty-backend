'use strict';

const Joi = require('joi');
const { validate } = require('../middleware/validate');

/**
 * Validates that `:offerId` route parameter is a non-empty string.
 * Firestore document IDs are alphanumeric strings (up to 1500 bytes).
 */
const offerIdParamSchema = Joi.object({
  offerId: Joi.string()
    .trim()
    .min(1)
    .max(128)
    .pattern(/^[a-zA-Z0-9_-]+$/)
    .required()
    .messages({
      'string.empty': 'offerId cannot be empty',
      'string.pattern.base': 'offerId contains invalid characters',
      'any.required': 'offerId is required',
    }),
});

/**
 * Express middleware: validates `req.params.offerId`.
 */
const validateOfferId = validate(offerIdParamSchema, 'params');

module.exports = { validateOfferId, offerIdParamSchema };
