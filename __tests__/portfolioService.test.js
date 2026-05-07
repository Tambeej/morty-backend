'use strict';

/**
 * Unit tests for portfolioService.getUserPortfolio(userId)
 *
 * Tests cover:
 *   - Successful portfolio retrieval from portfolios collection
 *   - Recommended portfolio selection
 *   - Fitness score-based selection
 *   - Fallback to wizardInputs collection
 *   - Null return when no data exists
 *   - Error handling (Firestore errors, index errors)
 *   - computeAverageRate helper
 *   - selectBestPortfolio helper
 *   - Edge cases (empty userId, missing fields)
 */

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('../src/config/db');
jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const { getDb } = require('../src/config/db');
const portfolioService = require('../src/services/portfolioService');

// ── Test Fixtures ─────────────────────────────────────────────────────────────

const VALID_USER_ID = 'user-abc-123';

const mockPortfolio1 = {
  id: 'portfolio-1',
  userId: VALID_USER_ID,
  type: 'market_standard',
  name: 'Market Standard',
  nameHe: 'תיק שוק סטנדרטי',
  termYears: 30,
  tracks: [
    { type: 'fixed', percentage: 34, rate: 4.75, rateDisplay: '4.75%', amount: 510000, monthlyPayment: 2660, totalCost: 957600, totalInterest: 447600 },
    { type: 'prime', percentage: 33, rate: 5.90, rateDisplay: 'P-0.15%', amount: 495000, monthlyPayment: 2940, totalCost: 1058400, totalInterest: 563400 },
    { type: 'cpi', percentage: 33, rate: 3.20, rateDisplay: '3.20% + מדד', amount: 495000, monthlyPayment: 2140, totalCost: 770400, totalInterest: 275400 },
  ],
  monthlyRepayment: 7740,
  totalCost: 2786400,
  totalInterest: 1286400,
  fitnessScore: 72,
  recommended: false,
  updatedAt: '2026-05-01T10:00:00.000Z',
  createdAt: '2026-05-01T10:00:00.000Z',
};

const mockPortfolio2 = {
  id: 'portfolio-2',
  userId: VALID_USER_ID,
  type: 'stability_first',
  name: 'Stability-First',
  nameHe: 'יציבות קודם',
  termYears: 25,
  tracks: [
    { type: 'fixed', percentage: 65, rate: 4.85, rateDisplay: '4.85%', amount: 975000, monthlyPayment: 5620, totalCost: 1686000, totalInterest: 711000 },
    { type: 'cpi', percentage: 22, rate: 3.25, rateDisplay: '3.25% + מדד', amount: 330000, monthlyPayment: 1610, totalCost: 483000, totalInterest: 153000 },
    { type: 'prime', percentage: 13, rate: 5.95, rateDisplay: 'P-0.1%', amount: 195000, monthlyPayment: 1260, totalCost: 378000, totalInterest: 183000 },
  ],
  monthlyRepayment: 8490,
  totalCost: 2547000,
  totalInterest: 1047000,
  fitnessScore: 85,
  recommended: true,
  updatedAt: '2026-05-02T12:00:00.000Z',
  createdAt: '2026-05-02T12:00:00.000Z',
};

const mockWizardInputs = {
  userId: VALID_USER_ID,
  inputs: {
    propertyPrice: 2000000,
    loanAmount: 1500000,
    monthlyIncome: 25000,
    additionalIncome: 5000,
    targetRepayment: 7000,
    stabilityPreference: 6,
    futureFunds: { timeframe: 'none', amount: 0 },
  },
  updatedAt: new Date('2026-04-15T08:00:00.000Z'),
};

// ── Helper: build Firestore mock ──────────────────────────────────────────────

/**
 * Build a Firestore mock that returns the given portfolios from the
 * portfolios collection and the given wizard doc from wizardInputs.
 */
