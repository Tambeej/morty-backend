'use strict';

/**
 * Unit tests for analysisValidator.
 */

const { offerIdParamSchema } = require('../src/validators/analysisValidator');

describe('offerIdParamSchema', () => {
  const validate = (offerId) =>
    offerIdParamSchema.validate({ offerId }, { abortEarly: false });

  it('should accept a valid alphanumeric offerId', () => {
    const { error } = validate('offer123abc');
    expect(error).toBeUndefined();
  });

  it('should accept offerId with hyphens and underscores', () => {
    const { error } = validate('offer-123_abc');
    expect(error).toBeUndefined();
  });

  it('should reject an empty offerId', () => {
    const { error } = validate('');
    expect(error).toBeDefined();
  });

  it('should reject offerId with special characters', () => {
    const { error } = validate('offer!@#$%');
    expect(error).toBeDefined();
    expect(error.details[0].message).toContain('invalid characters');
  });

  it('should reject offerId with spaces', () => {
    const { error } = validate('offer 123');
    expect(error).toBeDefined();
  });

  it('should reject offerId longer than 128 characters', () => {
    const { error } = validate('a'.repeat(129));
    expect(error).toBeDefined();
  });

  it('should accept offerId of exactly 128 characters', () => {
    const { error } = validate('a'.repeat(128));
    expect(error).toBeUndefined();
  });

  it('should reject missing offerId', () => {
    const { error } = offerIdParamSchema.validate({});
    expect(error).toBeDefined();
  });
});
