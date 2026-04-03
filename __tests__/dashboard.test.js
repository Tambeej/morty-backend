/**
 * Dashboard API Tests
 *
 * Tests the GET /api/v1/dashboard endpoint using Firestore-backed
 * service mocks. Validates auth guards, response shape, and edge cases.
 */

'use strict';

const request = require('supertest');

// ── Environment setup (must happen before requiring app) ──────────────────────
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-for-testing-only';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-for-testing-only';

// ── Mock Firestore config ─────────────────────────────────────────────────────
jest.mock('../src/config/firestore', () => ({
  collection: jest.fn().mockReturnThis(),
  doc: jest.fn().mockReturnThis(),
  get: jest.fn().mockResolvedValue({ exists: false, data: () => ({}) }),
  set: jest.fn().mockResolvedValue({}),
  update: jest.fn().mockResolvedValue({}),
  delete: jest.fn().mockResolvedValue({}),
  where: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
}));

// ── Mock Cloudinary ───────────────────────────────────────────────────────────
jest.mock('../src/config/cloudinary', () => ({
  uploader: {
    upload_stream: jest.fn(),
    destroy: jest.fn().mockResolvedValue({ result: 'ok' }),
  },
}));

// ── Shared mock data ──────────────────────────────────────────────────────────

const mockFinancials = {
  id: 'firestore-uid-abc123',
  userId: 'firestore-uid-abc123',
  income: 15000,
  additionalIncome: 2000,
  expenses: { housing: 4000, loans: 1500, other: 800 },
  assets: { savings: 50000, investments: 30000 },
  debts: [{ type: 'car', amount: 20000 }],
  updatedAt: '2026-04-03T02:16:00.000Z',
};

const mockRecentOffers = [
  {
    id: 'offer-id-001',
    userId: 'firestore-uid-abc123',
    originalFile: { url: 'https://cdn.example.com/offer1.pdf', mimetype: 'application/pdf' },
    extractedData: { bank: 'הפועלים', amount: 1200000, rate: 3.5, term: 240 },
    analysis: { recommendedRate: 3.1, savings: 45000, aiReasoning: 'שיעור טוב יותר זמין.' },
    status: 'analyzed',
    createdAt: '2026-04-03T02:16:00.000Z',
    updatedAt: '2026-04-03T02:20:00.000Z',
  },
  {
    id: 'offer-id-002',
    userId: 'firestore-uid-abc123',
    originalFile: { url: 'https://cdn.example.com/offer2.pdf', mimetype: 'application/pdf' },
    extractedData: { bank: 'לאומי', amount: 800000, rate: 3.8, term: 180 },
    analysis: { recommendedRate: 3.4, savings: 30000, aiReasoning: 'ניתן לחסוך.' },
    status: 'analyzed',
    createdAt: '2026-04-02T10:00:00.000Z',
    updatedAt: '2026-04-02T10:05:00.000Z',
  },
];

const mockStats = {
  total: 5,
  pending: 1,
  analyzed: 3,
  error: 1,
  savingsTotal: 120000,
};

// ── Mock financialService ─────────────────────────────────────────────────────
jest.mock('../src/services/financialService', () => ({
  getFinancials: jest.fn().mockResolvedValue(mockFinancials),
}));

// ── Mock offerService ─────────────────────────────────────────────────────────
jest.mock('../src/services/offerService', () => ({
  getRecentOffers: jest.fn().mockResolvedValue(mockRecentOffers),
  getOfferStats: jest.fn().mockResolvedValue(mockStats),
  OFFER_STATUSES: ['pending', 'analyzed', 'error'],
}));

// ── Mock userService (used by auth middleware) ────────────────────────────────
jest.mock('../src/services/userService', () => ({
  getUserById: jest.fn().mockResolvedValue({
    id: 'firestore-uid-abc123',
    email: 'dashboard-test@example.com',
    phone: '050-0000000',
    verified: true,
  }),
}));

const app = require('../src/index');
const jwt = require('jsonwebtoken');

/** Generate a signed JWT for a fake Firestore user ID. */
const makeToken = (userId = 'firestore-uid-abc123') =>
  jwt.sign(
    { id: userId, email: 'dashboard-test@example.com' },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );

// ─── Auth guard tests ─────────────────────────────────────────────────────────

describe('GET /api/v1/dashboard – auth guard', () => {
  it('should reject request without authentication (401)', async () => {
    const res = await request(app).get('/api/v1/dashboard');
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });
});

// ─── Authenticated dashboard retrieval ───────────────────────────────────────

