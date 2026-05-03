/**
 * Report Service Tests
 *
 * Tests for the enhanced OCR analysis report generation service.
 * Covers comparison building, savings estimation, portfolio validation,
 * rule-based report generation, and sanitization helpers.
 */

'use strict';

// Mock dependencies before requiring the module
jest.mock('../src/config/firestore', () => {
  const mockCollection = jest.fn(() => ({
    doc: jest.fn(() => ({
      get: jest.fn().mockResolvedValue({ exists: true, data: () => ({}) }),
      set: jest.fn().mockResolvedValue(undefined),
      update: jest.fn().mockResolvedValue(undefined),
    })),
    add: jest.fn().mockResolvedValue({ id: 'mock-id' }),
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    get: jest.fn().mockResolvedValue({ empty: true, docs: [], size: 0 }),
  }));
  return {
    collection: mockCollection,
    batch: jest.fn(() => ({
      set: jest.fn(),
      commit: jest.fn().mockResolvedValue(undefined),
    })),
  };
});

jest.mock('../src/services/offerService', () => ({
  findByIdAndUserId: jest.fn(),
  updateOffer: jest.fn().mockResolvedValue({}),
}));

jest.mock('../src/services/ratesService', () => ({
  getCurrentAverages: jest.fn().mockResolvedValue({
    fixed: 4.65,
    cpi: 3.15,
    prime: 6.05,
    variable: 4.95,
  }),
}));

jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const reportService = require('../src/services/reportService');
const offerService = require('../src/services/offerService');
const ratesService = require('../src/services/ratesService');

// ── Test Data ─────────────────────────────────────────────────────────────────

const mockPortfolio = {
  id: 'market_standard',
  type: 'market_standard',
  name: 'Market Standard',
  nameHe: 'תיק שוק סטנדרטי',
  termYears: 30,
  tracks: [
    { type: 'fixed', percentage: 34, rate: 4.75, rateDisplay: '4.75%', amount: 408000 },
    { type: 'prime', percentage: 33, rate: 5.9, rateDisplay: 'P-0.15%', amount: 396000 },
    { type: 'cpi', percentage: 33, rate: 3.2, rateDisplay: '3.20% + מדד', amount: 396000 },
  ],
  monthlyRepayment: 5200,
  totalCost: 1872000,
  totalInterest: 672000,
};

const mockAnalyzedOffer = {
  id: 'offer-123',
  userId: 'user-456',
  originalFile: { url: 'https://example.com/file.pdf', mimetype: 'application/pdf' },
  extractedData: {
    bank: 'בנק לאומי',
    amount: 1200000,
    rate: 5.2,
    term: 25,
  },
  analysis: {
    recommendedRate: 4.5,
    savings: 48000,
    aiReasoning: 'Mock analysis reasoning',
  },
  status: 'analyzed',
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
};

