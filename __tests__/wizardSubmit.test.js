/**
 * Integration tests for POST /api/v1/public/wizard/submit
 *
 * Tests the wizard submit endpoint using supertest against the Express app.
 * The Firestore and external services are mocked.
 */

'use strict';

const request = require('supertest');

// ── Environment setup ─────────────────────────────────────────────────────────
process.env.JWT_SECRET = 'test-jwt-secret-for-testing-only-32chars';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-for-testing-only-32chars';
process.env.NODE_ENV = 'test';

// ── Mock Firestore ────────────────────────────────────────────────────────────
jest.mock('../src/config/firestore', () => {
  const firestoreMock = {
    collection: jest.fn(() => ({
      doc: jest.fn(() => ({
        get: jest.fn().mockResolvedValue({ exists: false }),
        set: jest.fn().mockResolvedValue(undefined),
      })),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      get: jest.fn().mockResolvedValue({ docs: [] }),
    })),
    batch: jest.fn(() => ({
      set: jest.fn(),
      commit: jest.fn().mockResolvedValue(undefined),
    })),
  };
  firestoreMock.getFirestore = () => firestoreMock;
  return firestoreMock;
});

jest.mock('../src/config/firebase', () => ({
  admin: {
    auth: () => ({
      verifyIdToken: jest.fn(),
    }),
  },
  db: { collection: jest.fn() },
  firebaseApp: {},
}));

jest.mock('../src/services/userService', () => ({
  createUser: jest.fn(),
  findByEmail: jest.fn(),
  findById: jest.fn(),
  getUserById: jest.fn(),
  findOrCreateByFirebaseUser: jest.fn(),
  setRefreshToken: jest.fn().mockResolvedValue(undefined),
  clearRefreshToken: jest.fn().mockResolvedValue(undefined),
  clearRefreshTokenByValue: jest.fn().mockResolvedValue(undefined),
  verifyPassword: jest.fn(),
  toPublicUser: jest.fn(),
}));

// Mock ratesService to return predictable rates
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

const app = require('../src/index');

// ── Test Data ─────────────────────────────────────────────────────────────────