function buildDbMock({ portfolioDocs = [], wizardDoc = null } = {}) {
  const portfolioSnapshot = {
    empty: portfolioDocs.length === 0,
    forEach: (cb) => portfolioDocs.forEach((doc) => cb(doc)),
    size: portfolioDocs.length,
  };

  const wizardSnapshot = wizardDoc
    ? { exists: true, data: () => wizardDoc }
    : { exists: false, data: () => null };

  const portfolioQuery = {
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockResolvedValue(portfolioSnapshot),
    get: jest.fn().mockResolvedValue(portfolioSnapshot),
  };
  // Make where/orderBy/limit chainable and return the query
  portfolioQuery.where.mockReturnValue(portfolioQuery);
  portfolioQuery.orderBy.mockReturnValue(portfolioQuery);
  portfolioQuery.limit.mockReturnValue(portfolioQuery);

  const wizardDocRef = {
    get: jest.fn().mockResolvedValue(wizardSnapshot),
  };

  const mockDb = {
    collection: jest.fn((collectionName) => {
      if (collectionName === 'portfolios') {
        return portfolioQuery;
      }
      if (collectionName === 'wizardInputs') {
        return {
          doc: jest.fn().mockReturnValue(wizardDocRef),
        };
      }
      return {
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({ empty: true, forEach: jest.fn() }),
        doc: jest.fn().mockReturnValue({
          get: jest.fn().mockResolvedValue({ exists: false }),
        }),
      };
    }),
  };

  return mockDb;
}

/**
 * Convert a plain portfolio object to a Firestore DocumentSnapshot-like object.
 */
function toDoc(portfolio) {
  const { id, ...data } = portfolio;
  return {
    id,
    data: () => data,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
});

// ── computeAverageRate ────────────────────────────────────────────────────────

describe('portfolioService.computeAverageRate', () => {
  it('should compute weighted average rate correctly', () => {
    const tracks = [
      { type: 'fixed', percentage: 50, rate: 4.0 },
      { type: 'prime', percentage: 50, rate: 6.0 },
    ];
    const avg = portfolioService.computeAverageRate(tracks);
    expect(avg).toBe(5.0);
  });

  it('should weight by percentage allocation', () => {
    const tracks = [
      { type: 'fixed', percentage: 70, rate: 4.0 },
      { type: 'prime', percentage: 30, rate: 6.0 },
    ];
    const avg = portfolioService.computeAverageRate(tracks);
    // (70*4 + 30*6) / 100 = (280 + 180) / 100 = 4.6
    expect(avg).toBe(4.6);
  });

  it('should return null for empty tracks array', () => {
    expect(portfolioService.computeAverageRate([])).toBeNull();
  });

  it('should return null for null input', () => {
    expect(portfolioService.computeAverageRate(null)).toBeNull();
  });

  it('should return null for non-array input', () => {
    expect(portfolioService.computeAverageRate('invalid')).toBeNull();
  });

  it('should skip tracks with zero percentage', () => {
    const tracks = [
      { type: 'fixed', percentage: 0, rate: 4.0 },
      { type: 'prime', percentage: 100, rate: 6.0 },
    ];
    const avg = portfolioService.computeAverageRate(tracks);
    expect(avg).toBe(6.0);
  });

  it('should skip tracks with non-numeric rate', () => {
    const tracks = [
      { type: 'fixed', percentage: 50, rate: 'invalid' },
      { type: 'prime', percentage: 50, rate: 6.0 },
    ];
    const avg = portfolioService.computeAverageRate(tracks);
    expect(avg).toBe(6.0);
  });

  it('should return null when all tracks have zero percentage', () => {
    const tracks = [
      { type: 'fixed', percentage: 0, rate: 4.0 },
      { type: 'prime', percentage: 0, rate: 6.0 },
    ];
    expect(portfolioService.computeAverageRate(tracks)).toBeNull();
  });
});

// ── selectBestPortfolio ───────────────────────────────────────────────────────

describe('portfolioService.selectBestPortfolio', () => {
  it('should return null for empty array', () => {
    expect(portfolioService.selectBestPortfolio([])).toBeNull();
  });

  it('should return null for null input', () => {
    expect(portfolioService.selectBestPortfolio(null)).toBeNull();
  });

  it('should prefer recommended portfolio', () => {
    const portfolios = [
      { id: '1', recommended: false, fitnessScore: 90 },
      { id: '2', recommended: true, fitnessScore: 70 },
    ];
    const best = portfolioService.selectBestPortfolio(portfolios);
    expect(best.id).toBe('2');
  });

  it('should fall back to highest fitness score when none recommended', () => {
    const portfolios = [
      { id: '1', recommended: false, fitnessScore: 60 },
      { id: '2', recommended: false, fitnessScore: 85 },
      { id: '3', recommended: false, fitnessScore: 72 },
    ];
    const best = portfolioService.selectBestPortfolio(portfolios);
    expect(best.id).toBe('2');
  });

  it('should return first portfolio when no scores and none recommended', () => {
    const portfolios = [
      { id: '1', recommended: false },
      { id: '2', recommended: false },
    ];
    const best = portfolioService.selectBestPortfolio(portfolios);
    expect(best.id).toBe('1');
  });

  it('should return single portfolio', () => {
    const portfolios = [{ id: '1', recommended: false, fitnessScore: 75 }];
    const best = portfolioService.selectBestPortfolio(portfolios);
    expect(best.id).toBe('1');
  });
});

