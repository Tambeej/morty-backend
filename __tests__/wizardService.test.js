/**
 * Tests for wizardService – Portfolio generation engine.
 *
 * Tests cover:
 *   - Scenario determination logic
 *   - PMT (amortization) calculation accuracy
 *   - Rule-based portfolio generation
 *   - Portfolio structure validation
 *   - Track percentage validation (must sum to 100%)
 *   - Conditional scenario inclusion (Inflation-Proof, Stability-First)
 *   - AI generation fallback
 *   - Edge cases
 */

'use strict';

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('../src/config/firestore', () => {
  const firestoreMock = {
    collection: jest.fn(() => ({
      doc: jest.fn(() => ({
        get: jest.fn().mockResolvedValue({ exists: false }),
        set: jest.fn().mockResolvedValue(undefined),
      })),
    })),
    batch: jest.fn(() => ({
      set: jest.fn(),
      commit: jest.fn().mockResolvedValue(undefined),
    })),
  };
  firestoreMock.getFirestore = () => firestoreMock;
  return firestoreMock;
});

jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
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

// Mock OpenAI (not available in tests)
jest.mock('openai', () => {
  return jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: jest.fn().mockRejectedValue(new Error('Mock: OpenAI not available')),
      },
    },
  }));
});

const wizardService = require('../src/services/wizardService');
const ratesService = require('../src/services/ratesService');

// ── Test Data ─────────────────────────────────────────────────────────────────

const SAMPLE_RATES = {
  fixed: 4.65,
  cpi: 3.15,
  prime: 6.05,
  variable: 4.95,
};

