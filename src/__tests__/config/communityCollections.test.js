/**
 * Community Profile Collection – Unit Tests
 *
 * Tests the community_profiles document factory and validator
 * added to the collections module.
 */

'use strict';

const {
  COLLECTIONS,
  createCommunityProfileDocument,
  validateCommunityProfileDocument,
} = require('../../config/collections');

describe('COLLECTIONS', () => {
  it('should include COMMUNITY_PROFILES', () => {
    expect(COLLECTIONS.COMMUNITY_PROFILES).toBe('community_profiles');
  });
});

describe('createCommunityProfileDocument', () => {
  const validParams = {
    profileHash: 'abc123def456',
    incomeBin: 30000,
    loanBin: 1200000,
    ltvBin: 60,
    stabilityBin: 8,
  };

  it('should create a valid document with required fields', () => {
    const doc = createCommunityProfileDocument(validParams);

    expect(doc.profileHash).toBe('abc123def456');
    expect(doc.incomeBin).toBe(30000);
    expect(doc.loanBin).toBe(1200000);
    expect(doc.ltvBin).toBe(60);
    expect(doc.stabilityBin).toBe(8);
    expect(doc.bank).toBeNull();
    expect(doc.branch).toBeNull();
    expect(doc.rates).toBeNull();
    expect(doc.weightedRate).toBeNull();
    expect(doc.consent).toBe(true);
    expect(doc.createdAt).toBeDefined();
    expect(doc.updatedAt).toBeDefined();
  });

  it('should include optional bank/branch/rates when provided', () => {
    const doc = createCommunityProfileDocument({
      ...validParams,
      bank: 'בנק לאומי',
      branch: 'הרצליה',
      rates: { fixed: 4.2, cpi: 2.9 },
      weightedRate: 3.55,
    });

    expect(doc.bank).toBe('בנק לאומי');
    expect(doc.branch).toBe('הרצליה');
    expect(doc.rates).toEqual({ fixed: 4.2, cpi: 2.9 });
    expect(doc.weightedRate).toBe(3.55);
  });

  it('should throw when profileHash is missing', () => {
    expect(() => createCommunityProfileDocument({ ...validParams, profileHash: '' }))
      .toThrow('profileHash is required');
  });

  it('should throw when incomeBin is missing', () => {
    expect(() => createCommunityProfileDocument({ ...validParams, incomeBin: undefined }))
      .toThrow('incomeBin is required');
  });

  it('should throw when loanBin is missing', () => {
    expect(() => createCommunityProfileDocument({ ...validParams, loanBin: null }))
      .toThrow('loanBin is required');
  });

  it('should throw when ltvBin is missing', () => {
    expect(() => createCommunityProfileDocument({ ...validParams, ltvBin: undefined }))
      .toThrow('ltvBin is required');
  });

  it('should throw when stabilityBin is missing', () => {
    expect(() => createCommunityProfileDocument({ ...validParams, stabilityBin: null }))
      .toThrow('stabilityBin is required');
  });
});

describe('validateCommunityProfileDocument', () => {
  const validDoc = {
    profileHash: 'abc123',
    incomeBin: 30000,
    loanBin: 1200000,
    ltvBin: 60,
    stabilityBin: 8,
    consent: true,
    rates: null,
    weightedRate: null,
  };

  it('should validate a correct document', () => {
    const result = validateCommunityProfileDocument(validDoc);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should reject missing profileHash', () => {
    const result = validateCommunityProfileDocument({ ...validDoc, profileHash: '' });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('profileHash must be a non-empty string');
  });

  it('should reject negative incomeBin', () => {
    const result = validateCommunityProfileDocument({ ...validDoc, incomeBin: -1 });
    expect(result.valid).toBe(false);
  });

  it('should reject non-number loanBin', () => {
    const result = validateCommunityProfileDocument({ ...validDoc, loanBin: 'abc' });
    expect(result.valid).toBe(false);
  });

  it('should reject consent !== true', () => {
    const result = validateCommunityProfileDocument({ ...validDoc, consent: false });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('consent must be true');
  });

  it('should reject non-object rates', () => {
    const result = validateCommunityProfileDocument({ ...validDoc, rates: 'invalid' });
    expect(result.valid).toBe(false);
  });

  it('should accept null rates and weightedRate', () => {
    const result = validateCommunityProfileDocument(validDoc);
    expect(result.valid).toBe(true);
  });

  it('should accept valid rates object', () => {
    const result = validateCommunityProfileDocument({
      ...validDoc,
      rates: { fixed: 4.2, cpi: 2.9 },
      weightedRate: 3.55,
    });
    expect(result.valid).toBe(true);
  });
});