// ── getUserPortfolio – portfolios collection ──────────────────────────────────

describe('portfolioService.getUserPortfolio – portfolios collection', () => {
  it('should return the recommended portfolio when found', async () => {
    const db = buildDbMock({
      portfolioDocs: [toDoc(mockPortfolio1), toDoc(mockPortfolio2)],
    });
    getDb.mockReturnValue(db);

    const result = await portfolioService.getUserPortfolio(VALID_USER_ID);

    expect(result).not.toBeNull();
    expect(result.id).toBe('portfolio-2'); // recommended: true
    expect(result.recommended).toBe(true);
    expect(result.source).toBe('portfolios');
  });

  it('should include computed averageRate', async () => {
    const db = buildDbMock({
      portfolioDocs: [toDoc(mockPortfolio2)],
    });
    getDb.mockReturnValue(db);

    const result = await portfolioService.getUserPortfolio(VALID_USER_ID);

    expect(result).not.toBeNull();
    expect(typeof result.averageRate).toBe('number');
    expect(result.averageRate).toBeGreaterThan(0);
  });

  it('should select highest fitness score when no recommended portfolio', async () => {
    const p1 = { ...mockPortfolio1, recommended: false, fitnessScore: 60 };
    const p2 = { ...mockPortfolio2, recommended: false, fitnessScore: 85 };

    const db = buildDbMock({
      portfolioDocs: [toDoc(p1), toDoc(p2)],
    });
    getDb.mockReturnValue(db);

    const result = await portfolioService.getUserPortfolio(VALID_USER_ID);

    expect(result).not.toBeNull();
    expect(result.id).toBe('portfolio-2'); // higher fitnessScore
  });

  it('should return single portfolio when only one exists', async () => {
    const db = buildDbMock({
      portfolioDocs: [toDoc(mockPortfolio1)],
    });
    getDb.mockReturnValue(db);

    const result = await portfolioService.getUserPortfolio(VALID_USER_ID);

    expect(result).not.toBeNull();
    expect(result.id).toBe('portfolio-1');
    expect(result.source).toBe('portfolios');
  });

  it('should query portfolios collection with correct userId filter', async () => {
    const db = buildDbMock({
      portfolioDocs: [toDoc(mockPortfolio1)],
    });
    getDb.mockReturnValue(db);

    await portfolioService.getUserPortfolio(VALID_USER_ID);

    expect(db.collection).toHaveBeenCalledWith('portfolios');
  });
});

// ── getUserPortfolio – wizardInputs fallback ──────────────────────────────────

describe('portfolioService.getUserPortfolio – wizardInputs fallback', () => {
  it('should fall back to wizardInputs when no portfolios exist', async () => {
    const db = buildDbMock({
      portfolioDocs: [],
      wizardDoc: mockWizardInputs,
    });
    getDb.mockReturnValue(db);

    const result = await portfolioService.getUserPortfolio(VALID_USER_ID);

    expect(result).not.toBeNull();
    expect(result.source).toBe('wizardInputs');
    expect(result.loanAmount).toBe(1500000);
    expect(result.propertyPrice).toBe(2000000);
  });

  it('should include wizard inputs fields in derived portfolio', async () => {
    const db = buildDbMock({
      portfolioDocs: [],
      wizardDoc: mockWizardInputs,
    });
    getDb.mockReturnValue(db);

    const result = await portfolioService.getUserPortfolio(VALID_USER_ID);

    expect(result.monthlyIncome).toBe(25000);
    expect(result.stabilityPreference).toBe(6);
    expect(result.targetRepayment).toBe(7000);
    expect(result.type).toBe('wizard_derived');
  });

  it('should return null when wizardInputs doc does not exist', async () => {
    const db = buildDbMock({
      portfolioDocs: [],
      wizardDoc: null,
    });
    getDb.mockReturnValue(db);

    const result = await portfolioService.getUserPortfolio(VALID_USER_ID);

    expect(result).toBeNull();
  });

  it('should return null when wizardInputs missing required fields', async () => {
    const incompleteWizard = { userId: VALID_USER_ID, inputs: { monthlyIncome: 25000 } };
    const db = buildDbMock({
      portfolioDocs: [],
      wizardDoc: incompleteWizard,
    });
    getDb.mockReturnValue(db);

    const result = await portfolioService.getUserPortfolio(VALID_USER_ID);

    expect(result).toBeNull();
  });
});

