/**
 * Firestore Collections Design Tests
 *
 * Verifies collection constants, document factories, field validators,
 * and index definitions exported from src/config/collections.js.
 */

'use strict';

const {
  COLLECTIONS,
  OFFER_STATUS,
  OFFER_STATUS_VALUES,
  createUserDocument,
  createFinancialDocument,
  createOfferDocument,
  validateUserDocument,
  validateFinancialDocument,
  validateOfferDocument,
  INDEX_DEFINITIONS,
  FIRESTORE_INDEXES,
} = require('../../config/collections');

// ─── Collection Constants ────────────────────────────────────────────────────

describe('COLLECTIONS', () => {
  it('defines the three required collection names', () => {
    expect(COLLECTIONS.USERS).toBe('users');
    expect(COLLECTIONS.FINANCIALS).toBe('financials');
    expect(COLLECTIONS.OFFERS).toBe('offers');
  });

  it('is frozen (immutable)', () => {
    expect(Object.isFrozen(COLLECTIONS)).toBe(true);
  });
});

// ─── Offer Status Enum ───────────────────────────────────────────────────────

describe('OFFER_STATUS', () => {
  it('defines pending, analyzed, and error statuses', () => {
    expect(OFFER_STATUS.PENDING).toBe('pending');
    expect(OFFER_STATUS.ANALYZED).toBe('analyzed');
    expect(OFFER_STATUS.ERROR).toBe('error');
  });

  it('is frozen (immutable)', () => {
    expect(Object.isFrozen(OFFER_STATUS)).toBe(true);
  });

  it('OFFER_STATUS_VALUES contains all status strings', () => {
    expect(OFFER_STATUS_VALUES).toContain('pending');
    expect(OFFER_STATUS_VALUES).toContain('analyzed');
    expect(OFFER_STATUS_VALUES).toContain('error');
    expect(OFFER_STATUS_VALUES).toHaveLength(3);
  });
});

// ─── createUserDocument ──────────────────────────────────────────────────────

