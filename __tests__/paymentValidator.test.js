/**
 * Payment Validator Tests
 *
 * Tests for Joi validation schemas used by Stripe payment endpoints.
 */

'use strict';

const { checkoutSchema } = require('../src/validators/paymentValidator');

describe('paymentValidator', () => {
  describe('checkoutSchema', () => {
    it('should validate a complete valid request', () => {
      const { error } = checkoutSchema.validate({
        successUrl: 'https://morty.app/success',
        cancelUrl: 'https://morty.app/cancel',
        portfolioId: 'market_standard',
      });
      expect(error).toBeUndefined();
    });

    it('should validate with only required fields', () => {
      const { error } = checkoutSchema.validate({
        successUrl: 'https://morty.app/success',
      });
      expect(error).toBeUndefined();
    });

    it('should reject missing successUrl', () => {
      const { error } = checkoutSchema.validate({});
      expect(error).toBeDefined();
      expect(error.details[0].path).toContain('successUrl');
    });

    it('should reject invalid successUrl (not a URL)', () => {
      const { error } = checkoutSchema.validate({
        successUrl: 'not-a-url',
      });
      expect(error).toBeDefined();
    });

    it('should reject non-HTTP/HTTPS successUrl', () => {
      const { error } = checkoutSchema.validate({
        successUrl: 'ftp://morty.app/success',
      });
      expect(error).toBeDefined();
    });

    it('should accept HTTP successUrl (for development)', () => {
      const { error } = checkoutSchema.validate({
        successUrl: 'http://localhost:3000/success',
      });
      expect(error).toBeUndefined();
    });

    it('should accept empty cancelUrl', () => {
      const { error } = checkoutSchema.validate({
        successUrl: 'https://morty.app/success',
        cancelUrl: '',
      });
      expect(error).toBeUndefined();
    });

    it('should reject invalid cancelUrl', () => {
      const { error } = checkoutSchema.validate({
        successUrl: 'https://morty.app/success',
        cancelUrl: 'not-a-url',
      });
      expect(error).toBeDefined();
    });

    it('should accept empty portfolioId', () => {
      const { error } = checkoutSchema.validate({
        successUrl: 'https://morty.app/success',
        portfolioId: '',
      });
      expect(error).toBeUndefined();
    });

    it('should reject portfolioId exceeding max length', () => {
      const { error } = checkoutSchema.validate({
        successUrl: 'https://morty.app/success',
        portfolioId: 'x'.repeat(201),
      });
      expect(error).toBeDefined();
    });
  });
});
