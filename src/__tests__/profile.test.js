/**
 * Financial Profile API – unit / integration tests.
 *
 * Uses Jest mocks for financialService so no real Firestore connection
 * is required during CI. The auth middleware is also mocked to inject
 * a fake user into req.user.
 *
 * Covers:
 *   GET   /api/v1/profile  – retrieve financial profile
 *   PUT   /api/v1/profile  – upsert (full replace) financial profile
 *   PATCH /api/v1/profile  – partial update financial profile
 *   Unit tests for financialService.buildFinancialData helper
 */

'use strict';

const request = require('supertest');
const jwt = require('jsonwebtoken');

// ── Environment setup (must happen before requiring app) ──────────────────────
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-for-testing-only';
process.env.JWT_REFRESH_SECRET =
  process.env.JWT_REFRESH_SECRET || 'test-refresh-secret-for-testing-only';
process.env.NODE_ENV = 'test';

// ── Mock firebase-admin so Firestore is never initialised in tests ─────────────
jest.mock('firebase-admin', () => {
  const firestoreMock = {
    collection: jest.fn().mockReturnThis(),
    doc: jest.fn().mockReturnThis(),
    get: jest.fn().mockResolvedValue({ exists: false, data: () => ({}) }),
    set: jest.fn().mockResolvedValue({}),
    update: jest.fn().mockResolvedValue({}),
    delete: jest.fn().mockResolvedValue({}),
    where: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    settings: jest.fn(),
  };
  return {
    apps: [],
    initializeApp: jest.fn(),
    credential: {
      cert: jest.fn(),
      applicationDefault: jest.fn(),
    },
    firestore: jest.fn(() => firestoreMock),
  };
});

// ── Mock financialService ─────────────────────────────────────────────────────
jest.mock('../services/financialService');
const financialService = require('../services/financialService');

// ── Mock auth middleware to inject a fake user ────────────────────────────────
jest.mock('../middleware/auth', () => ({
  protect: (req, _res, next) => {
    req.user = { id: 'firestore-uid-test-001', email: 'profile-test@morty.test' };
    next();
  },
}));

const app = require('../index');

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Signed JWT for the fake test user */
const makeToken = (userId = 'firestore-uid-test-001') =>
  jwt.sign(
    { id: userId, email: 'profile-test@morty.test' },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );

/** Sample financial profile matching the Firestore document shape */
const sampleFinancial = {
  id: 'firestore-uid-test-001',
  userId: 'firestore-uid-test-001',
  income: 15000,
  additionalIncome: 2000,
  expenses: { housing: 4000, loans: 1500, other: 800 },
  assets: { savings: 50000, investments: 30000 },
  debts: [{ type: 'car', amount: 20000 }],
  updatedAt: '2026-04-03T02:16:00.000Z',
};

// ── GET /api/v1/profile ───────────────────────────────────────────────────────

describe('GET /api/v1/profile', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should return 200 with financial data when profile exists', async () => {
    financialService.getFinancials.mockResolvedValue(sampleFinancial);

    const res = await request(app)
      .get('/api/v1/profile')
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      id: 'firestore-uid-test-001',
      userId: 'firestore-uid-test-001',
      income: 15000,
      additionalIncome: 2000,
    });
    expect(res.body.data.expenses).toEqual({ housing: 4000, loans: 1500, other: 800 });
    expect(res.body.data.assets).toEqual({ savings: 50000, investments: 30000 });
    expect(res.body.data.debts).toHaveLength(1);
    expect(financialService.getFinancials).toHaveBeenCalledWith('firestore-uid-test-001');
  });

  it('should return 200 with null data when no profile exists', async () => {
    financialService.getFinancials.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/v1/profile')
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeNull();
    expect(res.body.message).toMatch(/no financial profile/i);
  });

  it('should return 500 when financialService throws', async () => {
    financialService.getFinancials.mockRejectedValue(new Error('Firestore unavailable'));

    const res = await request(app)
      .get('/api/v1/profile')
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });

  it('should include a message field in the response', async () => {
    financialService.getFinancials.mockResolvedValue(sampleFinancial);

    const res = await request(app)
      .get('/api/v1/profile')
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(res.status).toBe(200);
    expect(typeof res.body.message).toBe('string');
  });
});

// ── PUT /api/v1/profile ───────────────────────────────────────────────────────