describe('createUserDocument', () => {
  const validParams = {
    id: 'user-abc123',
    email: 'Test@Example.com',
    password: '$2b$10$hashedpassword',
  };

  it('creates a valid user document with required fields', () => {
    const doc = createUserDocument(validParams);
    expect(doc.id).toBe('user-abc123');
    expect(doc.email).toBe('test@example.com'); // lowercased
    expect(doc.password).toBe('$2b$10$hashedpassword');
  });

  it('sets default values for optional fields', () => {
    const doc = createUserDocument(validParams);
    expect(doc.phone).toBe('');
    expect(doc.verified).toBe(false);
    expect(doc.refreshToken).toBeNull();
  });

  it('includes ISO timestamp fields', () => {
    const doc = createUserDocument(validParams);
    expect(doc.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(doc.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('accepts optional phone and verified fields', () => {
    const doc = createUserDocument({ ...validParams, phone: '050-1234567', verified: true });
    expect(doc.phone).toBe('050-1234567');
    expect(doc.verified).toBe(true);
  });

  it('lowercases and trims the email', () => {
    const doc = createUserDocument({ ...validParams, email: '  UPPER@CASE.COM  ' });
    expect(doc.email).toBe('upper@case.com');
  });

  it('throws when id is missing', () => {
    expect(() => createUserDocument({ email: 'a@b.com', password: 'hash' })).toThrow('id is required');
  });

  it('throws when email is missing', () => {
    expect(() => createUserDocument({ id: 'x', password: 'hash' })).toThrow('email is required');
  });

  it('throws when password is missing', () => {
    expect(() => createUserDocument({ id: 'x', email: 'a@b.com' })).toThrow('password is required');
  });
});

// ─── createFinancialDocument ─────────────────────────────────────────────────

describe('createFinancialDocument', () => {
  const validParams = {
    userId: 'user-abc123',
    income: 15000,
  };

  it('creates a valid financials document', () => {
    const doc = createFinancialDocument(validParams);
    expect(doc.id).toBe('user-abc123');   // doc ID == userId
    expect(doc.userId).toBe('user-abc123');
    expect(doc.income).toBe(15000);
  });

  it('sets default values for optional fields', () => {
    const doc = createFinancialDocument(validParams);
    expect(doc.additionalIncome).toBe(0);
    expect(doc.expenses).toEqual({ housing: 0, loans: 0, other: 0 });
    expect(doc.assets).toEqual({ savings: 0, investments: 0 });
    expect(doc.debts).toEqual([]);
  });

  it('includes an ISO updatedAt timestamp', () => {
    const doc = createFinancialDocument(validParams);
    expect(doc.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('accepts full expense and asset breakdown', () => {
    const doc = createFinancialDocument({
      ...validParams,
      additionalIncome: 3000,
      expenses: { housing: 5000, loans: 2000, other: 1000 },
      assets: { savings: 100000, investments: 50000 },
      debts: [{ type: 'car', amount: 30000 }],
    });
    expect(doc.additionalIncome).toBe(3000);
    expect(doc.expenses.housing).toBe(5000);
    expect(doc.assets.savings).toBe(100000);
    expect(doc.debts).toHaveLength(1);
    expect(doc.debts[0]).toEqual({ type: 'car', amount: 30000 });
  });

  it('coerces numeric strings to numbers', () => {
    const doc = createFinancialDocument({ userId: 'u1', income: '12000' });
    expect(typeof doc.income).toBe('number');
    expect(doc.income).toBe(12000);
  });

  it('throws when userId is missing', () => {
    expect(() => createFinancialDocument({ income: 5000 })).toThrow('userId is required');
  });

  it('throws when income is missing', () => {
    expect(() => createFinancialDocument({ userId: 'u1' })).toThrow('income is required');
  });
});

// ─── createOfferDocument ─────────────────────────────────────────────────────

describe('createOfferDocument', () => {
  const validParams = {
    id: 'offer-xyz',
    userId: 'user-abc123',
    originalFile: { url: 'https://cdn.example.com/file.pdf', mimetype: 'application/pdf' },
  };

  it('creates a valid offer document with required fields', () => {
    const doc = createOfferDocument(validParams);
    expect(doc.id).toBe('offer-xyz');
    expect(doc.userId).toBe('user-abc123');
    expect(doc.originalFile.url).toBe('https://cdn.example.com/file.pdf');
    expect(doc.originalFile.mimetype).toBe('application/pdf');
  });

  it('defaults status to pending', () => {
    const doc = createOfferDocument(validParams);
    expect(doc.status).toBe('pending');
  });

  it('defaults extractedData fields to null/empty', () => {
    const doc = createOfferDocument(validParams);
    expect(doc.extractedData).toEqual({ bank: '', amount: null, rate: null, term: null });
  });

  it('defaults analysis fields to null/empty', () => {
    const doc = createOfferDocument(validParams);
    expect(doc.analysis).toEqual({ recommendedRate: null, savings: null, aiReasoning: '' });
  });

  it('includes ISO timestamp fields', () => {
    const doc = createOfferDocument(validParams);
    expect(doc.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(doc.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('accepts full extractedData and analysis', () => {
    const doc = createOfferDocument({
      ...validParams,
      extractedData: { bank: 'הפועלים', amount: 1200000, rate: 3.5, term: 240 },
      analysis: { recommendedRate: 3.1, savings: 45000, aiReasoning: 'Better rate available.' },
      status: 'analyzed',
    });
    expect(doc.extractedData.bank).toBe('הפועלים');
    expect(doc.extractedData.amount).toBe(1200000);
    expect(doc.analysis.savings).toBe(45000);
    expect(doc.status).toBe('analyzed');
  });

  it('throws when id is missing', () => {
    expect(() => createOfferDocument({ userId: 'u1', originalFile: { url: 'x', mimetype: 'y' } })).toThrow('id is required');
  });

  it('throws when userId is missing', () => {
    expect(() => createOfferDocument({ id: 'o1', originalFile: { url: 'x', mimetype: 'y' } })).toThrow('userId is required');
  });

  it('throws when originalFile.url is missing', () => {
    expect(() => createOfferDocument({ id: 'o1', userId: 'u1', originalFile: { mimetype: 'pdf' } })).toThrow('originalFile.url is required');
  });

  it('throws when originalFile.mimetype is missing', () => {
    expect(() => createOfferDocument({ id: 'o1', userId: 'u1', originalFile: { url: 'x' } })).toThrow('originalFile.mimetype is required');
  });

  it('throws when status is invalid', () => {
    expect(() => createOfferDocument({ ...validParams, status: 'unknown' })).toThrow("invalid status 'unknown'");
  });
});

// ─── validateUserDocument ────────────────────────────────────────────────────

describe('validateUserDocument', () => {
  it('returns valid for a well-formed user document', () => {
    const result = validateUserDocument({
      id: 'u1',
      email: 'a@b.com',
      password: 'hash',
      verified: false,
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('returns errors for missing required fields', () => {
    const result = validateUserDocument({});
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('flags invalid verified type', () => {
    const result = validateUserDocument({ id: 'u1', email: 'a@b.com', password: 'h', verified: 'yes' });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('verified must be a boolean');
  });
});

// ─── validateFinancialDocument ───────────────────────────────────────────────

describe('validateFinancialDocument', () => {
  it('returns valid for a well-formed financials document', () => {
    const result = validateFinancialDocument({ userId: 'u1', income: 10000 });
    expect(result.valid).toBe(true);
  });

  it('returns errors for missing userId', () => {
    const result = validateFinancialDocument({ income: 5000 });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('userId must be a non-empty string');
  });

  it('returns errors for negative income', () => {
    const result = validateFinancialDocument({ userId: 'u1', income: -100 });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('income must be a non-negative number');
  });

  it('returns errors for non-array debts', () => {
    const result = validateFinancialDocument({ userId: 'u1', income: 0, debts: 'bad' });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('debts must be an array');
  });
});

// ─── validateOfferDocument ───────────────────────────────────────────────────

describe('validateOfferDocument', () => {
  const validDoc = {
    id: 'o1',
    userId: 'u1',
    originalFile: { url: 'https://cdn.example.com/f.pdf', mimetype: 'application/pdf' },
    status: 'pending',
  };

  it('returns valid for a well-formed offer document', () => {
    const result = validateOfferDocument(validDoc);
    expect(result.valid).toBe(true);
  });

  it('returns errors for missing id', () => {
    const result = validateOfferDocument({ ...validDoc, id: '' });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('id must be a non-empty string');
  });

  it('returns errors for invalid status', () => {
    const result = validateOfferDocument({ ...validDoc, status: 'invalid' });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('status must be one of'))).toBe(true);
  });

  it('returns errors for missing originalFile.url', () => {
    const result = validateOfferDocument({ ...validDoc, originalFile: { mimetype: 'pdf' } });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('originalFile.url is required');
  });
});

// ─── Index Definitions ───────────────────────────────────────────────────────

describe('INDEX_DEFINITIONS', () => {
  it('defines indexes for all three collections', () => {
    const collections = INDEX_DEFINITIONS.map((i) => i.collection);
    expect(collections).toContain('users');
    expect(collections).toContain('financials');
    expect(collections).toContain('offers');
  });

  it('defines a composite index for offers', () => {
    const offersIndex = INDEX_DEFINITIONS.find(
      (i) => i.collection === 'offers' && i.type === 'composite'
    );
    expect(offersIndex).toBeDefined();
    expect(offersIndex.fields).toHaveLength(2);
    expect(offersIndex.fields[0].fieldPath).toBe('userId');
    expect(offersIndex.fields[1].fieldPath).toBe('createdAt');
    expect(offersIndex.fields[1].order).toBe('DESCENDING');
  });

  it('is frozen (immutable)', () => {
    expect(Object.isFrozen(INDEX_DEFINITIONS)).toBe(true);
  });
});

// ─── FIRESTORE_INDEXES ───────────────────────────────────────────────────────

describe('FIRESTORE_INDEXES', () => {
  it('exports a valid firestore.indexes.json structure', () => {
    expect(FIRESTORE_INDEXES).toHaveProperty('indexes');
    expect(FIRESTORE_INDEXES).toHaveProperty('fieldOverrides');
    expect(Array.isArray(FIRESTORE_INDEXES.indexes)).toBe(true);
  });

  it('includes the offers composite index', () => {
    const offersIdx = FIRESTORE_INDEXES.indexes.find(
      (i) => i.collectionGroup === 'offers'
    );
    expect(offersIdx).toBeDefined();
    expect(offersIdx.queryScope).toBe('COLLECTION');
    expect(offersIdx.fields).toHaveLength(2);
  });
});
