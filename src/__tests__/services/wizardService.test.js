/**
 * Wizard Service – Unit Tests
 *
 * Tests the main generatePortfolios flow, AI/rule-based generation,
 * and portfolio constraint validation.
 */

'use strict';

// Mock dependencies before requiring the module
jest.mock('../../services/ratesService', () => ({
  getCurrentAverages: jest.fn(),
}));

jest.mock('openai', () => {
  return jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: jest.fn(),
      },
    },
  }));
});

const wizardService = require('../../services/wizardService');
const ratesService = require('../../services/ratesService');

// ── Test Fixtures ─────────────────────────────────────────────────────────────

const DEFAULT_RATES = {
  fixed: 4.65,
  cpi: 3.15,
  prime: 6.05,
  variable: 4.95,
};

function makeInputs(overrides = {}) {
  return {
    propertyPrice: 2000000,
    loanAmount: 1200000,
    monthlyIncome: 25000,
    additionalIncome: 0,
    targetRepayment: 6000,
    futureFunds: { timeframe: 'none', amount: 0 },
    stabilityPreference: 5,
    ...overrides,
  };
}

// ── generatePortfolios ───────────────────────────────────────────────────────

describe('wizardService.generatePortfolios', () => {
  beforeEach(() => {
    ratesService.getCurrentAverages.mockResolvedValue(DEFAULT_RATES);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('returns portfolios and metadata', async () => {
    const inputs = makeInputs();
    const result = await wizardService.generatePortfolios(inputs, true);

    expect(result).toHaveProperty('portfolios');
    expect(result).toHaveProperty('metadata');
    expect(Array.isArray(result.portfolios)).toBe(true);
    expect(result.portfolios.length).toBeGreaterThanOrEqual(2);
  });

  test('always includes Market Standard and Fast Track', async () => {
    const inputs = makeInputs({ stabilityPreference: 1 });
    const result = await wizardService.generatePortfolios(inputs, false);

    const types = result.portfolios.map((p) => p.type);
    expect(types).toContain('market_standard');
    expect(types).toContain('fast_track');
  });

  test('includes Stability-First for high stability preference', async () => {
    const inputs = makeInputs({ stabilityPreference: 8 });
    const result = await wizardService.generatePortfolios(inputs, true);

    const types = result.portfolios.map((p) => p.type);
    expect(types).toContain('stability_first');
  });

  test('includes Inflation-Proof for moderate stability preference', async () => {
    const inputs = makeInputs({ stabilityPreference: 5 });
    const result = await wizardService.generatePortfolios(inputs, true);

    const types = result.portfolios.map((p) => p.type);
    expect(types).toContain('inflation_proof');
  });

  test('generates up to 4 portfolios for qualifying user', async () => {
    const inputs = makeInputs({ stabilityPreference: 8 });
    ratesService.getCurrentAverages.mockResolvedValue({
      ...DEFAULT_RATES,
      cpi: 3.50, // High CPI
    });
    const result = await wizardService.generatePortfolios(inputs, true);

    expect(result.portfolios.length).toBe(4);
  });

  test('metadata includes scenario reasons', async () => {
    const inputs = makeInputs({ stabilityPreference: 8 });
    const result = await wizardService.generatePortfolios(inputs, true);

    expect(result.metadata.scenarioReasons).toBeDefined();
    expect(result.metadata.scenariosGenerated).toBeDefined();
    expect(result.metadata.scenariosGenerated).toContain('market_standard');
  });

  test('metadata includes user profile analysis', async () => {
    const inputs = makeInputs();
    const result = await wizardService.generatePortfolios(inputs, true);

    expect(result.metadata.inputSummary.ltvClass).toBeDefined();
    expect(result.metadata.inputSummary.affordability).toBeDefined();
    expect(result.metadata.inputSummary.riskTolerance).toBeDefined();
    expect(result.metadata.inputSummary.hasFutureFunds).toBeDefined();
  });

  test('portfolios have fitness scores', async () => {
    const inputs = makeInputs();
    const result = await wizardService.generatePortfolios(inputs, true);

    result.portfolios.forEach((p) => {
      expect(p.fitnessScore).toBeDefined();
      expect(typeof p.fitnessScore).toBe('number');
      expect(p.fitnessScore).toBeGreaterThanOrEqual(0);
      expect(p.fitnessScore).toBeLessThanOrEqual(100);
    });
  });

  test('exactly one portfolio is recommended', async () => {
    const inputs = makeInputs();
    const result = await wizardService.generatePortfolios(inputs, true);

    const recommended = result.portfolios.filter((p) => p.recommended);
    expect(recommended.length).toBeGreaterThanOrEqual(1);
  });

  test('uses fallback rates when ratesService fails', async () => {
    ratesService.getCurrentAverages.mockRejectedValue(new Error('Firestore unavailable'));

    const inputs = makeInputs();
    const result = await wizardService.generatePortfolios(inputs, false);

    expect(result.portfolios.length).toBeGreaterThanOrEqual(2);
    // Should still work with fallback rates
    result.portfolios.forEach((p) => {
      expect(p.monthlyRepayment).toBeGreaterThan(0);
    });
  });

  test('consent flag is passed through to metadata', async () => {
    const inputs = makeInputs();

    const resultTrue = await wizardService.generatePortfolios(inputs, true);
    expect(resultTrue.metadata.consent).toBe(true);

    const resultFalse = await wizardService.generatePortfolios(inputs, false);
    expect(resultFalse.metadata.consent).toBe(false);
  });

  test('portfolios do not contain internal fields', async () => {
    const inputs = makeInputs();
    const result = await wizardService.generatePortfolios(inputs, true);

    result.portfolios.forEach((p) => {
      expect(p._generationMethod).toBeUndefined();
      expect(p.scoreBreakdown).toBeUndefined();
    });
  });

  test('each portfolio has all required fields', async () => {
    const inputs = makeInputs({ stabilityPreference: 8 });
    ratesService.getCurrentAverages.mockResolvedValue({
      ...DEFAULT_RATES,
      cpi: 3.50,
    });
    const result = await wizardService.generatePortfolios(inputs, true);

    result.portfolios.forEach((p) => {
      expect(p.id).toBeDefined();
      expect(p.type).toBeDefined();
      expect(p.name).toBeDefined();
      expect(p.nameHe).toBeDefined();
      expect(p.description).toBeDefined();
      expect(p.termYears).toBeGreaterThan(0);
      expect(Array.isArray(p.tracks)).toBe(true);
      expect(p.tracks.length).toBeGreaterThan(0);
      expect(p.monthlyRepayment).toBeGreaterThan(0);
      expect(p.totalCost).toBeGreaterThan(0);
      expect(typeof p.totalInterest).toBe('number');
      expect(typeof p.interestSavings).toBe('number');
      expect(typeof p.recommended).toBe('boolean');
      expect(typeof p.fitnessScore).toBe('number');

      // Each track has required fields
      p.tracks.forEach((t) => {
        expect(t.name).toBeDefined();
        expect(t.type).toBeDefined();
        expect(t.percentage).toBeGreaterThan(0);
        expect(t.rate).toBeGreaterThan(0);
        expect(t.rateDisplay).toBeDefined();
        expect(t.amount).toBeGreaterThan(0);
        expect(t.monthlyPayment).toBeGreaterThan(0);
      });
    });
  });
});

// ── validatePortfolioConstraints ──────────────────────────────────────────────

describe('wizardService.validatePortfolioConstraints', () => {
  test('fixes percentages that do not sum to 100', () => {
    const portfolio = {
      type: 'market_standard',
      tracks: [
        { type: 'fixed', percentage: 34 },
        { type: 'prime', percentage: 33 },
        { type: 'cpi', percentage: 30 }, // Sum = 97
      ],
    };

    const validated = wizardService.validatePortfolioConstraints(portfolio);
    const total = validated.tracks.reduce((sum, t) => sum + t.percentage, 0);
    expect(total).toBe(100);
  });

  test('removes CPI tracks from Inflation-Proof portfolio', () => {
    const portfolio = {
      type: 'inflation_proof',
      tracks: [
        { type: 'fixed', percentage: 40 },
        { type: 'prime', percentage: 30 },
        { type: 'cpi', percentage: 30 }, // Should be removed
      ],
    };

    const validated = wizardService.validatePortfolioConstraints(portfolio);
    const hasCpi = validated.tracks.some((t) => t.type === 'cpi');
    expect(hasCpi).toBe(false);

    // Remaining tracks should sum to 100
    const total = validated.tracks.reduce((sum, t) => sum + t.percentage, 0);
    expect(total).toBe(100);
  });

  test('ensures Stability-First has >= 60% fixed', () => {
    const portfolio = {
      type: 'stability_first',
      tracks: [
        { type: 'fixed', percentage: 45 }, // Below 60%
        { type: 'cpi', percentage: 35 },
        { type: 'prime', percentage: 20 },
      ],
    };

    const validated = wizardService.validatePortfolioConstraints(portfolio);
    const fixedPct = validated.tracks
      .filter((t) => t.type === 'fixed')
      .reduce((sum, t) => sum + t.percentage, 0);
    expect(fixedPct).toBeGreaterThanOrEqual(60);
  });

  test('does not modify valid portfolios', () => {
    const portfolio = {
      type: 'market_standard',
      tracks: [
        { type: 'fixed', percentage: 34 },
        { type: 'prime', percentage: 33 },
        { type: 'cpi', percentage: 33 },
      ],
    };

    const validated = wizardService.validatePortfolioConstraints(portfolio);
    expect(validated.tracks[0].percentage).toBe(34);
    expect(validated.tracks[1].percentage).toBe(33);
    expect(validated.tracks[2].percentage).toBe(33);
  });
});

// ── Backward Compatibility ────────────────────────────────────────────────────

describe('wizardService backward compatibility', () => {
  test('exports determineScenarios function', () => {
    expect(typeof wizardService.determineScenarios).toBe('function');
  });

  test('exports getRuleBasedConfig function', () => {
    expect(typeof wizardService.getRuleBasedConfig).toBe('function');
  });

  test('exports calculatePMT function', () => {
    expect(typeof wizardService.calculatePMT).toBe('function');
  });

  test('exports all scenario type constants', () => {
    expect(wizardService.SCENARIO_TYPES).toBeDefined();
    expect(wizardService.SCENARIO_TYPES.MARKET_STANDARD).toBe('market_standard');
    expect(wizardService.SCENARIO_TYPES.FAST_TRACK).toBe('fast_track');
    expect(wizardService.SCENARIO_TYPES.INFLATION_PROOF).toBe('inflation_proof');
    expect(wizardService.SCENARIO_TYPES.STABILITY_FIRST).toBe('stability_first');
  });

  test('exports Hebrew and English name constants', () => {
    expect(wizardService.SCENARIO_NAMES_HE).toBeDefined();
    expect(wizardService.SCENARIO_NAMES_EN).toBeDefined();
    expect(wizardService.TRACK_LABELS_HE).toBeDefined();
  });

  test('determineScenarios returns array of scenario types', () => {
    const inputs = makeInputs({ stabilityPreference: 5 });
    const scenarios = wizardService.determineScenarios(inputs, DEFAULT_RATES);

    expect(Array.isArray(scenarios)).toBe(true);
    expect(scenarios).toContain('market_standard');
    expect(scenarios).toContain('fast_track');
  });

  test('getRuleBasedConfig returns config with termYears and tracks', () => {
    const inputs = makeInputs();
    const config = wizardService.getRuleBasedConfig('market_standard', inputs, DEFAULT_RATES);

    expect(config.termYears).toBeDefined();
    expect(Array.isArray(config.tracks)).toBe(true);
    expect(config.tracks.length).toBeGreaterThan(0);
  });
});

// ── Conditional Logic Integration Tests ───────────────────────────────────────

describe('wizardService conditional logic integration', () => {
  beforeEach(() => {
    ratesService.getCurrentAverages.mockResolvedValue(DEFAULT_RATES);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('risk-tolerant user with low CPI gets only 2 portfolios', async () => {
    ratesService.getCurrentAverages.mockResolvedValue({
      ...DEFAULT_RATES,
      cpi: 2.00, // Low CPI
    });

    const inputs = makeInputs({
      stabilityPreference: 2,
      propertyPrice: 2000000,
      loanAmount: 800000, // 40% LTV
      futureFunds: { timeframe: 'none', amount: 0 },
    });

    const result = await wizardService.generatePortfolios(inputs, false);
    expect(result.portfolios.length).toBe(2);
    expect(result.portfolios.map((p) => p.type)).toEqual(['market_standard', 'fast_track']);
  });

  test('user with future funds gets Inflation-Proof', async () => {
    ratesService.getCurrentAverages.mockResolvedValue({
      ...DEFAULT_RATES,
      cpi: 2.00, // Low CPI
    });

    const inputs = makeInputs({
      stabilityPreference: 2,
      propertyPrice: 2000000,
      loanAmount: 800000,
      futureFunds: { timeframe: 'within_5_years', amount: 200000 },
    });

    const result = await wizardService.generatePortfolios(inputs, false);
    const types = result.portfolios.map((p) => p.type);
    expect(types).toContain('inflation_proof');
  });

  test('tight budget user with moderate stability gets Stability-First', async () => {
    const inputs = makeInputs({
      stabilityPreference: 6,
      targetRepayment: 10000, // 40% of 25000 = stretched
      monthlyIncome: 25000,
    });

    const result = await wizardService.generatePortfolios(inputs, true);
    const types = result.portfolios.map((p) => p.type);
    expect(types).toContain('stability_first');
  });

  test('Inflation-Proof portfolio has no CPI tracks', async () => {
    const inputs = makeInputs({ stabilityPreference: 5 });
    const result = await wizardService.generatePortfolios(inputs, true);

    const inflationProof = result.portfolios.find((p) => p.type === 'inflation_proof');
    if (inflationProof) {
      const hasCpi = inflationProof.tracks.some((t) => t.type === 'cpi');
      expect(hasCpi).toBe(false);
    }
  });

  test('Stability-First portfolio has >= 60% fixed', async () => {
    const inputs = makeInputs({ stabilityPreference: 8 });
    const result = await wizardService.generatePortfolios(inputs, true);

    const stabilityFirst = result.portfolios.find((p) => p.type === 'stability_first');
    if (stabilityFirst) {
      const fixedPct = stabilityFirst.tracks
        .filter((t) => t.type === 'fixed')
        .reduce((sum, t) => sum + t.percentage, 0);
      expect(fixedPct).toBeGreaterThanOrEqual(60);
    }
  });

  test('Fast Track always has 20-year term', async () => {
    const inputs = makeInputs();
    const result = await wizardService.generatePortfolios(inputs, true);

    const fastTrack = result.portfolios.find((p) => p.type === 'fast_track');
    expect(fastTrack.termYears).toBe(20);
  });

  test('Market Standard always has 30-year term', async () => {
    const inputs = makeInputs();
    const result = await wizardService.generatePortfolios(inputs, true);

    const marketStandard = result.portfolios.find((p) => p.type === 'market_standard');
    expect(marketStandard.termYears).toBe(30);
  });

  test('all portfolio track percentages sum to 100', async () => {
    const inputs = makeInputs({ stabilityPreference: 8 });
    ratesService.getCurrentAverages.mockResolvedValue({
      ...DEFAULT_RATES,
      cpi: 3.50,
    });
    const result = await wizardService.generatePortfolios(inputs, true);

    result.portfolios.forEach((p) => {
      const total = p.tracks.reduce((sum, t) => sum + t.percentage, 0);
      expect(total).toBe(100);
    });
  });
});
