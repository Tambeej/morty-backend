'use strict';

/**
 * Integration tests for POST /api/v1/analysis/:offerId/enhanced
 *
 * Mocks:
 * - Firebase Admin SDK (auth + firestore)
 * - offerService
 * - portfolioService
 * - reportService
 */

const request = require('supertest');

// ─── Mock Firebase Admin ──────────────────────────────────────────────────────
jest.mock('../src/config/firebase', () => ({
  initializeFirebase: jest.fn(),
  getAuth: jest.fn(() => ({
    verifyIdToken: jest.fn(),
  })),
  getFirestore: jest.fn(() => ({
    collection: jest.fn(),
  })),
  admin: {},
}));

// ─── Mock DB ──────────────────────────────────────────────────────────────────
jest.mock('../src/config/db', () => ({
  getDb: jest.fn(),
}));

// ─── Mock Services ────────────────────────────────────────────────────────────
jest.mock('../src/services/offerService');
jest.mock('../src/services/portfolioService');
jest.mock('../src/services/reportService');

const { getAuth } = require('../src/config/firebase');
const { getDb } = require('../src/config/db');
const offerService = require('../src/services/offerService');
const portfolioService = require('../src/services/portfolioService');
const reportService = require('../src/services/reportService');

// ─── Test fixtures ────────────────────────────────────────────────────────────
const VALID_OFFER_ID = 'offer123abc';
const VALID_USER_ID = 'user456def';
const VALID_TOKEN = 'valid-firebase-token';

const mockUser = {
  uid: VALID_USER_ID,
  email: 'test@example.com',
  paidAnalyses: true,
};

const mockOffer = {
  id: VALID_OFFER_ID,
  userId: VALID_USER_ID,
  bankName: 'Bank Hapoalim',
  status: 'analyzed',
  analysis: {
    terms: {
      loanAmount: 1500000,
      termYears: 25,
      interestRate: 5.2,
    },
  },
};

const mockPortfolio = {
  id: 'portfolio789',
  userId: VALID_USER_ID,
  averageRate: 4.75,
  tracks: [
    { type: 'fixed', rate: 4.75, amount: 750000 },
    { type: 'prime', rate: 4.5, amount: 750000 },
  ],
};

const mockEnhancedReport = {
  tricks: [
    {
      nameHe: 'מסלול פיתיון',
      nameEn: 'Enticement Track',
      descriptionHe: 'תיאור בעברית',
      descriptionEn: 'Description in English',
      applicability: 'high',
      riskLevel: 'medium',
      potentialSavings: 22000,
    },
  ],
  negotiationScript: 'שלום, שמי [שם]...',
  insights: [
    {
      titleHe: 'ניתוח ריבית',
      titleEn: 'Rate Analysis',
      bodyHe: 'גוף בעברית',
      bodyEn: 'Body in English',
      icon: 'trending-down',
    },
  ],
  comparison: {
    rateDelta: 0.45,
    monthlySaving: 412,
    totalSaving: 123600,
    loanAmount: 1500000,
    termYears: 25,
    bankRate: 5.2,
    portfolioRate: 4.75,
    trackComparison: [],
  },
  generatedAt: '2026-05-07T12:00:00.000Z',
  generatedBy: 'ai',
  processingTimeMs: 1500,
};

// ─── Setup ────────────────────────────────────────────────────────────────────

let app;

beforeAll(() => {
  // Setup Firebase auth mock
  getAuth.mockReturnValue({
    verifyIdToken: jest.fn().mockResolvedValue({ uid: VALID_USER_ID, email: mockUser.email }),
  });

  // Setup Firestore mock for user lookup in protect middleware
  const mockUserDoc = {
    exists: true,
    data: () => mockUser,
  };
  const mockCollection = jest.fn().mockReturnValue({
    doc: jest.fn().mockReturnValue({
      get: jest.fn().mockResolvedValue(mockUserDoc),
    }),
  });
  getDb.mockReturnValue({ collection: mockCollection });

  // Load app after mocks are set up
  app = require('../src/index');
});

