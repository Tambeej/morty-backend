'use strict';

/**
 * Integration tests for reportService.generateEnhancedReport() call
 * as invoked from analysisController.generateEnhancedReport().
 *
 * Task 3: Verify that the controller correctly calls
 * reportService.generateEnhancedReport(offerId, userId, offer, portfolio)
 * and that the service produces a valid enhanced report.
 *
 * These tests focus on the call contract between the controller and
 * reportService, and the internal behaviour of generateEnhancedReport.
 */

jest.mock('../src/services/aiService');
jest.mock('../src/services/offerService');

const { callGPT } = require('../src/services/aiService');
const { updateEnhancedAnalysis } = require('../src/services/offerService');
const {
  generateEnhancedReport,
  buildComparison,
  sanitizeTrick,
  sanitizeInsight,
  generateFallbackReport,
} = require('../src/services/reportService');

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const OFFER_ID = 'offer-abc-123';
const USER_ID = 'user-xyz-456';

const mockOffer = {
  id: OFFER_ID,
  userId: USER_ID,
  bankName: 'Bank Leumi',
  status: 'analyzed',
  analysis: {
    terms: {
      loanAmount: 2000000,
      termYears: 30,
      interestRate: 5.5,
      tracks: [
        { type: 'fixed', name: 'קל"צ', rate: 5.5 },
        { type: 'prime', name: 'פריים', rate: 6.2 },
      ],
    },
  },
};

const mockPortfolio = {
  id: 'portfolio-001',
  userId: USER_ID,
  type: 'market_standard',
  name: 'Market Standard',
  nameHe: 'תיק שוק סטנדרטי',
  termYears: 30,
  averageRate: 4.8,
  tracks: [
    { type: 'fixed', name: 'קל"צ', rate: 4.75, percentage: 34, amount: 680000 },
    { type: 'prime', name: 'פריים', rate: 5.9, percentage: 33, amount: 660000 },
    { type: 'cpi', name: 'צמוד מדד', rate: 3.2, percentage: 33, amount: 660000 },
  ],
  monthlyRepayment: 10800,
  totalCost: 3888000,
  totalInterest: 1888000,
  recommended: true,
  source: 'portfolios',
};

const mockAIResponse = {
  tricks: [
    {
      nameHe: 'מסלול פיתיון',
      nameEn: 'Enticement Track',
      descriptionHe: 'קחו מסלול בריבית גבוהה כדי להוריד ריביות אחרות.',
      descriptionEn: 'Take a high-interest track to lower rates on other tracks.',
      applicability: 'high',
      riskLevel: 'medium',
      potentialSavings: 35000,
    },
    {
      nameHe: 'פיצול מסלולים',
      nameEn: 'Track Splitting',
      descriptionHe: 'פצלו את ההלוואה למספר מסלולים לפיזור סיכונים.',
      descriptionEn: 'Split the loan across multiple tracks to diversify risk.',
      applicability: 'high',
      riskLevel: 'low',
      potentialSavings: null,
    },
    {
      nameHe: 'מיחזור מוקדם',
      nameEn: 'Early Refinancing',
      descriptionHe: 'תכננו מיחזור לאחר 3-5 שנים אם הריביות ירדו.',
      descriptionEn: 'Plan refinancing after 3-5 years if rates drop.',
      applicability: 'medium',
      riskLevel: 'low',
      potentialSavings: null,
    },
  ],
  negotiationScript:
    'שלום, שמי [שם]. אני מעוניין/ת במשכנתא בסך 2,000,000 ₪ ל-30 שנים.\n\n' +
    'בדקתי את נתוני בנק ישראל העדכניים וראיתי שהממוצע לריבית קבועה לא צמודה עומד על 4.75%.\n\n' +
    'הצעת הבנק שקיבלתי עומדת על 5.5%, שהיא +0.75% מעל הממוצע. אני מבקש/ת שתתאימו את ההצעה.',
  insights: [
    {
      titleHe: 'ניתוח הריבית',
      titleEn: 'Rate Analysis',
      bodyHe: 'הריבית המוצעת גבוהה ב-0.7% מהממוצע בשוק. יש מקום משמעותי למשא ומתן.',
      bodyEn: 'The offered rate is 0.7% above market average. There is significant room for negotiation.',
      icon: 'trending-down',
    },
    {
      titleHe: 'המלצת מסלול',
      titleEn: 'Track Recommendation',
      bodyHe: 'שקלו שילוב של מסלול קל"צ ופריים לאיזון בין יציבות לגמישות.',
      bodyEn: 'Consider combining fixed and prime tracks for a balance of stability and flexibility.',
      icon: 'target',
    },
    {
      titleHe: 'תכנון עתידי',
      titleEn: 'Future Planning',
      bodyHe: 'תכננו מיחזור בעוד 5 שנים בהתאם לשינויי הריבית בשוק.',
      bodyEn: 'Plan refinancing in 5 years based on market rate changes.',
      icon: 'calendar',
    },
  ],
};

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  updateEnhancedAnalysis.mockResolvedValue(undefined);
  jest.clearAllMocks();
  updateEnhancedAnalysis.mockResolvedValue(undefined);
});

