/**
 * Offers API Tests
 *
 * Tests the offers endpoints using Firestore-backed offerService mocks.
 * Validates auth guards, upload flow, listing, retrieval, deletion, and stats.
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

// ── Mock offerService ─────────────────────────────────────────────────────────
const mockOffer = {
  id: 'offer-id-xyz',
  userId: 'firestore-uid-abc123',
  originalFile: {
    url: 'https://res.cloudinary.com/test/raw/upload/morty/offers/test-file.pdf',
    mimetype: 'application/pdf',
  },
  extractedData: { bank: 'הפועלים', amount: 1200000, rate: 3.5, term: 240 },
  analysis: { recommendedRate: 3.1, savings: 45000, aiReasoning: 'שיעור טוב יותר זמין.' },
  status: 'analyzed',
  createdAt: '2026-04-03T02:16:00.000Z',
  updatedAt: '2026-04-03T02:20:00.000Z',
};

jest.mock('../src/services/offerService', () => ({
  uploadFileToCloudinary: jest.fn().mockResolvedValue({
    url: 'https://res.cloudinary.com/test/raw/upload/morty/offers/test-file.pdf',
    publicId: 'morty/offers/test-file',
  }),
  createOffer: jest.fn().mockResolvedValue({
    id: 'offer-id-xyz',
    userId: 'firestore-uid-abc123',
    originalFile: {
      url: 'https://res.cloudinary.com/test/raw/upload/morty/offers/test-file.pdf',
      mimetype: 'application/pdf',
    },
    extractedData: { bank: '', amount: null, rate: null, term: null },
    analysis: { recommendedRate: null, savings: null, aiReasoning: '' },
    status: 'pending',
    createdAt: '2026-04-03T02:16:00.000Z',
    updatedAt: '2026-04-03T02:16:00.000Z',
  }),
  listOffersByUser: jest.fn().mockResolvedValue({
    offers: [mockOffer],
    total: 1,
  }),
  findByIdAndUserId: jest.fn().mockResolvedValue(mockOffer),
  getOfferStats: jest.fn().mockResolvedValue({
    total: 3,
    pending: 1,
    analyzed: 2,
    error: 0,
    savingsTotal: 90000,
  }),
  deleteOffer: jest.fn().mockResolvedValue(undefined),
  OFFER_STATUSES: ['pending', 'analyzed', 'error'],
}));

// ── Mock aiService (fire-and-forget, should not block tests) ──────────────────
jest.mock('../src/services/aiService', () => ({
  analyzeOffer: jest.fn().mockResolvedValue({}),
}));

// ── Mock userService (used by auth middleware) ────────────────────────────────
jest.mock('../src/services/userService', () => ({
  getUserById: jest.fn().mockResolvedValue({
    id: 'firestore-uid-abc123',
    email: 'offers-test@example.com',
    phone: '050-0000000',
    verified: true,
  }),
}));

const app = require('../src/index');
const jwt = require('jsonwebtoken');

/** Generate a signed JWT for a fake Firestore user ID. */
const makeToken = (userId = 'firestore-uid-abc123') =>
  jwt.sign(
    { id: userId, email: 'offers-test@example.com' },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );

/** Create a minimal valid PDF buffer for testing. */
const createTestPdfBuffer = () =>
  Buffer.from(
    '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n' +
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n' +
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n' +
    'xref\n0 4\n0000000000 65535 f\n0000000009 00000 n\n' +
    '0000000058 00000 n\n0000000115 00000 n\n' +
    'trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n190\n%%EOF'
  );

// ─── Auth guard tests ─────────────────────────────────────────────────────────

describe('POST /api/v1/offers – auth guard', () => {
  it('should reject upload without authentication (401)', async () => {
    const pdfBuffer = createTestPdfBuffer();
    const res = await request(app)
      .post('/api/v1/offers')
      .attach('file', pdfBuffer, { filename: 'test.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });
});

describe('GET /api/v1/offers – auth guard', () => {
  it('should require authentication (401)', async () => {
    const res = await request(app).get('/api/v1/offers');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/v1/offers/stats – auth guard', () => {
  it('should require authentication (401)', async () => {
    const res = await request(app).get('/api/v1/offers/stats');
    expect(res.status).toBe(401);
  });
});

// ─── Authenticated offer operations ──────────────────────────────────────────

describe('POST /api/v1/offers – authenticated upload', () => {
  it('should upload a PDF and return { id, status: pending } (201)', async () => {
    const token = makeToken();
    const pdfBuffer = createTestPdfBuffer();

    const res = await request(app)
      .post('/api/v1/offers')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', pdfBuffer, { filename: 'mortgage.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('id');
    expect(res.body.data.status).toBe('pending');
  });

  it('should return 400 when no file is provided', async () => {
    const token = makeToken();

    const res = await request(app)
      .post('/api/v1/offers')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

describe('GET /api/v1/offers – list offers', () => {
  it('should return paginated offers array (200)', async () => {
    const token = makeToken();

    const res = await request(app)
      .get('/api/v1/offers')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.pagination).toBeDefined();
    expect(res.body.pagination).toHaveProperty('total');
    expect(res.body.pagination).toHaveProperty('page');
    expect(res.body.pagination).toHaveProperty('limit');
  });

  it('should return offers with string IDs (Firestore format)', async () => {
    const token = makeToken();

    const res = await request(app)
      .get('/api/v1/offers')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    if (res.body.data.length > 0) {
      expect(typeof res.body.data[0].id).toBe('string');
      // Should NOT have _id (Mongoose field)
      expect(res.body.data[0]._id).toBeUndefined();
    }
  });
});

describe('GET /api/v1/offers/stats – offer statistics', () => {
  it('should return stats with total, pending, analyzed, error counts (200)', async () => {
    const token = makeToken();

    const res = await request(app)
      .get('/api/v1/offers/stats')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('total');
    expect(res.body.data).toHaveProperty('pending');
    expect(res.body.data).toHaveProperty('analyzed');
    expect(res.body.data).toHaveProperty('error');
  });
});

describe('GET /api/v1/offers/:id – get single offer', () => {
  it('should return a single offer by ID (200)', async () => {
    const token = makeToken();

    const res = await request(app)
      .get('/api/v1/offers/offer-id-xyz')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('id', 'offer-id-xyz');
    expect(res.body.data).toHaveProperty('status');
    expect(res.body.data).toHaveProperty('extractedData');
    expect(res.body.data).toHaveProperty('analysis');
  });

  it('should return 404 when offer is not found', async () => {
    const offerService = require('../src/services/offerService');
    offerService.findByIdAndUserId.mockResolvedValueOnce(null);

    const token = makeToken();

    const res = await request(app)
      .get('/api/v1/offers/nonexistent-id')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});

describe('DELETE /api/v1/offers/:id – delete offer', () => {
  it('should delete an offer and return success (200)', async () => {
    const token = makeToken();

    const res = await request(app)
      .delete('/api/v1/offers/offer-id-xyz')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toMatch(/deleted/i);
  });

  it('should return 404 when offer is not found or not owned', async () => {
    const offerService = require('../src/services/offerService');
    const notFoundErr = new Error('Offer not found or access denied');
    notFoundErr.statusCode = 404;
    offerService.deleteOffer.mockRejectedValueOnce(notFoundErr);

    const token = makeToken();

    const res = await request(app)
      .delete('/api/v1/offers/nonexistent-id')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it('should require authentication (401)', async () => {
    const res = await request(app).delete('/api/v1/offers/offer-id-xyz');
    expect(res.status).toBe(401);
  });
});
