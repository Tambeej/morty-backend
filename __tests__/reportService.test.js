'use strict';

/**
 * Unit tests for reportService.
 */

jest.mock('../src/services/aiService');
jest.mock('../src/services/offerService');

const { callGPT } = require('../src/services/aiService');
const { updateEnhancedAnalysis } = require('../src/services/offerService');
const {
  buildComparison,
  sanitizeTrick,
  sanitizeInsight,
  generateFallbackReport,
  generateEnhancedReport,
} = require('../src/services/reportService');

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const mockOffer = {
  id: 'offer123',
  userId: 'user456',
  bankName: 'Bank Hapoalim',
  status: 'analyzed',
  analysis: {
    terms: {
      loanAmount: 1500000,
      termYears: 25,
      interestRate: 5.2,
      tracks: [
        { type: 'fixed', name: 'קל"צ', rate: 5.2 },
      ],
    },
  },
};

const mockPortfolio = {
  id: 'portfolio789',
  userId: 'user456',
  averageRate: 4.75,
  tracks: [
    { type: 'fixed', name: 'קל"צ', rate: 4.75, amount: 750000 },
    { type: 'prime', name: 'פריים', rate: 4.5, amount: 750000 },
  ],
};

const mockAIResponse = {
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
  negotiationScript: 'שלום, שמי [שם]. אני מעוניין/ת במשכנתא...',
  insights: [
    {
      titleHe: 'ניתוח ריבית',
      titleEn: 'Rate Analysis',
      bodyHe: 'גוף בעברית',
      bodyEn: 'Body in English',
      icon: 'trending-down',
    },
  ],
};

// ─── buildComparison ──────────────────────────────────────────────────────────

describe('buildComparison', () => {
  it('should calculate rateDelta correctly', () => {
    const comparison = buildComparison(mockOffer, mockPortfolio);
    expect(comparison.rateDelta).toBeCloseTo(0.45, 2);
  });

  it('should calculate monthlySaving as a number', () => {
    const comparison = buildComparison(mockOffer, mockPortfolio);
    expect(typeof comparison.monthlySaving).toBe('number');
    expect(comparison.monthlySaving).toBeGreaterThan(0);
  });

  it('should calculate totalSaving as a number', () => {
    const comparison = buildComparison(mockOffer, mockPortfolio);
    expect(typeof comparison.totalSaving).toBe('number');
    expect(comparison.totalSaving).toBeGreaterThan(0);
  });

  it('should return null rateDelta when portfolio is null', () => {
    const comparison = buildComparison(mockOffer, null);
    expect(comparison.rateDelta).toBeNull();
    expect(comparison.monthlySaving).toBeNull();
    expect(comparison.totalSaving).toBeNull();
  });

  it('should include loanAmount and termYears from offer', () => {
    const comparison = buildComparison(mockOffer, mockPortfolio);
    expect(comparison.loanAmount).toBe(1500000);
    expect(comparison.termYears).toBe(25);
  });

  it('should build trackComparison array', () => {
    const comparison = buildComparison(mockOffer, mockPortfolio);
    expect(Array.isArray(comparison.trackComparison)).toBe(true);
    expect(comparison.trackComparison).toHaveLength(1);
    expect(comparison.trackComparison[0]).toHaveProperty('bankRate');
    expect(comparison.trackComparison[0]).toHaveProperty('portfolioRate');
  });
});

// ─── sanitizeTrick ────────────────────────────────────────────────────────────

describe('sanitizeTrick', () => {
  it('should return a valid trick object', () => {
    const trick = sanitizeTrick(mockAIResponse.tricks[0]);
    expect(trick).toMatchObject({
      nameHe: 'מסלול פיתיון',
      nameEn: 'Enticement Track',
      applicability: 'high',
      riskLevel: 'medium',
      potentialSavings: 22000,
    });
  });

  it('should return null for invalid input', () => {
    expect(sanitizeTrick(null)).toBeNull();
    expect(sanitizeTrick('string')).toBeNull();
    expect(sanitizeTrick(42)).toBeNull();
  });

  it('should default applicability to medium for invalid values', () => {
    const trick = sanitizeTrick({ ...mockAIResponse.tricks[0], applicability: 'invalid' });
    expect(trick.applicability).toBe('medium');
  });

  it('should default riskLevel to medium for invalid values', () => {
    const trick = sanitizeTrick({ ...mockAIResponse.tricks[0], riskLevel: 'extreme' });
    expect(trick.riskLevel).toBe('medium');
  });

  it('should truncate long strings', () => {
    const longString = 'a'.repeat(300);
    const trick = sanitizeTrick({ ...mockAIResponse.tricks[0], nameHe: longString });
    expect(trick.nameHe.length).toBeLessThanOrEqual(200);
  });

  it('should set potentialSavings to null for negative values', () => {
    const trick = sanitizeTrick({ ...mockAIResponse.tricks[0], potentialSavings: -100 });
    expect(trick.potentialSavings).toBeNull();
  });
});

// ─── sanitizeInsight ──────────────────────────────────────────────────────────

