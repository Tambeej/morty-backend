/**
 * financialService Unit Tests
 *
 * Tests all CRUD operations in financialService.js using a fully mocked
 * Firestore instance. No live database required.
 */

'use strict';

// ── Environment setup ─────────────────────────────────────────────────────────
process.env.NODE_ENV = 'test';

// ── Mock Firestore ────────────────────────────────────────────────────────────

const mockDocRef = {
  get: jest.fn(),
  set: jest.fn().mockResolvedValue({}),
  update: jest.fn().mockResolvedValue({}),
  delete: jest.fn().mockResolvedValue({}),
};

const mockCollectionRef = {
  doc: jest.fn().mockReturnValue(mockDocRef),
};

jest.mock('../../config/firestore', () => ({
  collection: jest.fn().mockReturnValue(mockCollectionRef),
}));

// ── Import service AFTER mocking ──────────────────────────────────────────────
const financialService = require('../../services/financialService');

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a mock Firestore DocumentSnapshot that exists. */
const makeExistingSnap = (data) => ({
  exists: true,
  id: data.id || data.userId,
  data: () => data,
});

/** Build a mock Firestore DocumentSnapshot that does NOT exist. */
const makeNotFoundSnap = () => ({
  exists: false,
  id: 'nonexistent',
  data: () => null,
});

/** Sample financial document. */
const sampleFinancial = {
  id: 'user-123',
  userId: 'user-123',
  income: 15000,
  additionalIncome: 2000,
  expenses: { housing: 4000, loans: 1500, other: 800 },
  assets: { savings: 50000, investments: 30000 },
  debts: [{ type: 'car', amount: 20000 }],
  updatedAt: '2026-04-03T02:16:00.000Z',
};

// ── buildFinancialData ────────────────────────────────────────────────────────

describe('financialService.buildFinancialData', () => {
  it('should build a normalised financial object with defaults', () => {
    const result = financialService.buildFinancialData('user-123', {});
    expect(result).toMatchObject({
      id: 'user-123',
      userId: 'user-123',
      income: 0,
      additionalIncome: 0,
      expenses: { housing: 0, loans: 0, other: 0 },
      assets: { savings: 0, investments: 0 },
      debts: [],
    });
    expect(typeof result.updatedAt).toBe('string');
  });

  it('should coerce string numbers to numbers', () => {
    const result = financialService.buildFinancialData('user-123', {
      income: '15000',
      additionalIncome: '2000',
      expenses: { housing: '4000', loans: '1500', other: '800' },
    });
    expect(result.income).toBe(15000);
    expect(result.additionalIncome).toBe(2000);
    expect(result.expenses.housing).toBe(4000);
  });

  it('should normalise debts array', () => {
    const result = financialService.buildFinancialData('user-123', {
      debts: [{ type: 'car', amount: 20000 }, { type: 'personal', amount: 5000 }],
    });
    expect(result.debts).toHaveLength(2);
    expect(result.debts[0]).toEqual({ type: 'car', amount: 20000 });
  });

  it('should default debts to empty array when not provided', () => {
    const result = financialService.buildFinancialData('user-123', { income: 10000 });
    expect(result.debts).toEqual([]);
  });

  it('should set updatedAt to a valid ISO string', () => {
    const result = financialService.buildFinancialData('user-123', { income: 5000 });
    expect(() => new Date(result.updatedAt)).not.toThrow();
    expect(new Date(result.updatedAt).toISOString()).toBe(result.updatedAt);
  });

  it('should handle missing nested objects gracefully', () => {
    const result = financialService.buildFinancialData('user-123', {
      income: 10000,
      expenses: undefined,
      assets: undefined,
    });
    expect(result.expenses).toEqual({ housing: 0, loans: 0, other: 0 });
    expect(result.assets).toEqual({ savings: 0, investments: 0 });
  });

  it('should set id and userId to the provided userId', () => {
    const result = financialService.buildFinancialData('my-user-id', {});
    expect(result.id).toBe('my-user-id');
    expect(result.userId).toBe('my-user-id');
  });
});

// ── getFinancials ─────────────────────────────────────────────────────────────