// ── getUserPortfolio – null / empty userId ────────────────────────────────────

describe('portfolioService.getUserPortfolio – edge cases', () => {
  it('should return null for empty string userId', async () => {
    const result = await portfolioService.getUserPortfolio('');
    expect(result).toBeNull();
  });

  it('should return null for null userId', async () => {
    const result = await portfolioService.getUserPortfolio(null);
    expect(result).toBeNull();
  });

  it('should return null for undefined userId', async () => {
    const result = await portfolioService.getUserPortfolio(undefined);
    expect(result).toBeNull();
  });
});

// ── getUserPortfolio – error handling ────────────────────────────────────────

describe('portfolioService.getUserPortfolio – error handling', () => {
  it('should return null when portfolios collection throws unexpected error', async () => {
    const mockDb = {
      collection: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        get: jest.fn().mockRejectedValue(new Error('Firestore connection failed')),
        doc: jest.fn().mockReturnValue({
          get: jest.fn().mockResolvedValue({ exists: false }),
        }),
      }),
    };
    getDb.mockReturnValue(mockDb);

    const result = await portfolioService.getUserPortfolio(VALID_USER_ID);

    // Should return null gracefully, not throw
    expect(result).toBeNull();
  });

  it('should handle Firestore index error and retry without orderBy', async () => {
    const indexError = new Error('The query requires an index');
    indexError.code = 9; // FAILED_PRECONDITION

    const portfolioDoc = toDoc(mockPortfolio1);
    const portfolioSnapshot = {
      empty: false,
      forEach: (cb) => cb(portfolioDoc),
      size: 1,
    };

    let callCount = 0;
    const mockQuery = {
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      get: jest.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.reject(indexError);
        }
        return Promise.resolve(portfolioSnapshot);
      }),
    };
    mockQuery.where.mockReturnValue(mockQuery);
    mockQuery.orderBy.mockReturnValue(mockQuery);
    mockQuery.limit.mockReturnValue(mockQuery);

    const mockDb = {
      collection: jest.fn().mockReturnValue(mockQuery),
    };
    getDb.mockReturnValue(mockDb);

    const result = await portfolioService.getUserPortfolio(VALID_USER_ID);

    // Should recover and return the portfolio from the retry
    expect(result).not.toBeNull();
    expect(result.id).toBe('portfolio-1');
  });

  it('should return null when wizardInputs collection throws', async () => {
    const portfolioQuery = {
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      get: jest.fn().mockResolvedValue({ empty: true, forEach: jest.fn() }),
    };
    portfolioQuery.where.mockReturnValue(portfolioQuery);
    portfolioQuery.orderBy.mockReturnValue(portfolioQuery);
    portfolioQuery.limit.mockReturnValue(portfolioQuery);

    const mockDb = {
      collection: jest.fn((name) => {
        if (name === 'portfolios') return portfolioQuery;
        return {
          doc: jest.fn().mockReturnValue({
            get: jest.fn().mockRejectedValue(new Error('wizardInputs error')),
          }),
        };
      }),
    };
    getDb.mockReturnValue(mockDb);

    const result = await portfolioService.getUserPortfolio(VALID_USER_ID);

    // wizardInputs error is caught internally, returns null
    expect(result).toBeNull();
  });
});

// ── fetchFromWizardInputs – data shape variants ───────────────────────────────

describe('portfolioService.fetchFromWizardInputs – data shape variants', () => {
  it('should handle wizard doc where inputs are at root level (no nested inputs field)', async () => {
    // Some wizard docs store inputs at root level
    const flatWizardDoc = {
      userId: VALID_USER_ID,
      propertyPrice: 2000000,
      loanAmount: 1500000,
      monthlyIncome: 20000,
      stabilityPreference: 5,
      targetRepayment: 6500,
    };

    const db = buildDbMock({
      portfolioDocs: [],
      wizardDoc: flatWizardDoc,
    });
    getDb.mockReturnValue(db);

    const result = await portfolioService.getUserPortfolio(VALID_USER_ID);

    expect(result).not.toBeNull();
    expect(result.loanAmount).toBe(1500000);
    expect(result.source).toBe('wizardInputs');
  });
});