describe('sanitizeInsight', () => {
  it('should return a valid insight object', () => {
    const insight = sanitizeInsight(mockAIResponse.insights[0]);
    expect(insight).toMatchObject({
      titleHe: 'ניתוח ריבית',
      titleEn: 'Rate Analysis',
      icon: 'trending-down',
    });
  });

  it('should return null for invalid input', () => {
    expect(sanitizeInsight(null)).toBeNull();
    expect(sanitizeInsight(undefined)).toBeNull();
  });

  it('should default icon to info for invalid icon values', () => {
    const insight = sanitizeInsight({ ...mockAIResponse.insights[0], icon: 'invalid-icon' });
    expect(insight.icon).toBe('info');
  });

  it('should accept all valid icon values', () => {
    const validIcons = ['trending-down', 'check-circle', 'target', 'calendar', 'shield', 'info'];
    validIcons.forEach((icon) => {
      const insight = sanitizeInsight({ ...mockAIResponse.insights[0], icon });
      expect(insight.icon).toBe(icon);
    });
  });
});

// ─── generateFallbackReport ───────────────────────────────────────────────────

describe('generateFallbackReport', () => {
  it('should return a complete report object', () => {
    const comparison = buildComparison(mockOffer, mockPortfolio);
    const report = generateFallbackReport(mockOffer, mockPortfolio, comparison);

    expect(report).toHaveProperty('tricks');
    expect(report).toHaveProperty('negotiationScript');
    expect(report).toHaveProperty('insights');
    expect(report).toHaveProperty('comparison');
    expect(report).toHaveProperty('generatedAt');
    expect(report).toHaveProperty('generatedBy', 'rule-based-fallback');
    expect(report).toHaveProperty('processingTimeMs');
  });

  it('should include at least 3 tricks', () => {
    const comparison = buildComparison(mockOffer, mockPortfolio);
    const report = generateFallbackReport(mockOffer, mockPortfolio, comparison);
    expect(report.tricks.length).toBeGreaterThanOrEqual(3);
  });

  it('should include the Enticement Track trick', () => {
    const comparison = buildComparison(mockOffer, mockPortfolio);
    const report = generateFallbackReport(mockOffer, mockPortfolio, comparison);
    const enticementTrick = report.tricks.find((t) => t.nameEn === 'Enticement Track');
    expect(enticementTrick).toBeDefined();
  });

  it('should include a non-empty negotiation script', () => {
    const comparison = buildComparison(mockOffer, mockPortfolio);
    const report = generateFallbackReport(mockOffer, mockPortfolio, comparison);
    expect(report.negotiationScript.length).toBeGreaterThan(50);
  });

  it('should include at least 3 insights', () => {
    const comparison = buildComparison(mockOffer, mockPortfolio);
    const report = generateFallbackReport(mockOffer, mockPortfolio, comparison);
    expect(report.insights.length).toBeGreaterThanOrEqual(3);
  });
});

// ─── generateEnhancedReport ───────────────────────────────────────────────────

describe('generateEnhancedReport', () => {
  beforeEach(() => {
    updateEnhancedAnalysis.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should return AI-generated report when AI succeeds', async () => {
    callGPT.mockResolvedValue(mockAIResponse);
    process.env.OPENAI_API_KEY = 'test-key';

    const report = await generateEnhancedReport(
      'offer123',
      'user456',
      mockOffer,
      mockPortfolio
    );

    expect(report.generatedBy).toBe('ai');
    expect(report.tricks).toHaveLength(1);
    expect(report.negotiationScript).toBe('שלום, שמי [שם]. אני מעוניין/ת במשכנתא...');
    expect(updateEnhancedAnalysis).toHaveBeenCalledWith('offer123', expect.any(Object));
  });

  it('should fall back to rule-based report when AI fails', async () => {
    callGPT.mockRejectedValue(new Error('OpenAI API error'));
    process.env.OPENAI_API_KEY = 'test-key';

    const report = await generateEnhancedReport(
      'offer123',
      'user456',
      mockOffer,
      mockPortfolio
    );

    expect(report.generatedBy).toBe('rule-based-fallback');
    expect(report.tricks.length).toBeGreaterThan(0);
    expect(updateEnhancedAnalysis).toHaveBeenCalled();
  });

  it('should fall back to rule-based report when OPENAI_API_KEY is not set', async () => {
    delete process.env.OPENAI_API_KEY;

    const report = await generateEnhancedReport(
      'offer123',
      'user456',
      mockOffer,
      mockPortfolio
    );

    expect(report.generatedBy).toBe('rule-based-fallback');
    expect(callGPT).not.toHaveBeenCalled();
  });

  it('should still return report even if storing to Firestore fails', async () => {
    callGPT.mockResolvedValue(mockAIResponse);
    process.env.OPENAI_API_KEY = 'test-key';
    updateEnhancedAnalysis.mockRejectedValue(new Error('Firestore write failed'));

    const report = await generateEnhancedReport(
      'offer123',
      'user456',
      mockOffer,
      mockPortfolio
    );

    expect(report).toBeDefined();
    expect(report.tricks).toBeDefined();
  });

  it('should include processingTimeMs in the report', async () => {
    callGPT.mockResolvedValue(mockAIResponse);
    process.env.OPENAI_API_KEY = 'test-key';

    const report = await generateEnhancedReport(
      'offer123',
      'user456',
      mockOffer,
      mockPortfolio
    );

    expect(typeof report.processingTimeMs).toBe('number');
    expect(report.processingTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('should work with null portfolio', async () => {
    callGPT.mockResolvedValue(mockAIResponse);
    process.env.OPENAI_API_KEY = 'test-key';

    const report = await generateEnhancedReport(
      'offer123',
      'user456',
      mockOffer,
      null
    );

    expect(report).toBeDefined();
  });
});
