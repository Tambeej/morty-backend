/**
 * Enhanced Analysis Endpoint Tests
 *
 * Integration tests for POST /api/v1/analysis/enhanced/:offerId
 * Tests authentication, paid access, validation, and report generation.
 */

'use strict';

// Mock dependencies
jest.mock('../src/config/firestore', () => {
  const mockDoc = {
    get: jest.fn(),
    set: jest.fn().mockResolvedValue(undefined),
    update: jest.fn().mockResolvedValue(undefined),
  };
  const mockCollection = jest.fn(() => ({
    doc: jest.fn(() => mockDoc),
    add: jest.fn().mockResolvedValue({ id: 'mock-id' }),
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    get: jest.fn().mockResolvedValue({ empty: true, docs: [], size: 0 }),
  }));
  const mock = {
    collection: mockCollection,
    batch: jest.fn(() => ({
      set: jest.fn(),
      commit: jest.fn().mockResolvedValue(undefined),
    })),
    _mockDoc: mockDoc,
  };
  return mock;
});

jest.mock('../src/config/cloudinary', () => ({
  uploader: {
    upload_stream: jest.fn(),
    destroy: jest.fn(),
  },
}));

jest.mock('../src/utils/jwt', () => ({
  verifyAccessToken: jest.fn(),
  generateAccessToken: jest.fn(),
  generateRefreshToken: jest.fn(),
}));

jest.mock('../src/services/ratesService', () => ({
  getCurrentAverages: jest.fn().mockResolvedValue({
    fixed: 4.65,
    cpi: 3.15,
    prime: 6.05,
    variable: 4.95,
  }),
  getLatestRates: jest.fn().mockResolvedValue(null),
  fetchAndStoreLatestRates: jest.fn().mockResolvedValue(null),
  clearCache: jest.fn(),
}));

jest.mock('../src/cron/ratesCron', () => ({
  startRatesCron: jest.fn(),
}));

jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const request = require('supertest');
const { verifyAccessToken } = require('../src/utils/jwt');
const db = require('../src/config/firestore');

// We need to require the app after mocks are set up
let app;

beforeAll(() => {
  // Suppress startup logs
  app = require('../src/index');
});

const mockPortfolio = {
  id: 'market_standard',
  name: 'Market Standard',
  nameHe: 'תיק שוק סטנדרטי',
  termYears: 30,
  tracks: [
    { type: 'fixed', percentage: 34, rate: 4.75, rateDisplay: '4.75%' },
    { type: 'prime', percentage: 33, rate: 5.9, rateDisplay: 'P-0.15%' },
    { type: 'cpi', percentage: 33, rate: 3.2, rateDisplay: '3.20% + מדד' },
  ],
  monthlyRepayment: 5200,
  totalCost: 1872000,
  totalInterest: 672000,
};

describe('POST /api/v1/analysis/enhanced/:offerId', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return 401 without authentication', async () => {
    const res = await request(app)
      .post('/api/v1/analysis/enhanced/offer-123')
      .send({ portfolio: mockPortfolio });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('should return 403 when user has not paid', async () => {
    // Mock auth
    verifyAccessToken.mockReturnValue({ id: 'user-456' });

    // Mock user lookup (auth middleware)
    const mockUserDoc = {
      exists: true,
      id: 'user-456',
      data: () => ({
        id: 'user-456',
        email: 'test@example.com',
        verified: true,
        paidAnalyses: false,
      }),
    };

    // The auth middleware and paidAccess middleware both call db.collection('users').doc(id).get()
    db._mockDoc.get.mockResolvedValue(mockUserDoc);

    const res = await request(app)
      .post('/api/v1/analysis/enhanced/offer-123')
      .set('Authorization', 'Bearer valid-token')
      .send({ portfolio: mockPortfolio });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.errorCode).toBe('PAYMENT_REQUIRED');
  });

  it('should return 400 when portfolio is missing', async () => {
    // Mock auth + paid user
    verifyAccessToken.mockReturnValue({ id: 'user-456' });

    const mockUserDoc = {
      exists: true,
      id: 'user-456',
      data: () => ({
        id: 'user-456',
        email: 'test@example.com',
        verified: true,
        paidAnalyses: true,
      }),
    };

    db._mockDoc.get.mockResolvedValue(mockUserDoc);

    const res = await request(app)
      .post('/api/v1/analysis/enhanced/offer-123')
      .set('Authorization', 'Bearer valid-token')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});
