/**
 * Joi validation schemas for Stripe payment endpoints.
 *
 * Validates the request body for the checkout session creation endpoint
 * to ensure required fields are present and well-formed.
 *
 * @module validators/paymentValidator
 */

'use strict';

const Joi = require('joi');

/**
 * Schema for POST /api/v1/stripe/checkout
 *
 * Validates the checkout request body:
 *   - successUrl: Required. Must be a valid URI. This is where Stripe
 *     redirects after successful payment.
 *   - cancelUrl: Optional. URI for cancellation redirect.
 *   - portfolioId: Optional. Links the payment to a specific portfolio.
 */
// MOCK — while payment flow is bypassed, all fields are optional and the
// controller returns a mock session. Tighten this back up when re-enabling
// real Stripe checkout (successUrl should be required + a valid URI).
const checkoutSchema = Joi.object({
  successUrl: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .optional()
    .allow('')
    .messages({
      'string.uri': 'successUrl must be a valid HTTP/HTTPS URL',
    }),
  cancelUrl: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .optional()
    .allow('')
    .messages({
      'string.uri': 'cancelUrl must be a valid HTTP/HTTPS URL',
    }),
  portfolioId: Joi.string()
    .trim()
    .max(200)
    .optional()
    .allow('', null)
    .messages({
      'string.max': 'portfolioId cannot exceed 200 characters',
    }),
});

module.exports = {
  checkoutSchema,
};
