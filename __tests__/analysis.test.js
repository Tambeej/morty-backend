/**
 * Analysis API Tests
 *
 * Tests the GET /api/v1/analysis/:id endpoint using Firestore-backed
 * offerService mocks.  Validates auth guards, ownership enforcement,
 * and the full OfferShape response contract.
 */

const request = require('supertest');

// ── Environment setup (must happen before requiring app) ──────────────────────
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-for-testing-only';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-for-testing-only';
process.env.CLOUDINARY_CLOUD_NAME = 'test-cloud';
process.env.CLOUDINARY_API_KEY = 'test-key';
process.env.CLOUDINARY_API_SECRET = 'test-secret';

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

// ── Shared mock offer shapes ──────────────────────────────────────────────────

/** Fully analyzed offer */
const mockAnalyzedOffer = {
  id: 'offer-analyzed-001',
  userId: 'firestore-uid-abc123',
  originalFile: {
    url: 'https://res.cloudinary.com/test/raw/upload/morty/offers/mortgage.pdf',
    mimetype: 'application/pdf',
  },
  extractedData: { bank: 'הפועלים', amount: 1200000, rate: 3.5, term: 240 },
  analysis: {
    recommendedRate: 3.1,
    savings: 45000,
    aiReasoning: 'שיעור טוב יותר זמין בשוק.',
  },
  status: 'analyzed',
  createdAt: '2026-04-03T02:16:00.000Z',
  updatedAt: '2026-04-03T02:20:00.000Z',
};

/** Pending offer (AI analysis not yet complete) */
const mockPendingOffer = {
  id: 'offer-pending-002',
  userId: 'firestore-uid-abc123',
  originalFile: {
    url: 'https://res.cloudinary.com/test/raw/upload/morty/offers/pending.pdf',
    mimetype: 'application/pdf',
  },
  extractedData: { bank: '', amount: null, rate: null, term: null },
  analysis: { recommendedRate: null, savings: null, aiReasoning: '' },
  status: 'pending',
  createdAt: '2026-04-03T03:00:00.000Z',
  updatedAt: '2026-04-03T03:00:00.000Z',
};

/** Errored offer */
const mockErrorOffer = {
  id: 'offer-error-003',
  userId: 'firestore-uid-abc123',
  originalFile: {
    url: 'https://res.cloudinary.com/test/raw/upload/morty/offers/error.pdf',
    mimetype: 'application/pdf',
  },
  extractedData: { bank: '', amount: null, rate: null, term: null },
  analysis: { recommendedRate: null, savings: null, aiReasoning: '' },
  status: 'error',
  createdAt: '2026-04-03T04:00:00.000Z',
  updatedAt: '2026-04-03T04:05:00.000Z',
};

// ── Mock offerService ─────────────────────────────────────────────────────────
jest.mock('../src/services/offerService', () => ({
  findByIdAndUserId: jest.fn().mockResolvedValue(mockAnalyzedOffer),
  OFFER_STATUSES: ['pending', 'analyzed', 'error'],
}));

// ── Mock aiService ────────────────────────────────────────────────────────────
jest.mock('../src/services/aiService', () => ({
  analyzeOffer: jest.fn().mockResolvedValue({}),
}));

// ── Mock userService (used by auth middleware) ────────────────────────────────
jest.mock('../src/services/userService', () => ({
  getUserById: jest.fn().mockResolvedValue({
    id: 'firestore-uid-abc123',
    email: 'analysis-test@example.com',
    phone: '050-0000000',
    verified: true,
  }),
}));

const app = require('../src/index');
const jwt = require('jsonwebtoken');

/** Generate a signed JWT for a fake Firestore user ID. */
const makeToken = (userId = 'firestore-uid-abc123') =>
  jwt.sign(
    { id: userId, email: 'analysis-test@example.com' },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );

// ─── Auth guard tests ─────────────────────────────────────────────────────────

describe('GET /api/v1/analysis/:id – auth guard', () => {
  it('should reject request without authentication (401)', async () => {
    const res = await request(app).get('/api/v1/analysis/offer-analyzed-001');
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });
});