const VALID_PAYLOAD = {
  inputs: {
    propertyPrice: 2000000,
    loanAmount: 1500000,
    monthlyIncome: 25000,
    additionalIncome: 5000,
    targetRepayment: 7000,
    futureFunds: { timeframe: 'none', amount: 0 },
    stabilityPreference: 5,
  },
  consent: true,
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/v1/public/wizard/submit', () => {
  describe('validation', () => {
    it('should reject empty body (422)', async () => {
      const res = await request(app)
        .post('/api/v1/public/wizard/submit')
        .send({});

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should reject missing inputs (422)', async () => {
      const res = await request(app)
        .post('/api/v1/public/wizard/submit')
        .send({ consent: true });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
    });

    it('should reject missing consent (422)', async () => {
      const res = await request(app)
        .post('/api/v1/public/wizard/submit')
        .send({ inputs: VALID_PAYLOAD.inputs });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
    });

    it('should reject propertyPrice below minimum (422)', async () => {
      const res = await request(app)
        .post('/api/v1/public/wizard/submit')
        .send({
          ...VALID_PAYLOAD,
          inputs: { ...VALID_PAYLOAD.inputs, propertyPrice: 50000 },
        });

      expect(res.status).toBe(422);
    });

    it('should reject loanAmount below minimum (422)', async () => {
      const res = await request(app)
        .post('/api/v1/public/wizard/submit')
        .send({
          ...VALID_PAYLOAD,
          inputs: { ...VALID_PAYLOAD.inputs, loanAmount: 10000 },
        });

      expect(res.status).toBe(422);
    });

    it('should reject stabilityPreference outside 1-10 range (422)', async () => {
      const res = await request(app)
        .post('/api/v1/public/wizard/submit')
        .send({
          ...VALID_PAYLOAD,
          inputs: { ...VALID_PAYLOAD.inputs, stabilityPreference: 11 },
        });

      expect(res.status).toBe(422);
    });

    it('should reject non-integer stabilityPreference (422)', async () => {
      const res = await request(app)
        .post('/api/v1/public/wizard/submit')
        .send({
          ...VALID_PAYLOAD,
          inputs: { ...VALID_PAYLOAD.inputs, stabilityPreference: 5.5 },
        });

      expect(res.status).toBe(422);
    });

    it('should reject invalid futureFunds timeframe (422)', async () => {
      const res = await request(app)
        .post('/api/v1/public/wizard/submit')
        .send({
          ...VALID_PAYLOAD,
          inputs: {
            ...VALID_PAYLOAD.inputs,
            futureFunds: { timeframe: 'invalid_value', amount: 0 },
          },
        });

      expect(res.status).toBe(422);
    });

    it('should reject loanAmount exceeding propertyPrice (422)', async () => {
      const res = await request(app)
        .post('/api/v1/public/wizard/submit')
        .send({
          ...VALID_PAYLOAD,
          inputs: {
            ...VALID_PAYLOAD.inputs,
            propertyPrice: 1000000,
            loanAmount: 1500000,
          },
        });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('BUSINESS_VALIDATION_ERROR');
    });

    it('should reject target repayment exceeding 80% of income (422)', async () => {
      const res = await request(app)
        .post('/api/v1/public/wizard/submit')
        .send({
          ...VALID_PAYLOAD,
          inputs: {
            ...VALID_PAYLOAD.inputs,
            monthlyIncome: 10000,
            additionalIncome: 0,
            targetRepayment: 9000, // 90% of income
          },
        });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('BUSINESS_VALIDATION_ERROR');
    });
  });

  describe('successful submission', () => {
    it('should return 200 with portfolios for valid input', async () => {
      const res = await request(app)
        .post('/api/v1/public/wizard/submit')
        .send(VALID_PAYLOAD);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('portfolios');
      expect(res.body.data).toHaveProperty('communityTips');
      expect(res.body.data).toHaveProperty('metadata');
    });

    it('should return at least 2 portfolios', async () => {
      const res = await request(app)
        .post('/api/v1/public/wizard/submit')
        .send(VALID_PAYLOAD);

      expect(res.body.data.portfolios.length).toBeGreaterThanOrEqual(2);
    });

    it('should return at most 4 portfolios', async () => {
      const res = await request(app)
        .post('/api/v1/public/wizard/submit')
        .send({
          ...VALID_PAYLOAD,
          inputs: { ...VALID_PAYLOAD.inputs, stabilityPreference: 8 },
        });

      expect(res.body.data.portfolios.length).toBeLessThanOrEqual(4);
    });

    it('should always include Market Standard and Fast Track', async () => {
      const res = await request(app)
        .post('/api/v1/public/wizard/submit')
        .send(VALID_PAYLOAD);

      const types = res.body.data.portfolios.map((p) => p.type);
      expect(types).toContain('market_standard');
      expect(types).toContain('fast_track');
    });

    it('should include Stability-First for high stability preference', async () => {
      const res = await request(app)
        .post('/api/v1/public/wizard/submit')
        .send({
          ...VALID_PAYLOAD,
          inputs: { ...VALID_PAYLOAD.inputs, stabilityPreference: 9 },
        });

      const types = res.body.data.portfolios.map((p) => p.type);
      expect(types).toContain('stability_first');
    });

    it('should return portfolios with correct structure', async () => {
      const res = await request(app)
        .post('/api/v1/public/wizard/submit')
        .send(VALID_PAYLOAD);

      const portfolio = res.body.data.portfolios[0];

      expect(portfolio).toHaveProperty('id');
      expect(portfolio).toHaveProperty('type');
      expect(portfolio).toHaveProperty('name');
      expect(portfolio).toHaveProperty('nameHe');
      expect(portfolio).toHaveProperty('description');
      expect(portfolio).toHaveProperty('termYears');
      expect(portfolio).toHaveProperty('tracks');
      expect(portfolio).toHaveProperty('monthlyRepayment');
      expect(portfolio).toHaveProperty('totalCost');
      expect(portfolio).toHaveProperty('totalInterest');
      expect(portfolio).toHaveProperty('interestSavings');
      expect(portfolio).toHaveProperty('recommended');
    });

    it('should return tracks with correct structure', async () => {
      const res = await request(app)
        .post('/api/v1/public/wizard/submit')
        .send(VALID_PAYLOAD);

      const track = res.body.data.portfolios[0].tracks[0];

      expect(track).toHaveProperty('name');
      expect(track).toHaveProperty('nameEn');
      expect(track).toHaveProperty('type');
      expect(track).toHaveProperty('percentage');
      expect(track).toHaveProperty('rate');
      expect(track).toHaveProperty('rateDisplay');
      expect(track).toHaveProperty('amount');
      expect(track).toHaveProperty('monthlyPayment');
      expect(track).toHaveProperty('totalCost');
      expect(track).toHaveProperty('totalInterest');
    });

    it('should return metadata with input summary', async () => {
      const res = await request(app)
        .post('/api/v1/public/wizard/submit')
        .send(VALID_PAYLOAD);

      const meta = res.body.data.metadata;

      expect(meta).toHaveProperty('generatedAt');
      expect(meta).toHaveProperty('ratesSource');
      expect(meta).toHaveProperty('generationMethod');
      expect(meta).toHaveProperty('processingTimeMs');
      expect(meta.inputSummary).toHaveProperty('propertyPrice', 2000000);
      expect(meta.inputSummary).toHaveProperty('loanAmount', 1500000);
      expect(meta.inputSummary).toHaveProperty('ltv', 75);
    });

    it('should accept consent=false', async () => {
      const res = await request(app)
        .post('/api/v1/public/wizard/submit')
        .send({ ...VALID_PAYLOAD, consent: false });

      expect(res.status).toBe(200);
      expect(res.body.data.metadata.consent).toBe(false);
    });

    it('should accept additionalIncome as optional (defaults to 0)', async () => {
      const inputsWithoutAdditional = { ...VALID_PAYLOAD.inputs };
      delete inputsWithoutAdditional.additionalIncome;

      const res = await request(app)
        .post('/api/v1/public/wizard/submit')
        .send({ inputs: inputsWithoutAdditional, consent: true });

      expect(res.status).toBe(200);
    });

    it('should accept futureFunds with amount when timeframe is not none', async () => {
      const res = await request(app)
        .post('/api/v1/public/wizard/submit')
        .send({
          ...VALID_PAYLOAD,
          inputs: {
            ...VALID_PAYLOAD.inputs,
            futureFunds: { timeframe: 'within_5_years', amount: 200000 },
          },
        });

      expect(res.status).toBe(200);
    });

    it('should not include _generationMethod in portfolio response', async () => {
      const res = await request(app)
        .post('/api/v1/public/wizard/submit')
        .send(VALID_PAYLOAD);

      for (const portfolio of res.body.data.portfolios) {
        expect(portfolio).not.toHaveProperty('_generationMethod');
      }
    });
  });

  describe('communityTips', () => {
    it('should return empty communityTips array (placeholder for future task)', async () => {
      const res = await request(app)
        .post('/api/v1/public/wizard/submit')
        .send(VALID_PAYLOAD);

      expect(res.body.data.communityTips).toEqual([]);
    });
  });
});