const BASE_INPUTS = {
  propertyPrice: 2000000,
  loanAmount: 1500000,
  monthlyIncome: 25000,
  additionalIncome: 5000,
  targetRepayment: 7000,
  futureFunds: { timeframe: 'none', amount: 0 },
  stabilityPreference: 5,
};

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  ratesService.getCurrentAverages.mockResolvedValue(SAMPLE_RATES);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('wizardService', () => {
  describe('calculatePMT', () => {
    it('should calculate correct monthly payment for a standard loan', () => {
      // ₪1,000,000 at 5% annual for 30 years
      const principal = 1000000;
      const monthlyRate = 0.05 / 12;
      const totalMonths = 30 * 12;

      const payment = wizardService.calculatePMT(principal, monthlyRate, totalMonths);

      // Expected: ~₪5,368.22 (standard PMT result)
      expect(payment).toBeCloseTo(5368.22, 0);
    });

    it('should return 0 for zero principal', () => {
      expect(wizardService.calculatePMT(0, 0.004, 360)).toBe(0);
    });

    it('should handle zero interest rate', () => {
      // 0% interest = simple division
      const payment = wizardService.calculatePMT(360000, 0, 360);
      expect(payment).toBe(1000);
    });

    it('should return 0 for zero months', () => {
      expect(wizardService.calculatePMT(100000, 0.004, 0)).toBe(0);
    });

    it('should calculate higher payment for shorter term', () => {
      const principal = 1000000;
      const monthlyRate = 0.05 / 12;

      const payment30 = wizardService.calculatePMT(principal, monthlyRate, 360);
      const payment20 = wizardService.calculatePMT(principal, monthlyRate, 240);

      expect(payment20).toBeGreaterThan(payment30);
    });

    it('should calculate lower total cost for shorter term', () => {
      const principal = 1000000;
      const monthlyRate = 0.05 / 12;

      const payment30 = wizardService.calculatePMT(principal, monthlyRate, 360);
      const payment20 = wizardService.calculatePMT(principal, monthlyRate, 240);

      const totalCost30 = payment30 * 360;
      const totalCost20 = payment20 * 240;

      expect(totalCost20).toBeLessThan(totalCost30);
    });
  });

  describe('determineScenarios', () => {
    it('should always include Market Standard and Fast Track', () => {
      const scenarios = wizardService.determineScenarios(BASE_INPUTS, SAMPLE_RATES);

      expect(scenarios).toContain(wizardService.SCENARIO_TYPES.MARKET_STANDARD);
      expect(scenarios).toContain(wizardService.SCENARIO_TYPES.FAST_TRACK);
    });

    it('should include Inflation-Proof when CPI rate is high', () => {
      const highCpiRates = { ...SAMPLE_RATES, cpi: 3.5 };
      const inputs = { ...BASE_INPUTS, stabilityPreference: 2 };

      const scenarios = wizardService.determineScenarios(inputs, highCpiRates);

      expect(scenarios).toContain(wizardService.SCENARIO_TYPES.INFLATION_PROOF);
    });

    it('should include Inflation-Proof when stability preference is moderate (4-8)', () => {
      const inputs = { ...BASE_INPUTS, stabilityPreference: 5 };

      const scenarios = wizardService.determineScenarios(inputs, SAMPLE_RATES);

      expect(scenarios).toContain(wizardService.SCENARIO_TYPES.INFLATION_PROOF);
    });

    it('should NOT include Inflation-Proof when CPI is low and stability is low', () => {
      const lowCpiRates = { ...SAMPLE_RATES, cpi: 2.0 };
      const inputs = { ...BASE_INPUTS, stabilityPreference: 2 };

      const scenarios = wizardService.determineScenarios(inputs, lowCpiRates);

      expect(scenarios).not.toContain(wizardService.SCENARIO_TYPES.INFLATION_PROOF);
    });

    it('should include Stability-First when stabilityPreference >= 7', () => {
      const inputs = { ...BASE_INPUTS, stabilityPreference: 7 };

      const scenarios = wizardService.determineScenarios(inputs, SAMPLE_RATES);

      expect(scenarios).toContain(wizardService.SCENARIO_TYPES.STABILITY_FIRST);
    });

    it('should NOT include Stability-First when stabilityPreference < 7', () => {
      const inputs = { ...BASE_INPUTS, stabilityPreference: 6 };

      const scenarios = wizardService.determineScenarios(inputs, SAMPLE_RATES);

      expect(scenarios).not.toContain(wizardService.SCENARIO_TYPES.STABILITY_FIRST);
    });

    it('should generate all 4 scenarios for high stability + high CPI', () => {
      const highCpiRates = { ...SAMPLE_RATES, cpi: 3.5 };
      const inputs = { ...BASE_INPUTS, stabilityPreference: 8 };

      const scenarios = wizardService.determineScenarios(inputs, highCpiRates);

      expect(scenarios).toHaveLength(4);
      expect(scenarios).toContain(wizardService.SCENARIO_TYPES.MARKET_STANDARD);
      expect(scenarios).toContain(wizardService.SCENARIO_TYPES.FAST_TRACK);
      expect(scenarios).toContain(wizardService.SCENARIO_TYPES.INFLATION_PROOF);
      expect(scenarios).toContain(wizardService.SCENARIO_TYPES.STABILITY_FIRST);
    });

    it('should generate only 2 scenarios for low stability + low CPI', () => {
      const lowCpiRates = { ...SAMPLE_RATES, cpi: 2.0 };
      const inputs = { ...BASE_INPUTS, stabilityPreference: 2 };

      const scenarios = wizardService.determineScenarios(inputs, lowCpiRates);

      expect(scenarios).toHaveLength(2);
    });
  });

  describe('getRuleBasedConfig', () => {
    it('should return 30-year term for Market Standard', () => {
      const config = wizardService.getRuleBasedConfig(
        wizardService.SCENARIO_TYPES.MARKET_STANDARD,
        BASE_INPUTS,
        SAMPLE_RATES
      );

      expect(config.termYears).toBe(30);
      expect(config.tracks).toHaveLength(3);
    });

    it('should return 20-year term for Fast Track', () => {
      const config = wizardService.getRuleBasedConfig(
        wizardService.SCENARIO_TYPES.FAST_TRACK,
        BASE_INPUTS,
        SAMPLE_RATES
      );

      expect(config.termYears).toBe(20);
    });

    it('should have no CPI tracks in Inflation-Proof', () => {
      const config = wizardService.getRuleBasedConfig(
        wizardService.SCENARIO_TYPES.INFLATION_PROOF,
        BASE_INPUTS,
        SAMPLE_RATES
      );

      const hasCpi = config.tracks.some((t) => t.type === 'cpi');
      expect(hasCpi).toBe(false);
    });

    it('should have >= 60% fixed in Stability-First', () => {
      const config = wizardService.getRuleBasedConfig(
        wizardService.SCENARIO_TYPES.STABILITY_FIRST,
        BASE_INPUTS,
        SAMPLE_RATES
      );

      const fixedPct = config.tracks
        .filter((t) => t.type === 'fixed')
        .reduce((sum, t) => sum + t.percentage, 0);

      expect(fixedPct).toBeGreaterThanOrEqual(60);
    });

    it('should have track percentages summing to 100% for all scenarios', () => {
      const types = Object.values(wizardService.SCENARIO_TYPES);

      for (const type of types) {
        const config = wizardService.getRuleBasedConfig(type, BASE_INPUTS, SAMPLE_RATES);
        const totalPct = config.tracks.reduce((sum, t) => sum + t.percentage, 0);
        expect(totalPct).toBe(100);
      }
    });
  });

  describe('buildPortfolio', () => {
    it('should build a complete portfolio with all required fields', () => {
      const config = wizardService.getRuleBasedConfig(
        wizardService.SCENARIO_TYPES.MARKET_STANDARD,
        BASE_INPUTS,
        SAMPLE_RATES
      );

      const portfolio = wizardService.buildPortfolio(
        config,
        wizardService.SCENARIO_TYPES.MARKET_STANDARD,
        BASE_INPUTS,
        SAMPLE_RATES
      );

      expect(portfolio).toHaveProperty('id', 'market_standard');
      expect(portfolio).toHaveProperty('type', 'market_standard');
      expect(portfolio).toHaveProperty('name', 'Market Standard');
      expect(portfolio).toHaveProperty('nameHe', 'תיק שוק סטנדרטי');
      expect(portfolio).toHaveProperty('description');
      expect(portfolio).toHaveProperty('termYears', 30);
      expect(portfolio).toHaveProperty('tracks');
      expect(portfolio).toHaveProperty('monthlyRepayment');
      expect(portfolio).toHaveProperty('totalCost');
      expect(portfolio).toHaveProperty('totalInterest');
      expect(portfolio).toHaveProperty('interestSavings');
      expect(portfolio).toHaveProperty('recommended');
    });

    it('should calculate positive monthly repayment', () => {
      const config = wizardService.getRuleBasedConfig(
        wizardService.SCENARIO_TYPES.MARKET_STANDARD,
        BASE_INPUTS,
        SAMPLE_RATES
      );

      const portfolio = wizardService.buildPortfolio(
        config,
        wizardService.SCENARIO_TYPES.MARKET_STANDARD,
        BASE_INPUTS,
        SAMPLE_RATES
      );

      expect(portfolio.monthlyRepayment).toBeGreaterThan(0);
    });

    it('should have totalCost > loanAmount (interest adds up)', () => {
      const config = wizardService.getRuleBasedConfig(
        wizardService.SCENARIO_TYPES.MARKET_STANDARD,
        BASE_INPUTS,
        SAMPLE_RATES
      );

      const portfolio = wizardService.buildPortfolio(
        config,
        wizardService.SCENARIO_TYPES.MARKET_STANDARD,
        BASE_INPUTS,
        SAMPLE_RATES
      );

      expect(portfolio.totalCost).toBeGreaterThan(BASE_INPUTS.loanAmount);
    });

    it('should have totalInterest = totalCost - loanAmount', () => {
      const config = wizardService.getRuleBasedConfig(
        wizardService.SCENARIO_TYPES.MARKET_STANDARD,
        BASE_INPUTS,
        SAMPLE_RATES
      );

      const portfolio = wizardService.buildPortfolio(
        config,
        wizardService.SCENARIO_TYPES.MARKET_STANDARD,
        BASE_INPUTS,
        SAMPLE_RATES
      );

      expect(portfolio.totalInterest).toBe(portfolio.totalCost - BASE_INPUTS.loanAmount);
    });

    it('should mark Market Standard as recommended', () => {
      const config = wizardService.getRuleBasedConfig(
        wizardService.SCENARIO_TYPES.MARKET_STANDARD,
        BASE_INPUTS,
        SAMPLE_RATES
      );

      const portfolio = wizardService.buildPortfolio(
        config,
        wizardService.SCENARIO_TYPES.MARKET_STANDARD,
        BASE_INPUTS,
        SAMPLE_RATES
      );

      expect(portfolio.recommended).toBe(true);
    });

    it('should NOT mark Fast Track as recommended', () => {
      const config = wizardService.getRuleBasedConfig(
        wizardService.SCENARIO_TYPES.FAST_TRACK,
        BASE_INPUTS,
        SAMPLE_RATES
      );

      const portfolio = wizardService.buildPortfolio(
        config,
        wizardService.SCENARIO_TYPES.FAST_TRACK,
        BASE_INPUTS,
        SAMPLE_RATES
      );

      expect(portfolio.recommended).toBe(false);
    });

    it('should calculate interest savings for non-Market-Standard scenarios', () => {
      const config = wizardService.getRuleBasedConfig(
        wizardService.SCENARIO_TYPES.FAST_TRACK,
        BASE_INPUTS,
        SAMPLE_RATES
      );

      const portfolio = wizardService.buildPortfolio(
        config,
        wizardService.SCENARIO_TYPES.FAST_TRACK,
        BASE_INPUTS,
        SAMPLE_RATES
      );

      // Fast Track (20yr) should save interest vs 30yr baseline
      expect(portfolio.interestSavings).toBeGreaterThan(0);
    });

    it('should have enriched track objects with all fields', () => {
      const config = wizardService.getRuleBasedConfig(
        wizardService.SCENARIO_TYPES.MARKET_STANDARD,
        BASE_INPUTS,
        SAMPLE_RATES
      );

      const portfolio = wizardService.buildPortfolio(
        config,
        wizardService.SCENARIO_TYPES.MARKET_STANDARD,
        BASE_INPUTS,
        SAMPLE_RATES
      );

      for (const track of portfolio.tracks) {
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
      }
    });

    it('should have track amounts summing to loan amount', () => {
      const config = wizardService.getRuleBasedConfig(
        wizardService.SCENARIO_TYPES.MARKET_STANDARD,
        BASE_INPUTS,
        SAMPLE_RATES
      );

      const portfolio = wizardService.buildPortfolio(
        config,
        wizardService.SCENARIO_TYPES.MARKET_STANDARD,
        BASE_INPUTS,
        SAMPLE_RATES
      );

      const totalAmount = portfolio.tracks.reduce((sum, t) => sum + t.amount, 0);
      // Allow ±1 rounding error
      expect(Math.abs(totalAmount - BASE_INPUTS.loanAmount)).toBeLessThanOrEqual(1);
    });
  });

  describe('generateRuleBased', () => {
    it('should generate correct number of portfolios', () => {
      const scenarios = [
        wizardService.SCENARIO_TYPES.MARKET_STANDARD,
        wizardService.SCENARIO_TYPES.FAST_TRACK,
      ];

      const portfolios = wizardService.generateRuleBased(BASE_INPUTS, SAMPLE_RATES, scenarios);

      expect(portfolios).toHaveLength(2);
    });

    it('should generate all 4 portfolios when all scenarios requested', () => {
      const scenarios = Object.values(wizardService.SCENARIO_TYPES);

      const portfolios = wizardService.generateRuleBased(BASE_INPUTS, SAMPLE_RATES, scenarios);

      expect(portfolios).toHaveLength(4);
    });

    it('should set _generationMethod to rule_based', () => {
      const scenarios = [wizardService.SCENARIO_TYPES.MARKET_STANDARD];

      const portfolios = wizardService.generateRuleBased(BASE_INPUTS, SAMPLE_RATES, scenarios);

      expect(portfolios[0]._generationMethod).toBe('rule_based');
    });

    it('should produce Fast Track with higher monthly payment but lower total cost than Market Standard', () => {
      const scenarios = [
        wizardService.SCENARIO_TYPES.MARKET_STANDARD,
        wizardService.SCENARIO_TYPES.FAST_TRACK,
      ];

      const portfolios = wizardService.generateRuleBased(BASE_INPUTS, SAMPLE_RATES, scenarios);
      const market = portfolios.find((p) => p.type === 'market_standard');
      const fast = portfolios.find((p) => p.type === 'fast_track');

      expect(fast.monthlyRepayment).toBeGreaterThan(market.monthlyRepayment);
      expect(fast.totalCost).toBeLessThan(market.totalCost);
    });
  });

  describe('generatePortfolios (integration)', () => {
    it('should generate portfolios with metadata', async () => {
      const result = await wizardService.generatePortfolios(BASE_INPUTS, true);

      expect(result).toHaveProperty('portfolios');
      expect(result).toHaveProperty('metadata');
      expect(result.portfolios.length).toBeGreaterThanOrEqual(2);
      expect(result.portfolios.length).toBeLessThanOrEqual(4);
    });

    it('should include metadata with correct fields', async () => {
      const result = await wizardService.generatePortfolios(BASE_INPUTS, true);

      expect(result.metadata).toHaveProperty('generatedAt');
      expect(result.metadata).toHaveProperty('ratesSource');
      expect(result.metadata).toHaveProperty('generationMethod');
      expect(result.metadata).toHaveProperty('processingTimeMs');
      expect(result.metadata).toHaveProperty('inputSummary');
      expect(result.metadata).toHaveProperty('consent', true);
    });

    it('should strip _generationMethod from returned portfolios', async () => {
      const result = await wizardService.generatePortfolios(BASE_INPUTS, false);

      for (const portfolio of result.portfolios) {
        expect(portfolio).not.toHaveProperty('_generationMethod');
      }
    });

    it('should include inputSummary with LTV calculation', async () => {
      const result = await wizardService.generatePortfolios(BASE_INPUTS, true);

      expect(result.metadata.inputSummary.ltv).toBe(75); // 1500000/2000000 * 100
    });

    it('should fall back to rule-based when rates service fails', async () => {
      ratesService.getCurrentAverages.mockRejectedValueOnce(new Error('Firestore down'));

      const result = await wizardService.generatePortfolios(BASE_INPUTS, true);

      expect(result.portfolios.length).toBeGreaterThanOrEqual(2);
    });

    it('should generate 4 portfolios for high stability preference', async () => {
      const inputs = { ...BASE_INPUTS, stabilityPreference: 8 };

      const result = await wizardService.generatePortfolios(inputs, true);

      expect(result.portfolios).toHaveLength(4);
    });

    it('should generate 2 portfolios for low stability + low CPI', async () => {
      ratesService.getCurrentAverages.mockResolvedValueOnce({
        ...SAMPLE_RATES,
        cpi: 2.0,
      });
      const inputs = { ...BASE_INPUTS, stabilityPreference: 2 };

      const result = await wizardService.generatePortfolios(inputs, false);

      expect(result.portfolios).toHaveLength(2);
    });
  });

  describe('constants', () => {
    it('should export all 4 scenario types', () => {
      expect(wizardService.SCENARIO_TYPES).toHaveProperty('MARKET_STANDARD');
      expect(wizardService.SCENARIO_TYPES).toHaveProperty('FAST_TRACK');
      expect(wizardService.SCENARIO_TYPES).toHaveProperty('INFLATION_PROOF');
      expect(wizardService.SCENARIO_TYPES).toHaveProperty('STABILITY_FIRST');
    });

    it('should have Hebrew names for all scenarios', () => {
      for (const type of Object.values(wizardService.SCENARIO_TYPES)) {
        expect(wizardService.SCENARIO_NAMES_HE[type]).toBeTruthy();
      }
    });

    it('should have English names for all scenarios', () => {
      for (const type of Object.values(wizardService.SCENARIO_TYPES)) {
        expect(wizardService.SCENARIO_NAMES_EN[type]).toBeTruthy();
      }
    });

    it('should have descriptions for all scenarios', () => {
      for (const type of Object.values(wizardService.SCENARIO_TYPES)) {
        expect(wizardService.SCENARIO_DESCRIPTIONS[type]).toBeTruthy();
      }
    });

    it('should have STABILITY_THRESHOLD set to 7', () => {
      expect(wizardService.STABILITY_THRESHOLD).toBe(7);
    });

    it('should have CPI_RATE_THRESHOLD set to 2.5', () => {
      expect(wizardService.CPI_RATE_THRESHOLD).toBe(2.5);
    });
  });
});