describe('financialService.getFinancials', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should return the financial document when found', async () => {
    mockDocRef.get.mockResolvedValueOnce(makeExistingSnap(sampleFinancial));

    const result = await financialService.getFinancials('user-123');
    expect(result).toMatchObject({
      userId: 'user-123',
      income: 15000,
    });
  });

  it('should return null when document does not exist', async () => {
    mockDocRef.get.mockResolvedValueOnce(makeNotFoundSnap());

    const result = await financialService.getFinancials('nonexistent-user');
    expect(result).toBeNull();
  });

  it('should return null for falsy userId', async () => {
    const result = await financialService.getFinancials(null);
    expect(result).toBeNull();
  });

  it('should include all financial fields', async () => {
    mockDocRef.get.mockResolvedValueOnce(makeExistingSnap(sampleFinancial));

    const result = await financialService.getFinancials('user-123');
    expect(result).toHaveProperty('income');
    expect(result).toHaveProperty('additionalIncome');
    expect(result).toHaveProperty('expenses');
    expect(result).toHaveProperty('assets');
    expect(result).toHaveProperty('debts');
    expect(result).toHaveProperty('updatedAt');
  });
});

// ── upsertFinancials ──────────────────────────────────────────────────────────

describe('financialService.upsertFinancials', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should call set() and return the saved financial data', async () => {
    mockDocRef.set.mockResolvedValueOnce({});

    const result = await financialService.upsertFinancials('user-123', {
      income: 15000,
      expenses: { housing: 4000, loans: 1500, other: 800 },
    });

    expect(mockDocRef.set).toHaveBeenCalled();
    expect(result).toHaveProperty('userId', 'user-123');
    expect(result).toHaveProperty('income', 15000);
  });

  it('should apply defaults for missing fields', async () => {
    mockDocRef.set.mockResolvedValueOnce({});

    const result = await financialService.upsertFinancials('user-123', {});

    expect(result.income).toBe(0);
    expect(result.debts).toEqual([]);
  });

  it('should throw when userId is falsy', async () => {
    await expect(financialService.upsertFinancials(null, {})).rejects.toThrow();
  });

  it('should set updatedAt as an ISO string', async () => {
    mockDocRef.set.mockResolvedValueOnce({});

    const result = await financialService.upsertFinancials('user-123', { income: 5000 });

    expect(result).toHaveProperty('updatedAt');
    expect(() => new Date(result.updatedAt)).not.toThrow();
    expect(new Date(result.updatedAt).toISOString()).toBe(result.updatedAt);
  });
});

// ── updateFinancials ──────────────────────────────────────────────────────────

describe('financialService.updateFinancials', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should call update() when document exists and return updated data', async () => {
    // Document exists
    mockDocRef.get
      .mockResolvedValueOnce(makeExistingSnap(sampleFinancial)) // existence check
      .mockResolvedValueOnce(makeExistingSnap({ ...sampleFinancial, income: 20000 })); // re-fetch
    mockDocRef.update.mockResolvedValueOnce({});

    const result = await financialService.updateFinancials('user-123', { income: 20000 });

    expect(mockDocRef.update).toHaveBeenCalled();
    expect(result).toHaveProperty('income', 20000);
  });

  it('should fall back to upsert when document does not exist', async () => {
    // Document does not exist
    mockDocRef.get.mockResolvedValueOnce(makeNotFoundSnap());
    mockDocRef.set.mockResolvedValueOnce({});

    const result = await financialService.updateFinancials('new-user', { income: 5000 });

    expect(mockDocRef.set).toHaveBeenCalled();
    expect(result).toHaveProperty('userId', 'new-user');
  });

  it('should throw when userId is falsy', async () => {
    await expect(financialService.updateFinancials(null, { income: 5000 })).rejects.toThrow();
  });

  it('should not overwrite id or userId fields', async () => {
    mockDocRef.get
      .mockResolvedValueOnce(makeExistingSnap(sampleFinancial))
      .mockResolvedValueOnce(makeExistingSnap(sampleFinancial));
    mockDocRef.update.mockResolvedValueOnce({});

    await financialService.updateFinancials('user-123', { income: 10000 });

    const updateCall = mockDocRef.update.mock.calls[0][0];
    expect(updateCall.id).toBeUndefined();
    expect(updateCall.userId).toBeUndefined();
  });
});

// ── deleteFinancials ──────────────────────────────────────────────────────────

describe('financialService.deleteFinancials', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should call delete() on the financial document', async () => {
    mockDocRef.delete.mockResolvedValueOnce({});

    await financialService.deleteFinancials('user-123');

    expect(mockDocRef.delete).toHaveBeenCalled();
  });

  it('should throw when userId is falsy', async () => {
    await expect(financialService.deleteFinancials(null)).rejects.toThrow();
  });
});
