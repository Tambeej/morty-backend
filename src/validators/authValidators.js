/**
 * Joi validation schemas for authentication endpoints.
 */

const Joi = require('joi');

/**
 * Israeli phone number pattern: +972XXXXXXXXX or 05XXXXXXXX
 */
const israeliPhone = Joi.string()
  .pattern(/^(\+972|0)(5[0-9])[0-9]{7}$/)
  .messages({
    'string.pattern.base':
      'Phone must be a valid Israeli number (e.g. +972501234567 or 0501234567).',
  });

/**
 * Schema for POST /auth/register
 *
 * Client obtains `idToken` from firebaseUser.getIdToken() after creating the
 * Firebase Auth account (email/password or Google). `phone` is optional and
 * only stored on brand-new Firestore user documents.
 */
const registerSchema = Joi.object({
  idToken: Joi.string().min(1).required().messages({
    'string.base': 'Firebase ID token must be a string.',
    'string.empty': 'Firebase ID token must not be empty.',
    'string.min': 'Firebase ID token must not be empty.',
    'any.required': 'Firebase ID token is required.',
  }),
  phone: israeliPhone.optional(),
});

/**
 * Schema for POST /auth/google
 *
 * Validates that the Firebase ID token is present and non-empty.
 * The token itself is verified server-side via Firebase Admin SDK.
 */
const googleSchema = Joi.object({
  idToken: Joi.string().min(1).required().messages({
    'string.base': 'Firebase ID token must be a string.',
    'string.empty': 'Firebase ID token must not be empty.',
    'string.min': 'Firebase ID token must not be empty.',
    'any.required': 'Firebase ID token is required.',
  }),
});

module.exports = { registerSchema, googleSchema };