describe('PUT /api/v1/profile', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should return 200 and upserted financial data on valid input', async () => {
    const updatedFinancial = { ...sampleFinancial, income: 18000 };
    financialService.upsertFinancials.mockResolvedValue(updatedFinancial);

    const res = await request(app)
      .put('/api/v1/profile')
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({
        income: 18000,
        additionalIncome: 2000,
        expenses: { housing: 4000, loans: 1500, other: 800 },
        assets: { savings: 50000, investments: 30000 },
        debts: [{ type: 'car', amount: 20000 }],
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.income).toBe(18000);
    expect(res.body.message).toMatch(/updated successfully/i);
    expect(financialService.upsertFinancials).toHaveBeenCalledWith(
      'firestore-uid-test-001',
      expect.objectContaining({ income: 18000 })
    );
  });

  it('should return 200 with defaults when body is empty', async () => {
    const defaultFinancial = {
      id: 'firestore-uid-test-001',
      userId: 'firestore-uid-test-001',
      income: 0,
      additionalIncome: 0,
      expenses: { housing: 0, loans: 0, other: 0 },
      assets: { savings: 0, investments: 0 },
      debts: [],
      updatedAt: '2026-04-03T02:16:00.000Z',
    };
    financialService.upsertFinancials.mockResolvedValue(defaultFinancial);

    const res = await request(app)
      .put('/api/v1/profile')
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.income).toBe(0);
  });

  it('should return 422 when income is negative', async () => {
    const res = await request(app)
      .put('/api/v1/profile')
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({ income: -100 });

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/validation failed/i);
  });

  it('should return 422 when debt item is missing required fields', async () => {
    const res = await request(app)
      .put('/api/v1/profile')
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({
        income: 10000,
        debts: [{ amount: 5000 }], // missing 'type'
      });

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
  });

  it('should return 500 when financialService throws', async () => {
    financialService.upsertFinancials.mockRejectedValue(new Error('Firestore write failed'));

    const res = await request(app)
      .put('/api/v1/profile')
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({ income: 10000 });

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });

  it('should call upsertFinancials with the correct userId', async () => {
    financialService.upsertFinancials.mockResolvedValue(sampleFinancial);

    await request(app)
      .put('/api/v1/profile')
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({ income: 15000 });

    expect(financialService.upsertFinancials).toHaveBeenCalledWith(
      'firestore-uid-test-001',
      expect.any(Object)
    );
  });
});

// ── PATCH /api/v1/profile ─────────────────────────────────────────────────────

describe('PATCH /api/v1/profile', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should return 200 and partially updated financial data', async () => {
    const patchedFinancial = { ...sampleFinancial, income: 20000 };
    financialService.updateFinancials.mockResolvedValue(patchedFinancial);

    const res = await request(app)
      .patch('/api/v1/profile')
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({ income: 20000 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.income).toBe(20000);
    expect(res.body.message).toMatch(/partially updated/i);
    expect(financialService.updateFinancials).toHaveBeenCalledWith(
      'firestore-uid-test-001',
      expect.objectContaining({ income: 20000 })
    );
  });

  it('should return 422 when body is empty', async () => {
    const res = await request(app)
      .patch('/api/v1/profile')
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({});

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
  });

  it('should return 422 when income is negative', async () => {
    const res = await request(app)
      .patch('/api/v1/profile')
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({ income: -500 });

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
  });

  it('should return 500 when financialService throws', async () => {
    financialService.updateFinancials.mockRejectedValue(new Error('Firestore patch failed'));

    const res = await request(app)
      .patch('/api/v1/profile')
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({ income: 10000 });

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });

  it('should only pass provided fields to updateFinancials', async () => {
    financialService.updateFinancials.mockResolvedValue(sampleFinancial);

    await request(app)
      .patch('/api/v1/profile')
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({ additionalIncome: 500 });

    expect(financialService.updateFinancials).toHaveBeenCalledWith(
      'firestore-uid-test-001',
      { additionalIncome: 500 }
    );
  });
});

// ── Unit tests for financialService helpers ───────────────────────────────────

describe('financialService.buildFinancialData (unit)', () => {
  // Unmock for direct unit testing of the helper
  let buildFinancialData;

  beforeAll(() => {
    jest.unmock('../services/financialService');
    // Re-require after unmocking
    buildFinancialData = require('../services/financialService').buildFinancialData;
  });

  it('should build a normalised financial object with defaults', () => {
    const result = buildFinancialData('user-123', {});
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
    const result = buildFinancialData('user-123', {
      income: '15000',
      additionalIncome: '2000',
      expenses: { housing: '4000', loans: '1500', other: '800' },
    });
    expect(result.income).toBe(15000);
    expect(result.additionalIncome).toBe(2000);
    expect(result.expenses.housing).toBe(4000);
  });

  it('should normalise debts array', () => {
    const result = buildFinancialData('user-123', {
      debts: [{ type: 'car', amount: 20000 }, { type: 'personal', amount: 5000 }],
    });
    expect(result.debts).toHaveLength(2);
    expect(result.debts[0]).toEqual({ type: 'car', amount: 20000 });
  });

  it('should default debts to empty array when not provided', () => {
    const result = buildFinancialData('user-123', { income: 10000 });
    expect(result.debts).toEqual([]);
  });

  it('should set updatedAt to a valid ISO string', () => {
    const result = buildFinancialData('user-123', { income: 5000 });
    expect(() => new Date(result.updatedAt)).not.toThrow();
    expect(new Date(result.updatedAt).toISOString()).toBe(result.updatedAt);
  });

  it('should handle missing nested objects gracefully', () => {
    const result = buildFinancialData('user-123', {
      income: 10000,
      expenses: undefined,
      assets: undefined,
    });
    expect(result.expenses).toEqual({ housing: 0, loans: 0, other: 0 });
    expect(result.assets).toEqual({ savings: 0, investments: 0 });
  });
});