afterEach(() => {
  jest.clearAllMocks();

  // Re-apply persistent mocks after clearAllMocks
  getAuth.mockReturnValue({
    verifyIdToken: jest.fn().mockResolvedValue({ uid: VALID_USER_ID, email: mockUser.email }),
  });

  const mockUserDoc = {
    exists: true,
    data: () => mockUser,
  };
  const mockCollection = jest.fn().mockReturnValue({
    doc: jest.fn().mockReturnValue({
      get: jest.fn().mockResolvedValue(mockUserDoc),
    }),
  });
  getDb.mockReturnValue({ collection: mockCollection });
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('POST /api/v1/analysis/:offerId/enhanced', () => {
  // ── Authentication ──────────────────────────────────────────────────────────

  describe('Authentication', () => {
    it('should return 401 when no Authorization header is provided', async () => {
      const res = await request(app)
        .post(`/api/v1/analysis/${VALID_OFFER_ID}/enhanced`)
        .expect(401);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should return 401 when Authorization header is malformed', async () => {
      const res = await request(app)
        .post(`/api/v1/analysis/${VALID_OFFER_ID}/enhanced`)
        .set('Authorization', 'InvalidFormat token123')
        .expect(401);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should return 401 when Firebase token is invalid', async () => {
      getAuth.mockReturnValue({
        verifyIdToken: jest.fn().mockRejectedValue(new Error('Invalid token')),
      });

      const res = await request(app)
        .post(`/api/v1/analysis/${VALID_OFFER_ID}/enhanced`)
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should return 401 when user document does not exist in Firestore', async () => {
      getAuth.mockReturnValue({
        verifyIdToken: jest.fn().mockResolvedValue({ uid: 'ghost-user', email: 'ghost@test.com' }),
      });

      const mockCollection = jest.fn().mockReturnValue({
        doc: jest.fn().mockReturnValue({
          get: jest.fn().mockResolvedValue({ exists: false }),
        }),
      });
      getDb.mockReturnValue({ collection: mockCollection });

      const res = await request(app)
        .post(`/api/v1/analysis/${VALID_OFFER_ID}/enhanced`)
        .set('Authorization', `Bearer ${VALID_TOKEN}`)
        .expect(401);

      expect(res.body.success).toBe(false);
    });
  });

  // ── Paid Access ─────────────────────────────────────────────────────────────

  describe('Paid Access', () => {
    it('should return 403 when user has not paid (paidAnalyses = false)', async () => {
      const unpaidUser = { ...mockUser, paidAnalyses: false };
      const mockUserDoc = { exists: true, data: () => unpaidUser };
      const mockCollection = jest.fn().mockReturnValue({
        doc: jest.fn().mockReturnValue({
          get: jest.fn().mockResolvedValue(mockUserDoc),
        }),
      });
      getDb.mockReturnValue({ collection: mockCollection });

      const res = await request(app)
        .post(`/api/v1/analysis/${VALID_OFFER_ID}/enhanced`)
        .set('Authorization', `Bearer ${VALID_TOKEN}`)
        .expect(403);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('should return 403 when user has no paidAnalyses field', async () => {
      const unpaidUser = { uid: VALID_USER_ID, email: 'test@example.com' };
      const mockUserDoc = { exists: true, data: () => unpaidUser };
      const mockCollection = jest.fn().mockReturnValue({
        doc: jest.fn().mockReturnValue({
          get: jest.fn().mockResolvedValue(mockUserDoc),
        }),
      });
      getDb.mockReturnValue({ collection: mockCollection });

      const res = await request(app)
        .post(`/api/v1/analysis/${VALID_OFFER_ID}/enhanced`)
        .set('Authorization', `Bearer ${VALID_TOKEN}`)
        .expect(403);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });

  // ── Input Validation ────────────────────────────────────────────────────────

  describe('Input Validation', () => {
    it('should return 400 when offerId contains invalid characters', async () => {
      const res = await request(app)
        .post('/api/v1/analysis/invalid!@#offer/enhanced')
        .set('Authorization', `Bearer ${VALID_TOKEN}`)
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 when offerId is too long', async () => {
      const longId = 'a'.repeat(129);
      const res = await request(app)
        .post(`/api/v1/analysis/${longId}/enhanced`)
        .set('Authorization', `Bearer ${VALID_TOKEN}`)
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  // ── Successful Generation ───────────────────────────────────────────────────

  describe('Successful Report Generation', () => {
    beforeEach(() => {
      offerService.findByIdAndUserId.mockResolvedValue(mockOffer);
      portfolioService.getUserPortfolio.mockResolvedValue(mockPortfolio);
      reportService.generateEnhancedReport.mockResolvedValue(mockEnhancedReport);
    });

    it('should return 201 with enhanced report on first generation', async () => {
      const res = await request(app)
        .post(`/api/v1/analysis/${VALID_OFFER_ID}/enhanced`)
        .set('Authorization', `Bearer ${VALID_TOKEN}`)
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.tricks).toHaveLength(1);
      expect(res.body.data.negotiationScript).toBe('שלום, שמי [שם]...');
      expect(res.body.data.insights).toHaveLength(1);
      expect(res.body.data.comparison).toBeDefined();
    });

    it('should call offerService.findByIdAndUserId with correct params', async () => {
      await request(app)
        .post(`/api/v1/analysis/${VALID_OFFER_ID}/enhanced`)
        .set('Authorization', `Bearer ${VALID_TOKEN}`);

      expect(offerService.findByIdAndUserId).toHaveBeenCalledWith(
        VALID_OFFER_ID,
        VALID_USER_ID
      );
    });

    it('should call portfolioService.getUserPortfolio with userId', async () => {
      await request(app)
        .post(`/api/v1/analysis/${VALID_OFFER_ID}/enhanced`)
        .set('Authorization', `Bearer ${VALID_TOKEN}`);

      expect(portfolioService.getUserPortfolio).toHaveBeenCalledWith(VALID_USER_ID);
    });

    it('should call reportService.generateEnhancedReport with correct params', async () => {
      await request(app)
        .post(`/api/v1/analysis/${VALID_OFFER_ID}/enhanced`)
        .set('Authorization', `Bearer ${VALID_TOKEN}`);

      expect(reportService.generateEnhancedReport).toHaveBeenCalledWith(
        VALID_OFFER_ID,
        VALID_USER_ID,
        mockOffer,
        mockPortfolio
      );
    });

    it('should return 200 with cached report when analysis.enhanced already exists', async () => {
      const offerWithEnhanced = {
        ...mockOffer,
        analysis: {
          ...mockOffer.analysis,
          enhanced: mockEnhancedReport,
        },
      };
      offerService.findByIdAndUserId.mockResolvedValue(offerWithEnhanced);

      const res = await request(app)
        .post(`/api/v1/analysis/${VALID_OFFER_ID}/enhanced`)
        .set('Authorization', `Bearer ${VALID_TOKEN}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
      // Should NOT call generateEnhancedReport when cached
      expect(reportService.generateEnhancedReport).not.toHaveBeenCalled();
    });

    it('should work when user has no portfolio (null portfolio)', async () => {
      portfolioService.getUserPortfolio.mockResolvedValue(null);

      const res = await request(app)
        .post(`/api/v1/analysis/${VALID_OFFER_ID}/enhanced`)
        .set('Authorization', `Bearer ${VALID_TOKEN}`)
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(reportService.generateEnhancedReport).toHaveBeenCalledWith(
        VALID_OFFER_ID,
        VALID_USER_ID,
        mockOffer,
        null
      );
    });
  });

  // ── Ownership Validation ────────────────────────────────────────────────────

  describe('Ownership Validation', () => {
    it('should return 404 when offer does not exist', async () => {
      const { NotFoundError } = require('../src/utils/errors');
      offerService.findByIdAndUserId.mockRejectedValue(
        new NotFoundError(`Offer with ID '${VALID_OFFER_ID}' not found`)
      );

      const res = await request(app)
        .post(`/api/v1/analysis/${VALID_OFFER_ID}/enhanced`)
        .set('Authorization', `Bearer ${VALID_TOKEN}`)
        .expect(404);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('should return 403 when offer belongs to a different user', async () => {
      const { ForbiddenError } = require('../src/utils/errors');
      offerService.findByIdAndUserId.mockRejectedValue(
        new ForbiddenError('You do not have permission to access this offer')
      );

      const res = await request(app)
        .post(`/api/v1/analysis/${VALID_OFFER_ID}/enhanced`)
        .set('Authorization', `Bearer ${VALID_TOKEN}`)
        .expect(403);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });

  // ── Error Handling ──────────────────────────────────────────────────────────

  describe('Error Handling', () => {
    beforeEach(() => {
      offerService.findByIdAndUserId.mockResolvedValue(mockOffer);
      portfolioService.getUserPortfolio.mockResolvedValue(mockPortfolio);
    });

    it('should return 500 when reportService throws an unexpected error', async () => {
      reportService.generateEnhancedReport.mockRejectedValue(
        new Error('Unexpected internal error')
      );

      const res = await request(app)
        .post(`/api/v1/analysis/${VALID_OFFER_ID}/enhanced`)
        .set('Authorization', `Bearer ${VALID_TOKEN}`)
        .expect(500);

      expect(res.body.success).toBe(false);
    });

    it('should return 500 when portfolioService throws an unexpected error', async () => {
      portfolioService.getUserPortfolio.mockRejectedValue(
        new Error('Database connection failed')
      );

      const res = await request(app)
        .post(`/api/v1/analysis/${VALID_OFFER_ID}/enhanced`)
        .set('Authorization', `Bearer ${VALID_TOKEN}`)
        .expect(500);

      expect(res.body.success).toBe(false);
    });
  });

  // ── Response Shape ──────────────────────────────────────────────────────────

  describe('Response Shape', () => {
    beforeEach(() => {
      offerService.findByIdAndUserId.mockResolvedValue(mockOffer);
      portfolioService.getUserPortfolio.mockResolvedValue(mockPortfolio);
      reportService.generateEnhancedReport.mockResolvedValue(mockEnhancedReport);
    });

    it('should return correct response structure', async () => {
      const res = await request(app)
        .post(`/api/v1/analysis/${VALID_OFFER_ID}/enhanced`)
        .set('Authorization', `Bearer ${VALID_TOKEN}`)
        .expect(201);

      expect(res.body).toMatchObject({
        success: true,
        message: expect.any(String),
        data: {
          tricks: expect.any(Array),
          negotiationScript: expect.any(String),
          insights: expect.any(Array),
          comparison: expect.any(Object),
          generatedAt: expect.any(String),
          generatedBy: expect.any(String),
          processingTimeMs: expect.any(Number),
        },
      });
    });

    it('should include trick with required fields', async () => {
      const res = await request(app)
        .post(`/api/v1/analysis/${VALID_OFFER_ID}/enhanced`)
        .set('Authorization', `Bearer ${VALID_TOKEN}`)
        .expect(201);

      const trick = res.body.data.tricks[0];
      expect(trick).toHaveProperty('nameHe');
      expect(trick).toHaveProperty('nameEn');
      expect(trick).toHaveProperty('descriptionHe');
      expect(trick).toHaveProperty('descriptionEn');
      expect(trick).toHaveProperty('applicability');
      expect(trick).toHaveProperty('riskLevel');
    });

    it('should include insight with required fields', async () => {
      const res = await request(app)
        .post(`/api/v1/analysis/${VALID_OFFER_ID}/enhanced`)
        .set('Authorization', `Bearer ${VALID_TOKEN}`)
        .expect(201);

      const insight = res.body.data.insights[0];
      expect(insight).toHaveProperty('titleHe');
      expect(insight).toHaveProperty('titleEn');
      expect(insight).toHaveProperty('bodyHe');
      expect(insight).toHaveProperty('bodyEn');
      expect(insight).toHaveProperty('icon');
    });
  });
});