describe('GET /api/v1/dashboard – authenticated', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset mocks to default values
    const financialService = require('../src/services/financialService');
    const offerService = require('../src/services/offerService');
    financialService.getFinancials.mockResolvedValue(mockFinancials);
    offerService.getRecentOffers.mockResolvedValue(mockRecentOffers);
    offerService.getOfferStats.mockResolvedValue(mockStats);
  });

  it('should return 200 with dashboard data', async () => {
    const token = makeToken();

    const res = await request(app)
      .get('/api/v1/dashboard')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('should return financials in response data', async () => {
    const token = makeToken();

    const res = await request(app)
      .get('/api/v1/dashboard')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('financials');
    expect(res.body.data.financials).toMatchObject({
      userId: 'firestore-uid-abc123',
      income: 15000,
    });
  });

  it('should return recentOffers array in response data', async () => {
    const token = makeToken();

    const res = await request(app)
      .get('/api/v1/dashboard')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('recentOffers');
    expect(Array.isArray(res.body.data.recentOffers)).toBe(true);
    expect(res.body.data.recentOffers.length).toBeGreaterThan(0);
  });

  it('should return stats with totalOffers and savingsTotal', async () => {
    const token = makeToken();

    const res = await request(app)
      .get('/api/v1/dashboard')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('stats');
    expect(res.body.data.stats).toHaveProperty('totalOffers', 5);
    expect(res.body.data.stats).toHaveProperty('savingsTotal', 120000);
  });

  it('should return offers with string IDs (Firestore format)', async () => {
    const token = makeToken();

    const res = await request(app)
      .get('/api/v1/dashboard')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    if (res.body.data.recentOffers.length > 0) {
      expect(typeof res.body.data.recentOffers[0].id).toBe('string');
      // Should NOT have _id (Mongoose field)
      expect(res.body.data.recentOffers[0]._id).toBeUndefined();
    }
  });

  it('should return ISO string timestamps in offers', async () => {
    const token = makeToken();

    const res = await request(app)
      .get('/api/v1/dashboard')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    if (res.body.data.recentOffers.length > 0) {
      const offer = res.body.data.recentOffers[0];
      expect(() => new Date(offer.createdAt)).not.toThrow();
      expect(new Date(offer.createdAt).toISOString()).toBe(offer.createdAt);
    }
  });

  it('should return null financials when user has no profile', async () => {
    const financialService = require('../src/services/financialService');
    financialService.getFinancials.mockResolvedValueOnce(null);

    const token = makeToken();

    const res = await request(app)
      .get('/api/v1/dashboard')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.financials).toBeNull();
  });

  it('should return empty recentOffers when user has no offers', async () => {
    const offerService = require('../src/services/offerService');
    offerService.getRecentOffers.mockResolvedValueOnce([]);
    offerService.getOfferStats.mockResolvedValueOnce({
      total: 0, pending: 0, analyzed: 0, error: 0, savingsTotal: 0,
    });

    const token = makeToken();

    const res = await request(app)
      .get('/api/v1/dashboard')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.recentOffers).toEqual([]);
    expect(res.body.data.stats.totalOffers).toBe(0);
    expect(res.body.data.stats.savingsTotal).toBe(0);
  });

  it('should return 500 when a service throws', async () => {
    const financialService = require('../src/services/financialService');
    financialService.getFinancials.mockRejectedValueOnce(new Error('Firestore unavailable'));

    const token = makeToken();

    const res = await request(app)
      .get('/api/v1/dashboard')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });

  it('should include a message field in the response', async () => {
    const token = makeToken();

    const res = await request(app)
      .get('/api/v1/dashboard')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(typeof res.body.message).toBe('string');
  });
});

// ─── Response shape contract ──────────────────────────────────────────────────

describe('GET /api/v1/dashboard – response shape contract', () => {
  it('should match the architecture contract shape', async () => {
    const token = makeToken();

    const res = await request(app)
      .get('/api/v1/dashboard')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);

    const { data } = res.body;

    // Top-level keys
    expect(data).toHaveProperty('financials');
    expect(data).toHaveProperty('recentOffers');
    expect(data).toHaveProperty('stats');

    // Stats shape
    expect(data.stats).toHaveProperty('totalOffers');
    expect(data.stats).toHaveProperty('savingsTotal');
    expect(typeof data.stats.totalOffers).toBe('number');
    expect(typeof data.stats.savingsTotal).toBe('number');

    // recentOffers shape
    expect(Array.isArray(data.recentOffers)).toBe(true);
    if (data.recentOffers.length > 0) {
      const offer = data.recentOffers[0];
      expect(offer).toHaveProperty('id');
      expect(offer).toHaveProperty('userId');
      expect(offer).toHaveProperty('originalFile');
      expect(offer).toHaveProperty('extractedData');
      expect(offer).toHaveProperty('analysis');
      expect(offer).toHaveProperty('status');
      expect(offer).toHaveProperty('createdAt');
      expect(offer).toHaveProperty('updatedAt');
    }
  });
});