// ─── Authenticated analysis retrieval ────────────────────────────────────────

describe('GET /api/v1/analysis/:id – analyzed offer', () => {
  it('should return full OfferShape for an analyzed offer (200)', async () => {
    const token = makeToken();

    const res = await request(app)
      .get('/api/v1/analysis/offer-analyzed-001')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const data = res.body.data;
    // Full OfferShape fields
    expect(data).toHaveProperty('id', 'offer-analyzed-001');
    expect(data).toHaveProperty('userId');
    expect(data).toHaveProperty('originalFile');
    expect(data.originalFile).toHaveProperty('url');
    expect(data.originalFile).toHaveProperty('mimetype');
    expect(data).toHaveProperty('extractedData');
    expect(data.extractedData).toHaveProperty('bank');
    expect(data.extractedData).toHaveProperty('amount');
    expect(data.extractedData).toHaveProperty('rate');
    expect(data.extractedData).toHaveProperty('term');
    expect(data).toHaveProperty('analysis');
    expect(data.analysis).toHaveProperty('recommendedRate');
    expect(data.analysis).toHaveProperty('savings');
    expect(data.analysis).toHaveProperty('aiReasoning');
    expect(data).toHaveProperty('status', 'analyzed');
    expect(data).toHaveProperty('createdAt');
    expect(data).toHaveProperty('updatedAt');
  });

  it('should return string ID (Firestore format, not ObjectId)', async () => {
    const token = makeToken();

    const res = await request(app)
      .get('/api/v1/analysis/offer-analyzed-001')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(typeof res.body.data.id).toBe('string');
    // Should NOT have _id (Mongoose field)
    expect(res.body.data._id).toBeUndefined();
  });

  it('should return ISO string timestamps', async () => {
    const token = makeToken();

    const res = await request(app)
      .get('/api/v1/analysis/offer-analyzed-001')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    // Timestamps should be valid ISO strings
    expect(() => new Date(res.body.data.createdAt)).not.toThrow();
    expect(() => new Date(res.body.data.updatedAt)).not.toThrow();
    expect(new Date(res.body.data.createdAt).toISOString()).toBe(res.body.data.createdAt);
  });
});

describe('GET /api/v1/analysis/:id – pending offer', () => {
  it('should return full OfferShape with null analysis fields for pending offer (200)', async () => {
    const offerService = require('../src/services/offerService');
    offerService.findByIdAndUserId.mockResolvedValueOnce(mockPendingOffer);

    const token = makeToken();

    const res = await request(app)
      .get('/api/v1/analysis/offer-pending-002')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('pending');
    expect(res.body.data.analysis.recommendedRate).toBeNull();
    expect(res.body.data.analysis.savings).toBeNull();
    expect(res.body.data.extractedData.amount).toBeNull();
  });
});

describe('GET /api/v1/analysis/:id – error offer', () => {
  it('should return full OfferShape with status error (200)', async () => {
    const offerService = require('../src/services/offerService');
    offerService.findByIdAndUserId.mockResolvedValueOnce(mockErrorOffer);

    const token = makeToken();

    const res = await request(app)
      .get('/api/v1/analysis/offer-error-003')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('error');
  });
});

describe('GET /api/v1/analysis/:id – not found', () => {
  it('should return 404 when offer does not exist or is not owned (404)', async () => {
    const offerService = require('../src/services/offerService');
    offerService.findByIdAndUserId.mockResolvedValueOnce(null);

    const token = makeToken();

    const res = await request(app)
      .get('/api/v1/analysis/nonexistent-offer-id')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/not found/i);
  });

  it('should not expose offers belonging to other users (404)', async () => {
    const offerService = require('../src/services/offerService');
    // findByIdAndUserId returns null when userId does not match
    offerService.findByIdAndUserId.mockResolvedValueOnce(null);

    // Token for a different user
    const token = makeToken('different-user-uid');

    const res = await request(app)
      .get('/api/v1/analysis/offer-analyzed-001')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});