// ─── Call Signature Tests ─────────────────────────────────────────────────────

describe('reportService.generateEnhancedReport — call contract', () => {
  it('accepts (offerId, userId, offer, portfolio) as positional arguments', async () => {
    callGPT.mockResolvedValue(mockAIResponse);
    process.env.OPENAI_API_KEY = 'test-key';

    // Should not throw when called with the expected 4-argument signature
    await expect(
      generateEnhancedReport(OFFER_ID, USER_ID, mockOffer, mockPortfolio)
    ).resolves.toBeDefined();
  });

  it('accepts null portfolio as 4th argument (no portfolio scenario)', async () => {
    callGPT.mockResolvedValue(mockAIResponse);
    process.env.OPENAI_API_KEY = 'test-key';

    await expect(
      generateEnhancedReport(OFFER_ID, USER_ID, mockOffer, null)
    ).resolves.toBeDefined();
  });

  it('passes offerId to updateEnhancedAnalysis for persistence', async () => {
    callGPT.mockResolvedValue(mockAIResponse);
    process.env.OPENAI_API_KEY = 'test-key';

    await generateEnhancedReport(OFFER_ID, USER_ID, mockOffer, mockPortfolio);

    expect(updateEnhancedAnalysis).toHaveBeenCalledWith(
      OFFER_ID,
      expect.objectContaining({
        tricks: expect.any(Array),
        negotiationScript: expect.any(String),
        insights: expect.any(Array),
        comparison: expect.any(Object),
        generatedAt: expect.any(String),
        generatedBy: expect.any(String),
        processingTimeMs: expect.any(Number),
      })
    );
  });
});

// ─── Return Value Shape ───────────────────────────────────────────────────────