const mockCurrentRates = {
  fixed: 4.65,
  cpi: 3.15,
  prime: 6.05,
  variable: 4.95,
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('reportService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── calculateWeightedRate ─────────────────────────────────────────────────

  describe('calculateWeightedRate', () => {
    it('should calculate weighted average rate correctly', () => {
      const tracks = [
        { type: 'fixed', percentage: 40, rate: 4.7 },
        { type: 'prime', percentage: 30, rate: 5.9 },
        { type: 'cpi', percentage: 30, rate: 3.2 },
      ];

      const result = reportService.calculateWeightedRate(tracks);
      // (4.7 * 0.4 + 5.9 * 0.3 + 3.2 * 0.3) = 1.88 + 1.77 + 0.96 = 4.61
      expect(result).toBeCloseTo(4.61, 1);
    });

    it('should return null for empty tracks', () => {
      expect(reportService.calculateWeightedRate([])).toBeNull();
      expect(reportService.calculateWeightedRate(null)).toBeNull();
    });

    it('should handle tracks with null rates', () => {
      const tracks = [
        { type: 'fixed', percentage: 50, rate: 4.0 },
        { type: 'prime', percentage: 50, rate: null },
      ];
      const result = reportService.calculateWeightedRate(tracks);
      expect(result).toBe(4.0);
    });
  });

  // ── calculatePMT ──────────────────────────────────────────────────────────

  describe('calculatePMT', () => {
    it('should calculate monthly payment correctly', () => {
      // ₪1,000,000 at 5% for 30 years
      const monthly = reportService.calculatePMT(1000000, 0.05 / 12, 360);
      expect(monthly).toBeCloseTo(5368.22, 0);
    });

    it('should handle zero interest rate', () => {
      const monthly = reportService.calculatePMT(1200000, 0, 360);
      expect(monthly).toBeCloseTo(3333.33, 0);
    });

    it('should return 0 for zero principal', () => {
      expect(reportService.calculatePMT(0, 0.05 / 12, 360)).toBe(0);
    });

    it('should return 0 for zero months', () => {
      expect(reportService.calculatePMT(1000000, 0.05 / 12, 0)).toBe(0);
    });
  });

  // ── estimateSavings ───────────────────────────────────────────────────────

  describe('estimateSavings', () => {
    it('should estimate savings when bank rate is higher', () => {
      const result = reportService.estimateSavings(1200000, 5.2, 4.5, 25);
      expect(result.monthly).toBeGreaterThan(0);
      expect(result.total).toBeGreaterThan(0);
      expect(result.interest).toBeGreaterThan(0);
    });

    it('should return zero savings when bank rate is lower', () => {
      const result = reportService.estimateSavings(1200000, 4.0, 4.5, 25);
      expect(result.monthly).toBe(0);
      expect(result.total).toBe(0);
    });

    it('should return nulls when data is missing', () => {
      const result = reportService.estimateSavings(1200000, null, 4.5, 25);
      expect(result.monthly).toBeNull();
      expect(result.total).toBeNull();
      expect(result.interest).toBeNull();
    });

    it('should return nulls when loan amount is zero', () => {
      const result = reportService.estimateSavings(0, 5.0, 4.5, 25);
      expect(result.monthly).toBeNull();
    });
  });

  // ── buildComparison ───────────────────────────────────────────────────────

  describe('buildComparison', () => {
    it('should build a complete comparison object', () => {
      const comparison = reportService.buildComparison(
        mockAnalyzedOffer,
        mockPortfolio,
        mockCurrentRates
      );

      expect(comparison).toHaveProperty('bankOffer');
      expect(comparison).toHaveProperty('optimizedModel');
      expect(comparison).toHaveProperty('rateDifference');
      expect(comparison).toHaveProperty('potentialMonthlySavings');
      expect(comparison).toHaveProperty('potentialTotalSavings');
      expect(comparison).toHaveProperty('trackComparisons');
      expect(comparison).toHaveProperty('boiAverages');
      expect(comparison).toHaveProperty('verdict');

      expect(comparison.bankOffer.bank).toBe('בנק לאומי');
      expect(comparison.bankOffer.rate).toBe(5.2);
      expect(comparison.optimizedModel.name).toBe('Market Standard');
      expect(comparison.trackComparisons).toHaveLength(3);
    });

    it('should calculate positive rate difference when bank is more expensive', () => {
      const comparison = reportService.buildComparison(
        mockAnalyzedOffer,
        mockPortfolio,
        mockCurrentRates
      );

      // Bank rate (5.2) should be higher than portfolio weighted rate
      expect(comparison.rateDifference).toBeGreaterThan(0);
    });

    it('should set verdict based on rate difference', () => {
      const comparison = reportService.buildComparison(
        mockAnalyzedOffer,
        mockPortfolio,
        mockCurrentRates
      );

      expect(['significantly_worse', 'slightly_worse', 'comparable', 'better_than_model'])
        .toContain(comparison.verdict);
    });

    it('should handle missing OCR data gracefully', () => {
      const offerWithMissingData = {
        ...mockAnalyzedOffer,
        extractedData: { bank: '', amount: null, rate: null, term: null },
      };

      const comparison = reportService.buildComparison(
        offerWithMissingData,
        mockPortfolio,
        mockCurrentRates
      );

      expect(comparison.rateDifference).toBeNull();
      expect(comparison.verdict).toBe('insufficient_data');
    });
  });

  // ── buildTrackComparisons ─────────────────────────────────────────────────

  describe('buildTrackComparisons', () => {
    it('should build comparisons for each portfolio track', () => {
      const comparisons = reportService.buildTrackComparisons(
        mockAnalyzedOffer,
        mockPortfolio,
        mockCurrentRates
      );

      expect(comparisons).toHaveLength(3);
      expect(comparisons[0].trackType).toBe('fixed');
      expect(comparisons[1].trackType).toBe('prime');
      expect(comparisons[2].trackType).toBe('cpi');
    });

    it('should include BOI comparison for each track', () => {
      const comparisons = reportService.buildTrackComparisons(
        mockAnalyzedOffer,
        mockPortfolio,
        mockCurrentRates
      );

      for (const comp of comparisons) {
        expect(comp).toHaveProperty('boiAverage');
        expect(comp).toHaveProperty('vsBoi');
        expect(comp).toHaveProperty('vsBoiLabel');
      }
    });

    it('should include bank offer comparison when rate is available', () => {
      const comparisons = reportService.buildTrackComparisons(
        mockAnalyzedOffer,
        mockPortfolio,
        mockCurrentRates
      );

      for (const comp of comparisons) {
        expect(comp).toHaveProperty('bankOfferRate', 5.2);
        expect(comp).toHaveProperty('vsBank');
        expect(comp).toHaveProperty('vsBankLabel');
      }
    });
  });

  // ── validatePortfolio ─────────────────────────────────────────────────────

  describe('validatePortfolio', () => {
    it('should accept a valid portfolio', () => {
      expect(() => reportService.validatePortfolio(mockPortfolio)).not.toThrow();
    });

    it('should reject null portfolio', () => {
      expect(() => reportService.validatePortfolio(null)).toThrow('Portfolio data is required');
    });

    it('should reject portfolio without id', () => {
      const invalid = { ...mockPortfolio, id: '' };
      expect(() => reportService.validatePortfolio(invalid)).toThrow('valid id');
    });

    it('should reject portfolio without tracks', () => {
      const invalid = { ...mockPortfolio, tracks: [] };
      expect(() => reportService.validatePortfolio(invalid)).toThrow('at least one track');
    });

    it('should reject portfolio with invalid termYears', () => {
      const invalid = { ...mockPortfolio, termYears: 0 };
      expect(() => reportService.validatePortfolio(invalid)).toThrow('valid termYears');
    });

    it('should reject portfolio with invalid monthlyRepayment', () => {
      const invalid = { ...mockPortfolio, monthlyRepayment: -100 };
      expect(() => reportService.validatePortfolio(invalid)).toThrow('valid monthlyRepayment');
    });

    it('should reject portfolio with invalid totalCost', () => {
      const invalid = { ...mockPortfolio, totalCost: 0 };
      expect(() => reportService.validatePortfolio(invalid)).toThrow('valid totalCost');
    });

    it('should reject portfolio with invalid track percentage', () => {
      const invalid = {
        ...mockPortfolio,
        tracks: [{ type: 'fixed', percentage: 0, rate: 4.5 }],
      };
      expect(() => reportService.validatePortfolio(invalid)).toThrow('valid percentage');
    });

    it('should reject portfolio with track percentages not summing to 100', () => {
      const invalid = {
        ...mockPortfolio,
        tracks: [
          { type: 'fixed', percentage: 30, rate: 4.5 },
          { type: 'prime', percentage: 30, rate: 5.9 },
        ],
      };
      expect(() => reportService.validatePortfolio(invalid)).toThrow('sum to 100%');
    });
  });

  // ── sanitizeTrick ─────────────────────────────────────────────────────────

  describe('sanitizeTrick', () => {
    it('should sanitize a well-formed trick', () => {
      const trick = {
        nameHe: 'מסלול פיתיון',
        nameEn: 'Enticement Track',
        descriptionHe: 'תיאור בעברית',
        descriptionEn: 'English description',
        potentialSavings: 15000,
        riskLevel: 'medium',
        applicability: 'high',
      };

      const result = reportService.sanitizeTrick(trick);
      expect(result).toEqual(trick);
    });

    it('should handle missing fields with defaults', () => {
      const result = reportService.sanitizeTrick({});
      expect(result.nameHe).toBe('');
      expect(result.nameEn).toBe('');
      expect(result.potentialSavings).toBeNull();
      expect(result.riskLevel).toBe('medium');
      expect(result.applicability).toBe('medium');
    });

    it('should reject invalid riskLevel values', () => {
      const result = reportService.sanitizeTrick({ riskLevel: 'extreme' });
      expect(result.riskLevel).toBe('medium');
    });
  });

  // ── sanitizeInsight ───────────────────────────────────────────────────────

  describe('sanitizeInsight', () => {
    it('should sanitize a well-formed insight', () => {
      const insight = {
        titleHe: 'כותרת',
        titleEn: 'Title',
        bodyHe: 'גוף',
        bodyEn: 'Body',
        icon: 'shield',
      };

      const result = reportService.sanitizeInsight(insight);
      expect(result).toEqual(insight);
    });

    it('should handle missing fields with defaults', () => {
      const result = reportService.sanitizeInsight({});
      expect(result.titleHe).toBe('');
      expect(result.icon).toBe('info');
    });
  });

  // ── generateRuleBasedReport ───────────────────────────────────────────────

  describe('generateRuleBasedReport', () => {
    it('should generate a complete rule-based report', () => {
      const comparison = reportService.buildComparison(
        mockAnalyzedOffer,
        mockPortfolio,
        mockCurrentRates
      );

      const report = reportService.generateRuleBasedReport(
        mockAnalyzedOffer,
        mockPortfolio,
        comparison,
        mockCurrentRates
      );

      expect(report).toHaveProperty('tricks');
      expect(report).toHaveProperty('negotiationScript');
      expect(report).toHaveProperty('insights');
      expect(report).toHaveProperty('summary');
      expect(report).toHaveProperty('summaryHe');
    });

    it('should always include the Enticement Track trick', () => {
      const comparison = reportService.buildComparison(
        mockAnalyzedOffer,
        mockPortfolio,
        mockCurrentRates
      );

      const report = reportService.generateRuleBasedReport(
        mockAnalyzedOffer,
        mockPortfolio,
        comparison,
        mockCurrentRates
      );

      const enticementTrick = report.tricks.find((t) => t.nameEn === 'Enticement Track');
      expect(enticementTrick).toBeDefined();
      expect(enticementTrick.nameHe).toBe('מסלול פיתיון');
    });

    it('should generate a Hebrew negotiation script', () => {
      const comparison = reportService.buildComparison(
        mockAnalyzedOffer,
        mockPortfolio,
        mockCurrentRates
      );

      const report = reportService.generateRuleBasedReport(
        mockAnalyzedOffer,
        mockPortfolio,
        comparison,
        mockCurrentRates
      );

      expect(report.negotiationScript).toContain('שלום');
      expect(report.negotiationScript).toContain('בנק לאומי');
      expect(report.negotiationScript).toContain('בנק ישראל');
    });

    it('should include BOI rate matching trick when bank rate is higher', () => {
      const comparison = reportService.buildComparison(
        mockAnalyzedOffer,
        mockPortfolio,
        mockCurrentRates
      );

      const report = reportService.generateRuleBasedReport(
        mockAnalyzedOffer,
        mockPortfolio,
        comparison,
        mockCurrentRates
      );

      const boiTrick = report.tricks.find((t) => t.nameEn === 'BOI Rate Matching');
      expect(boiTrick).toBeDefined();
    });

    it('should generate insights with Hebrew and English content', () => {
      const comparison = reportService.buildComparison(
        mockAnalyzedOffer,
        mockPortfolio,
        mockCurrentRates
      );

      const report = reportService.generateRuleBasedReport(
        mockAnalyzedOffer,
        mockPortfolio,
        comparison,
        mockCurrentRates
      );

      expect(report.insights.length).toBeGreaterThanOrEqual(2);
      for (const insight of report.insights) {
        expect(insight).toHaveProperty('titleHe');
        expect(insight).toHaveProperty('titleEn');
        expect(insight).toHaveProperty('bodyHe');
        expect(insight).toHaveProperty('bodyEn');
        expect(insight).toHaveProperty('icon');
      }
    });

    it('should limit tricks to 4', () => {
      const comparison = reportService.buildComparison(
        mockAnalyzedOffer,
        mockPortfolio,
        mockCurrentRates
      );

      const report = reportService.generateRuleBasedReport(
        mockAnalyzedOffer,
        mockPortfolio,
        comparison,
        mockCurrentRates
      );

      expect(report.tricks.length).toBeLessThanOrEqual(4);
    });
  });

  // ── generateEnhancedReport (integration) ──────────────────────────────────

  describe('generateEnhancedReport', () => {
    it('should throw 404 when offer is not found', async () => {
      offerService.findByIdAndUserId.mockResolvedValue(null);

      await expect(
        reportService.generateEnhancedReport('offer-123', 'user-456', mockPortfolio)
      ).rejects.toThrow('Offer not found or access denied');
    });

    it('should throw 400 when offer is not analyzed', async () => {
      offerService.findByIdAndUserId.mockResolvedValue({
        ...mockAnalyzedOffer,
        status: 'pending',
      });

      await expect(
        reportService.generateEnhancedReport('offer-123', 'user-456', mockPortfolio)
      ).rejects.toThrow('must be analyzed via OCR');
    });

    it('should throw 400 for invalid portfolio', async () => {
      offerService.findByIdAndUserId.mockResolvedValue(mockAnalyzedOffer);

      await expect(
        reportService.generateEnhancedReport('offer-123', 'user-456', null)
      ).rejects.toThrow('Portfolio data is required');
    });

    it('should generate a complete report with rule-based fallback', async () => {
      offerService.findByIdAndUserId.mockResolvedValue(mockAnalyzedOffer);
      ratesService.getCurrentAverages.mockResolvedValue(mockCurrentRates);

      // OpenAI is not configured in tests, so it will fall back to rule-based
      const report = await reportService.generateEnhancedReport(
        'offer-123',
        'user-456',
        mockPortfolio
      );

      expect(report).toHaveProperty('offerId', 'offer-123');
      expect(report).toHaveProperty('portfolioId', 'market_standard');
      expect(report).toHaveProperty('comparison');
      expect(report).toHaveProperty('tricks');
      expect(report).toHaveProperty('negotiationScript');
      expect(report).toHaveProperty('insights');
      expect(report).toHaveProperty('summary');
      expect(report).toHaveProperty('summaryHe');
      expect(report).toHaveProperty('generatedAt');
      expect(report).toHaveProperty('processingTimeMs');

      // Verify the report was stored
      expect(offerService.updateOffer).toHaveBeenCalledWith(
        'offer-123',
        expect.objectContaining({
          'analysis.enhanced': expect.any(Object),
          portfolioId: 'market_standard',
        })
      );
    });

    it('should still return report even if storage fails', async () => {
      offerService.findByIdAndUserId.mockResolvedValue(mockAnalyzedOffer);
      offerService.updateOffer.mockRejectedValue(new Error('Firestore write failed'));
      ratesService.getCurrentAverages.mockResolvedValue(mockCurrentRates);

      const report = await reportService.generateEnhancedReport(
        'offer-123',
        'user-456',
        mockPortfolio
      );

      // Report should still be returned despite storage failure
      expect(report).toHaveProperty('offerId', 'offer-123');
      expect(report).toHaveProperty('tricks');
    });
  });
});
