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
 */
const registerSchema = Joi.object({
  email: Joi.string().email({ tlds: { allow: false } }).required().messages({
    'string.email': 'Please provide a valid email address.',
    'any.required': 'Email is required.',
  }),
  password: Joi.string()
    .min(8)
    .max(128)
    .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]).+$/)
    .required()
    .messages({
      'string.min': 'Password must be at least 8 characters.',
      'string.max': 'Password must not exceed 128 characters.',
      'string.pattern.base':
        'Password must contain at least one uppercase letter, one lowercase letter, one digit, and one special character.',
      'any.required': 'Password is required.',
    }),
  phone: israeliPhone.optional(),
});

/**
 * Schema for POST /auth/login
 */
const loginSchema = Joi.object({
  email: Joi.string().email({ tlds: { allow: false } }).required().messages({
    'string.email': 'Please provide a valid email address.',
    'any.required': 'Email is required.',
  }),
  password: Joi.string().required().messages({
    'any.required': 'Password is required.',
  }),
});

/**
 * Schema for POST /auth/refresh
 */
const refreshTokenSchema = Joi.object({
  refreshToken: Joi.string().required().messages({
    'any.required': 'Refresh token is required.',
  }),
});

module.exports = { registerSchema, loginSchema, refreshTokenSchema };