describe('reportService.generateEnhancedReport — return value', () => {
  beforeEach(() => {
    callGPT.mockResolvedValue(mockAIResponse);
    process.env.OPENAI_API_KEY = 'test-key';
  });

  it('returns an object with all required top-level fields', async () => {
    const report = await generateEnhancedReport(
      OFFER_ID, USER_ID, mockOffer, mockPortfolio
    );

    expect(report).toHaveProperty('tricks');
    expect(report).toHaveProperty('negotiationScript');
    expect(report).toHaveProperty('insights');
    expect(report).toHaveProperty('comparison');
    expect(report).toHaveProperty('generatedAt');
    expect(report).toHaveProperty('generatedBy');
    expect(report).toHaveProperty('processingTimeMs');
  });

  it('returns tricks as a non-empty array', async () => {
    const report = await generateEnhancedReport(
      OFFER_ID, USER_ID, mockOffer, mockPortfolio
    );

    expect(Array.isArray(report.tricks)).toBe(true);
    expect(report.tricks.length).toBeGreaterThan(0);
  });

  it('returns negotiationScript as a non-empty string', async () => {
    const report = await generateEnhancedReport(
      OFFER_ID, USER_ID, mockOffer, mockPortfolio
    );

    expect(typeof report.negotiationScript).toBe('string');
    expect(report.negotiationScript.length).toBeGreaterThan(0);
  });

  it('returns insights as a non-empty array', async () => {
    const report = await generateEnhancedReport(
      OFFER_ID, USER_ID, mockOffer, mockPortfolio
    );

    expect(Array.isArray(report.insights)).toBe(true);
    expect(report.insights.length).toBeGreaterThan(0);
  });

  it('returns comparison object with rate delta and savings', async () => {
    const report = await generateEnhancedReport(
      OFFER_ID, USER_ID, mockOffer, mockPortfolio
    );

    expect(report.comparison).toMatchObject({
      rateDelta: expect.any(Number),
      monthlySaving: expect.any(Number),
      totalSaving: expect.any(Number),
      loanAmount: 2000000,
      termYears: 30,
      bankRate: 5.5,
      portfolioRate: 4.8,
    });
  });

  it('returns generatedBy = "ai" when AI succeeds', async () => {
    const report = await generateEnhancedReport(
      OFFER_ID, USER_ID, mockOffer, mockPortfolio
    );
    expect(report.generatedBy).toBe('ai');
  });

  it('returns processingTimeMs as a non-negative number', async () => {
    const report = await generateEnhancedReport(
      OFFER_ID, USER_ID, mockOffer, mockPortfolio
    );
    expect(report.processingTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('returns generatedAt as a valid ISO 8601 timestamp', async () => {
    const report = await generateEnhancedReport(
      OFFER_ID, USER_ID, mockOffer, mockPortfolio
    );
    expect(() => new Date(report.generatedAt)).not.toThrow();
    expect(new Date(report.generatedAt).toISOString()).toBe(report.generatedAt);
  });
});

// ─── Trick Shape Validation ───────────────────────────────────────────────────

describe('reportService.generateEnhancedReport — trick shape', () => {
  beforeEach(() => {
    callGPT.mockResolvedValue(mockAIResponse);
    process.env.OPENAI_API_KEY = 'test-key';
  });

  it('each trick has required fields', async () => {
    const report = await generateEnhancedReport(
      OFFER_ID, USER_ID, mockOffer, mockPortfolio
    );

    report.tricks.forEach((trick) => {
      expect(trick).toHaveProperty('nameHe');
      expect(trick).toHaveProperty('nameEn');
      expect(trick).toHaveProperty('descriptionHe');
      expect(trick).toHaveProperty('descriptionEn');
      expect(trick).toHaveProperty('applicability');
      expect(trick).toHaveProperty('riskLevel');
      expect(trick).toHaveProperty('potentialSavings');
    });
  });

  it('trick applicability is one of high|medium|low', async () => {
    const report = await generateEnhancedReport(
      OFFER_ID, USER_ID, mockOffer, mockPortfolio
    );

    report.tricks.forEach((trick) => {
      expect(['high', 'medium', 'low']).toContain(trick.applicability);
    });
  });

  it('trick riskLevel is one of low|medium|high', async () => {
    const report = await generateEnhancedReport(
      OFFER_ID, USER_ID, mockOffer, mockPortfolio
    );

    report.tricks.forEach((trick) => {
      expect(['low', 'medium', 'high']).toContain(trick.riskLevel);
    });
  });

  it('trick potentialSavings is a non-negative number or null', async () => {
    const report = await generateEnhancedReport(
      OFFER_ID, USER_ID, mockOffer, mockPortfolio
    );

    report.tricks.forEach((trick) => {
      if (trick.potentialSavings !== null) {
        expect(typeof trick.potentialSavings).toBe('number');
        expect(trick.potentialSavings).toBeGreaterThanOrEqual(0);
      }
    });
  });
});

// ─── Insight Shape Validation ─────────────────────────────────────────────────

describe('reportService.generateEnhancedReport — insight shape', () => {
  beforeEach(() => {
    callGPT.mockResolvedValue(mockAIResponse);
    process.env.OPENAI_API_KEY = 'test-key';
  });

  it('each insight has required fields', async () => {
    const report = await generateEnhancedReport(
      OFFER_ID, USER_ID, mockOffer, mockPortfolio
    );

    report.insights.forEach((insight) => {
      expect(insight).toHaveProperty('titleHe');
      expect(insight).toHaveProperty('titleEn');
      expect(insight).toHaveProperty('bodyHe');
      expect(insight).toHaveProperty('bodyEn');
      expect(insight).toHaveProperty('icon');
    });
  });

  it('insight icon is one of the valid icon values', async () => {
    const validIcons = ['trending-down', 'check-circle', 'target', 'calendar', 'shield', 'info'];
    const report = await generateEnhancedReport(
      OFFER_ID, USER_ID, mockOffer, mockPortfolio
    );

    report.insights.forEach((insight) => {
      expect(validIcons).toContain(insight.icon);
    });
  });
});

// ─── AI Fallback Behaviour ────────────────────────────────────────────────────

describe('reportService.generateEnhancedReport — AI fallback', () => {
  it('falls back to rule-based when OPENAI_API_KEY is not set', async () => {
    delete process.env.OPENAI_API_KEY;

    const report = await generateEnhancedReport(
      OFFER_ID, USER_ID, mockOffer, mockPortfolio
    );

    expect(report.generatedBy).toBe('rule-based-fallback');
    expect(callGPT).not.toHaveBeenCalled();
    expect(report.tricks.length).toBeGreaterThan(0);
    expect(report.negotiationScript.length).toBeGreaterThan(0);
  });

  it('falls back to rule-based when AI throws an error', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    callGPT.mockRejectedValue(new Error('OpenAI rate limit exceeded'));

    const report = await generateEnhancedReport(
      OFFER_ID, USER_ID, mockOffer, mockPortfolio
    );

    expect(report.generatedBy).toBe('rule-based-fallback');
    expect(report.tricks.length).toBeGreaterThan(0);
  });

  it('falls back when AI returns empty tricks array', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    callGPT.mockResolvedValue({
      tricks: [],
      negotiationScript: 'some script',
      insights: [],
    });

    const report = await generateEnhancedReport(
      OFFER_ID, USER_ID, mockOffer, mockPortfolio
    );

    // Empty tricks triggers fallback
    expect(report.generatedBy).toBe('rule-based-fallback');
  });

  it('falls back when AI returns missing negotiationScript', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    callGPT.mockResolvedValue({
      tricks: [mockAIResponse.tricks[0]],
      negotiationScript: '',
      insights: mockAIResponse.insights,
    });

    const report = await generateEnhancedReport(
      OFFER_ID, USER_ID, mockOffer, mockPortfolio
    );

    // Empty negotiationScript triggers fallback
    expect(report.generatedBy).toBe('rule-based-fallback');
  });

  it('fallback report includes Enticement Track trick', async () => {
    delete process.env.OPENAI_API_KEY;

    const report = await generateEnhancedReport(
      OFFER_ID, USER_ID, mockOffer, mockPortfolio
    );

    const enticementTrick = report.tricks.find((t) => t.nameEn === 'Enticement Track');
    expect(enticementTrick).toBeDefined();
    expect(enticementTrick.nameHe).toBe('מסלול פיתיון');
  });
});

// ─── Firestore Persistence ────────────────────────────────────────────────────

describe('reportService.generateEnhancedReport — Firestore persistence', () => {
  it('calls updateEnhancedAnalysis with offerId and report', async () => {
    callGPT.mockResolvedValue(mockAIResponse);
    process.env.OPENAI_API_KEY = 'test-key';

    await generateEnhancedReport(OFFER_ID, USER_ID, mockOffer, mockPortfolio);

    expect(updateEnhancedAnalysis).toHaveBeenCalledTimes(1);
    expect(updateEnhancedAnalysis).toHaveBeenCalledWith(
      OFFER_ID,
      expect.objectContaining({ generatedBy: 'ai' })
    );
  });

  it('still returns report even when Firestore write fails', async () => {
    callGPT.mockResolvedValue(mockAIResponse);
    process.env.OPENAI_API_KEY = 'test-key';
    updateEnhancedAnalysis.mockRejectedValue(new Error('Firestore unavailable'));

    const report = await generateEnhancedReport(
      OFFER_ID, USER_ID, mockOffer, mockPortfolio
    );

    // Report is returned despite storage failure
    expect(report).toBeDefined();
    expect(report.tricks).toBeDefined();
    expect(report.negotiationScript).toBeDefined();
  });

  it('persists fallback report to Firestore when AI fails', async () => {
    delete process.env.OPENAI_API_KEY;

    await generateEnhancedReport(OFFER_ID, USER_ID, mockOffer, mockPortfolio);

    expect(updateEnhancedAnalysis).toHaveBeenCalledWith(
      OFFER_ID,
      expect.objectContaining({ generatedBy: 'rule-based-fallback' })
    );
  });
});

// ─── Comparison Calculation ───────────────────────────────────────────────────

describe('reportService.generateEnhancedReport — comparison data', () => {
  it('calculates positive rateDelta when bank rate > portfolio rate', async () => {
    delete process.env.OPENAI_API_KEY;

    const report = await generateEnhancedReport(
      OFFER_ID, USER_ID, mockOffer, mockPortfolio
    );

    // Bank rate 5.5% > portfolio rate 4.8% → positive delta
    expect(report.comparison.rateDelta).toBeGreaterThan(0);
  });

  it('calculates positive monthlySaving when bank rate > portfolio rate', async () => {
    delete process.env.OPENAI_API_KEY;

    const report = await generateEnhancedReport(
      OFFER_ID, USER_ID, mockOffer, mockPortfolio
    );

    expect(report.comparison.monthlySaving).toBeGreaterThan(0);
  });

  it('calculates positive totalSaving when bank rate > portfolio rate', async () => {
    delete process.env.OPENAI_API_KEY;

    const report = await generateEnhancedReport(
      OFFER_ID, USER_ID, mockOffer, mockPortfolio
    );

    expect(report.comparison.totalSaving).toBeGreaterThan(0);
  });

  it('includes trackComparison array in comparison', async () => {
    delete process.env.OPENAI_API_KEY;

    const report = await generateEnhancedReport(
      OFFER_ID, USER_ID, mockOffer, mockPortfolio
    );

    expect(Array.isArray(report.comparison.trackComparison)).toBe(true);
  });

  it('handles null portfolio gracefully in comparison', async () => {
    delete process.env.OPENAI_API_KEY;

    const report = await generateEnhancedReport(
      OFFER_ID, USER_ID, mockOffer, null
    );

    expect(report.comparison.rateDelta).toBeNull();
    expect(report.comparison.monthlySaving).toBeNull();
    expect(report.comparison.totalSaving).toBeNull();
    expect(report.comparison.portfolioRate).toBeNull();
  });
});
