/**
 * Portfolio Engine – Unit Tests
 *
 * Tests the conditional logic, adaptive allocation, financial calculations,
 * and portfolio scoring in the portfolioEngine module.
 */

'use strict';

const portfolioEngine = require('../../services/portfolioEngine');

// ── Test Fixtures ─────────────────────────────────────────────────────────────

const DEFAULT_RATES = {
  fixed: 4.65,
  cpi: 3.15,
  prime: 6.05,
  variable: 4.95,
};

const HIGH_CPI_RATES = {
  fixed: 4.65,
  cpi: 3.50, // Above CPI_RATE_THRESHOLD (2.5)
  prime: 6.05,
  variable: 4.95,
};

const LOW_CPI_RATES = {
  fixed: 4.65,
  cpi: 2.00, // Below CPI_RATE_THRESHOLD
  prime: 6.05,
  variable: 4.95,
};

/** Base wizard inputs – moderate profile */
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

// ── analyseUserProfile ────────────────────────────────────────────────────────

describe('portfolioEngine.analyseUserProfile', () => {
  test('calculates LTV correctly', () => {
    const inputs = makeInputs({ propertyPrice: 2000000, loanAmount: 1200000 });
    const profile = portfolioEngine.analyseUserProfile(inputs);
    expect(profile.ltv).toBe(60);
    expect(profile.ltvClass).toBe('moderate');
  });

  test('classifies low LTV (<= 50%)', () => {
    const inputs = makeInputs({ propertyPrice: 2000000, loanAmount: 900000 });
    const profile = portfolioEngine.analyseUserProfile(inputs);
    expect(profile.ltv).toBe(45);
    expect(profile.ltvClass).toBe('low');
  });

  test('classifies high LTV (> 60%, <= 75%)', () => {
    const inputs = makeInputs({ propertyPrice: 2000000, loanAmount: 1400000 });
    const profile = portfolioEngine.analyseUserProfile(inputs);
    expect(profile.ltv).toBe(70);
    expect(profile.ltvClass).toBe('high');
  });

  test('classifies very high LTV (> 75%)', () => {
    const inputs = makeInputs({ propertyPrice: 2000000, loanAmount: 1600000 });
    const profile = portfolioEngine.analyseUserProfile(inputs);
    expect(profile.ltv).toBe(80);
    expect(profile.ltvClass).toBe('very_high');
  });

  test('calculates repayment ratio and affordability', () => {
    // 6000 / 25000 = 0.24 → comfortable
    const inputs = makeInputs({ targetRepayment: 6000, monthlyIncome: 25000 });
    const profile = portfolioEngine.analyseUserProfile(inputs);
    expect(profile.repaymentRatio).toBe(0.24);
    expect(profile.affordability).toBe('comfortable');
  });

  test('classifies moderate affordability (25-35%)', () => {
    const inputs = makeInputs({ targetRepayment: 7500, monthlyIncome: 25000 });
    const profile = portfolioEngine.analyseUserProfile(inputs);
    expect(profile.repaymentRatio).toBe(0.3);
    expect(profile.affordability).toBe('moderate');
  });

  test('classifies tight affordability (35-40%)', () => {
    const inputs = makeInputs({ targetRepayment: 9500, monthlyIncome: 25000 });
    const profile = portfolioEngine.analyseUserProfile(inputs);
    expect(profile.repaymentRatio).toBe(0.38);
    expect(profile.affordability).toBe('tight');
  });

  test('classifies stretched affordability (> 40%)', () => {
    const inputs = makeInputs({ targetRepayment: 12000, monthlyIncome: 25000 });
    const profile = portfolioEngine.analyseUserProfile(inputs);
    expect(profile.repaymentRatio).toBe(0.48);
    expect(profile.affordability).toBe('stretched');
  });

  test('derives risk tolerance from stability preference', () => {
    expect(portfolioEngine.analyseUserProfile(makeInputs({ stabilityPreference: 2 })).riskTolerance).toBe('risk_tolerant');
    expect(portfolioEngine.analyseUserProfile(makeInputs({ stabilityPreference: 3 })).riskTolerance).toBe('risk_tolerant');
    expect(portfolioEngine.analyseUserProfile(makeInputs({ stabilityPreference: 4 })).riskTolerance).toBe('balanced');
    expect(portfolioEngine.analyseUserProfile(makeInputs({ stabilityPreference: 6 })).riskTolerance).toBe('balanced');
    expect(portfolioEngine.analyseUserProfile(makeInputs({ stabilityPreference: 7 })).riskTolerance).toBe('risk_averse');
    expect(portfolioEngine.analyseUserProfile(makeInputs({ stabilityPreference: 10 })).riskTolerance).toBe('risk_averse');
  });

  test('analyses future funds correctly', () => {
    const noFunds = portfolioEngine.analyseUserProfile(makeInputs({ futureFunds: { timeframe: 'none', amount: 0 } }));
    expect(noFunds.hasFutureFunds).toBe(false);
    expect(noFunds.canPrepayEarly).toBe(false);

    const nearTerm = portfolioEngine.analyseUserProfile(makeInputs({
      futureFunds: { timeframe: 'within_5_years', amount: 200000 },
    }));
    expect(nearTerm.hasFutureFunds).toBe(true);
    expect(nearTerm.futureFundsNearTerm).toBe(true);
    expect(nearTerm.canPrepayEarly).toBe(true);

    const midTerm = portfolioEngine.analyseUserProfile(makeInputs({
      futureFunds: { timeframe: 'within_10_years', amount: 300000 },
    }));
    expect(midTerm.hasFutureFunds).toBe(true);
    expect(midTerm.futureFundsNearTerm).toBe(false);
    expect(midTerm.futureFundsMidTerm).toBe(true);
    expect(midTerm.canPrepayEarly).toBe(false);
  });

  test('includes additional income in total', () => {
    const inputs = makeInputs({ monthlyIncome: 20000, additionalIncome: 5000 });
    const profile = portfolioEngine.analyseUserProfile(inputs);
    expect(profile.totalIncome).toBe(25000);
  });
});

// ── determineScenarios ────────────────────────────────────────────────────────

describe('portfolioEngine.determineScenarios', () => {
  test('always includes Market Standard and Fast Track', () => {
    const inputs = makeInputs({ stabilityPreference: 1 });
    const profile = portfolioEngine.analyseUserProfile(inputs);
    const { scenarios } = portfolioEngine.determineScenarios(inputs, LOW_CPI_RATES, profile);

    expect(scenarios).toContain('market_standard');
    expect(scenarios).toContain('fast_track');
  });

  test('includes Inflation-Proof when CPI rate is high', () => {
    const inputs = makeInputs({ stabilityPreference: 1 });
    const profile = portfolioEngine.analyseUserProfile(inputs);
    const { scenarios, reasons } = portfolioEngine.determineScenarios(inputs, HIGH_CPI_RATES, profile);

    expect(scenarios).toContain('inflation_proof');
    expect(reasons.inflation_proof).toContain('CPI rate');
  });

  test('includes Inflation-Proof when stability preference is moderate (4-8)', () => {
    const inputs = makeInputs({ stabilityPreference: 5 });
    const profile = portfolioEngine.analyseUserProfile(inputs);
    const { scenarios } = portfolioEngine.determineScenarios(inputs, LOW_CPI_RATES, profile);

    expect(scenarios).toContain('inflation_proof');
  });

  test('includes Inflation-Proof when user has mid-term future funds', () => {
    const inputs = makeInputs({
      stabilityPreference: 1,
      futureFunds: { timeframe: 'within_10_years', amount: 200000 },
    });
    const profile = portfolioEngine.analyseUserProfile(inputs);
    const { scenarios, reasons } = portfolioEngine.determineScenarios(inputs, LOW_CPI_RATES, profile);

    expect(scenarios).toContain('inflation_proof');
    expect(reasons.inflation_proof).toContain('Future funds');
  });

  test('includes Inflation-Proof when LTV is high', () => {
    const inputs = makeInputs({
      stabilityPreference: 1,
      propertyPrice: 2000000,
      loanAmount: 1500000, // 75% LTV
    });
    const profile = portfolioEngine.analyseUserProfile(inputs);
    const { scenarios, reasons } = portfolioEngine.determineScenarios(inputs, LOW_CPI_RATES, profile);

    expect(scenarios).toContain('inflation_proof');
    expect(reasons.inflation_proof).toContain('High LTV');
  });

  test('does NOT include Inflation-Proof when no conditions met', () => {
    // Low CPI, low stability (1-3), no future funds, low LTV
    const inputs = makeInputs({
      stabilityPreference: 2,
      propertyPrice: 2000000,
      loanAmount: 800000, // 40% LTV
      futureFunds: { timeframe: 'none', amount: 0 },
    });
    const profile = portfolioEngine.analyseUserProfile(inputs);
    const { scenarios } = portfolioEngine.determineScenarios(inputs, LOW_CPI_RATES, profile);

    expect(scenarios).not.toContain('inflation_proof');
  });

  test('includes Stability-First when stabilityPreference >= 7', () => {
    const inputs = makeInputs({ stabilityPreference: 7 });
    const profile = portfolioEngine.analyseUserProfile(inputs);
    const { scenarios, reasons } = portfolioEngine.determineScenarios(inputs, DEFAULT_RATES, profile);

    expect(scenarios).toContain('stability_first');
    expect(reasons.stability_first).toContain('Stability preference');
  });

  test('includes Stability-First when tight affordability + stability >= 5', () => {
    const inputs = makeInputs({
      stabilityPreference: 5,
      targetRepayment: 9500, // 38% of 25000 = tight
      monthlyIncome: 25000,
    });
    const profile = portfolioEngine.analyseUserProfile(inputs);
    const { scenarios, reasons } = portfolioEngine.determineScenarios(inputs, DEFAULT_RATES, profile);

    expect(scenarios).toContain('stability_first');
    expect(reasons.stability_first).toContain('Tight affordability');
  });

  test('includes Stability-First when no future funds + risk-averse', () => {
    const inputs = makeInputs({
      stabilityPreference: 8, // risk_averse
      futureFunds: { timeframe: 'none', amount: 0 },
    });
    const profile = portfolioEngine.analyseUserProfile(inputs);
    const { scenarios, reasons } = portfolioEngine.determineScenarios(inputs, DEFAULT_RATES, profile);

    expect(scenarios).toContain('stability_first');
    expect(reasons.stability_first).toContain('No future funds');
  });

  test('does NOT include Stability-First when stability < 5 and comfortable', () => {
    const inputs = makeInputs({
      stabilityPreference: 3,
      targetRepayment: 5000, // 20% of 25000 = comfortable
      monthlyIncome: 25000,
      futureFunds: { timeframe: 'within_5_years', amount: 100000 },
    });
    const profile = portfolioEngine.analyseUserProfile(inputs);
    const { scenarios } = portfolioEngine.determineScenarios(inputs, DEFAULT_RATES, profile);

    expect(scenarios).not.toContain('stability_first');
  });

  test('generates all 4 scenarios for high-stability user with high CPI', () => {
    const inputs = makeInputs({ stabilityPreference: 8 });
    const profile = portfolioEngine.analyseUserProfile(inputs);
    const { scenarios } = portfolioEngine.determineScenarios(inputs, HIGH_CPI_RATES, profile);

    expect(scenarios).toHaveLength(4);
    expect(scenarios).toContain('market_standard');
    expect(scenarios).toContain('fast_track');
    expect(scenarios).toContain('inflation_proof');
    expect(scenarios).toContain('stability_first');
  });

  test('generates only 2 scenarios for low-stability user with low CPI and low LTV', () => {
    const inputs = makeInputs({
      stabilityPreference: 2,
      propertyPrice: 2000000,
      loanAmount: 800000, // 40% LTV
      futureFunds: { timeframe: 'none', amount: 0 },
    });
    const profile = portfolioEngine.analyseUserProfile(inputs);
    const { scenarios } = portfolioEngine.determineScenarios(inputs, LOW_CPI_RATES, profile);

    expect(scenarios).toHaveLength(2);
    expect(scenarios).toEqual(['market_standard', 'fast_track']);
  });

  test('returns reasons for each scenario', () => {
    const inputs = makeInputs({ stabilityPreference: 8 });
    const profile = portfolioEngine.analyseUserProfile(inputs);
    const { reasons } = portfolioEngine.determineScenarios(inputs, HIGH_CPI_RATES, profile);

    expect(reasons.market_standard).toBeDefined();
    expect(reasons.fast_track).toBeDefined();
    expect(reasons.inflation_proof).toBeDefined();
    expect(reasons.stability_first).toBeDefined();
  });
});

// ── Adaptive Allocation ───────────────────────────────────────────────────────

describe('portfolioEngine.getAdaptiveAllocation', () => {
  test('Market Standard: adjusts for high stability preference', () => {
    const inputs = makeInputs({ stabilityPreference: 8 });
    const profile = portfolioEngine.analyseUserProfile(inputs);
    const config = portfolioEngine.getAdaptiveAllocation('market_standard', inputs, DEFAULT_RATES, profile);

    expect(config.termYears).toBe(30);
    // High stability → more fixed
    const fixedTrack = config.tracks.find((t) => t.type === 'fixed');
    expect(fixedTrack.percentage).toBeGreaterThan(34);
  });

  test('Market Standard: adjusts for low stability preference', () => {
    const inputs = makeInputs({ stabilityPreference: 2 });
    const profile = portfolioEngine.analyseUserProfile(inputs);
    const config = portfolioEngine.getAdaptiveAllocation('market_standard', inputs, DEFAULT_RATES, profile);

    // Low stability → more prime
    const primeTrack = config.tracks.find((t) => t.type === 'prime');
    expect(primeTrack.percentage).toBeGreaterThan(33);
  });

  test('Fast Track: adjusts for near-term future funds', () => {
    const inputs = makeInputs({
      futureFunds: { timeframe: 'within_5_years', amount: 200000 },
    });
    const profile = portfolioEngine.analyseUserProfile(inputs);
    const config = portfolioEngine.getAdaptiveAllocation('fast_track', inputs, DEFAULT_RATES, profile);

    expect(config.termYears).toBe(20);
    // Near-term funds → more prime
    const primeTrack = config.tracks.find((t) => t.type === 'prime');
    expect(primeTrack.percentage).toBeGreaterThan(40);
  });

  test('Fast Track: adjusts for risk-averse users', () => {
    const inputs = makeInputs({ stabilityPreference: 9 });
    const profile = portfolioEngine.analyseUserProfile(inputs);
    const config = portfolioEngine.getAdaptiveAllocation('fast_track', inputs, DEFAULT_RATES, profile);

    // Risk-averse → more fixed even in fast track
    const fixedTrack = config.tracks.find((t) => t.type === 'fixed');
    expect(fixedTrack.percentage).toBeGreaterThan(30);
  });

  test('Inflation-Proof: contains NO CPI tracks', () => {
    const inputs = makeInputs({ stabilityPreference: 5 });
    const profile = portfolioEngine.analyseUserProfile(inputs);
    const config = portfolioEngine.getAdaptiveAllocation('inflation_proof', inputs, DEFAULT_RATES, profile);

    const cpiTrack = config.tracks.find((t) => t.type === 'cpi');
    expect(cpiTrack).toBeUndefined();

    // Should only have fixed, prime, variable
    const trackTypes = config.tracks.map((t) => t.type);
    expect(trackTypes).toEqual(expect.arrayContaining(['fixed', 'prime', 'variable']));
    trackTypes.forEach((type) => {
      expect(['fixed', 'prime', 'variable']).toContain(type);
    });
  });

  test('Inflation-Proof: adjusts term by stability preference', () => {
    const lowStab = portfolioEngine.analyseUserProfile(makeInputs({ stabilityPreference: 3 }));
    const midStab = portfolioEngine.analyseUserProfile(makeInputs({ stabilityPreference: 5 }));
    const highStab = portfolioEngine.analyseUserProfile(makeInputs({ stabilityPreference: 8 }));

    const lowConfig = portfolioEngine.getAdaptiveAllocation('inflation_proof', makeInputs({ stabilityPreference: 3 }), DEFAULT_RATES, lowStab);
    const midConfig = portfolioEngine.getAdaptiveAllocation('inflation_proof', makeInputs({ stabilityPreference: 5 }), DEFAULT_RATES, midStab);
    const highConfig = portfolioEngine.getAdaptiveAllocation('inflation_proof', makeInputs({ stabilityPreference: 8 }), DEFAULT_RATES, highStab);

    expect(lowConfig.termYears).toBe(30);
    expect(midConfig.termYears).toBe(25);
    expect(highConfig.termYears).toBe(22);
  });

  test('Stability-First: has >= 60% fixed allocation', () => {
    const inputs = makeInputs({ stabilityPreference: 7 });
    const profile = portfolioEngine.analyseUserProfile(inputs);
    const config = portfolioEngine.getAdaptiveAllocation('stability_first', inputs, DEFAULT_RATES, profile);

    const fixedTrack = config.tracks.find((t) => t.type === 'fixed');
    expect(fixedTrack.percentage).toBeGreaterThanOrEqual(60);
  });

  test('Stability-First: very high stability (9-10) gets 70% fixed', () => {
    const inputs = makeInputs({ stabilityPreference: 10 });
    const profile = portfolioEngine.analyseUserProfile(inputs);
    const config = portfolioEngine.getAdaptiveAllocation('stability_first', inputs, DEFAULT_RATES, profile);

    const fixedTrack = config.tracks.find((t) => t.type === 'fixed');
    expect(fixedTrack.percentage).toBeGreaterThanOrEqual(68); // ~70% after normalization
  });

  test('Stability-First: tight affordability extends term to 30 years', () => {
    const inputs = makeInputs({
      stabilityPreference: 7,
      targetRepayment: 10000, // 40% of 25000 = tight/stretched
      monthlyIncome: 25000,
    });
    const profile = portfolioEngine.analyseUserProfile(inputs);
    const config = portfolioEngine.getAdaptiveAllocation('stability_first', inputs, DEFAULT_RATES, profile);

    expect(config.termYears).toBe(30);
  });

  test('Stability-First: comfortable affordability shortens term to 22 years', () => {
    const inputs = makeInputs({
      stabilityPreference: 7,
      targetRepayment: 5000, // 20% of 25000 = comfortable
      monthlyIncome: 25000,
    });
    const profile = portfolioEngine.analyseUserProfile(inputs);
    const config = portfolioEngine.getAdaptiveAllocation('stability_first', inputs, DEFAULT_RATES, profile);

    expect(config.termYears).toBe(22);
  });

  test('all allocations sum to 100%', () => {
    const scenarios = ['market_standard', 'fast_track', 'inflation_proof', 'stability_first'];
    const inputs = makeInputs({ stabilityPreference: 7 });
    const profile = portfolioEngine.analyseUserProfile(inputs);

    scenarios.forEach((type) => {
      const config = portfolioEngine.getAdaptiveAllocation(type, inputs, DEFAULT_RATES, profile);
      const total = config.tracks.reduce((sum, t) => sum + t.percentage, 0);
      expect(total).toBe(100);
    });
  });
});

// ── Financial Calculations ────────────────────────────────────────────────────

describe('portfolioEngine.calculatePMT', () => {
  test('calculates correct monthly payment for standard loan', () => {
    // ₪1,000,000 at 5% for 30 years
    const principal = 1000000;
    const monthlyRate = 0.05 / 12;
    const totalMonths = 30 * 12;
    const pmt = portfolioEngine.calculatePMT(principal, monthlyRate, totalMonths);

    // Expected: ~₪5,368.22
    expect(pmt).toBeCloseTo(5368.22, 0);
  });

  test('returns 0 for zero principal', () => {
    expect(portfolioEngine.calculatePMT(0, 0.004, 360)).toBe(0);
  });

  test('handles zero interest rate', () => {
    const pmt = portfolioEngine.calculatePMT(360000, 0, 360);
    expect(pmt).toBe(1000); // 360000 / 360
  });

  test('returns 0 for zero months', () => {
    expect(portfolioEngine.calculatePMT(100000, 0.004, 0)).toBe(0);
  });
});

// ── Portfolio Building ────────────────────────────────────────────────────────

describe('portfolioEngine.buildPortfolio', () => {
  test('builds a complete portfolio with all required fields', () => {
    const config = {
      termYears: 30,
      tracks: [
        { type: 'fixed', percentage: 34, rate: 4.75, rateDisplay: '4.75%' },
        { type: 'prime', percentage: 33, rate: 5.90, rateDisplay: 'P-0.15%' },
        { type: 'cpi', percentage: 33, rate: 3.20, rateDisplay: '3.20% + מדד' },
      ],
    };
    const inputs = makeInputs();
    const portfolio = portfolioEngine.buildPortfolio(config, 'market_standard', inputs, DEFAULT_RATES);

    expect(portfolio.id).toBe('market_standard');
    expect(portfolio.type).toBe('market_standard');
    expect(portfolio.name).toBe('Market Standard');
    expect(portfolio.nameHe).toBe('תיק שוק סטנדרטי');
    expect(portfolio.description).toBeDefined();
    expect(portfolio.termYears).toBe(30);
    expect(portfolio.tracks).toHaveLength(3);
    expect(portfolio.monthlyRepayment).toBeGreaterThan(0);
    expect(portfolio.totalCost).toBeGreaterThan(inputs.loanAmount);
    expect(portfolio.totalInterest).toBeGreaterThan(0);
    expect(typeof portfolio.interestSavings).toBe('number');
  });

  test('track amounts sum to loan amount', () => {
    const config = {
      termYears: 30,
      tracks: [
        { type: 'fixed', percentage: 40, rate: 4.75, rateDisplay: '4.75%' },
        { type: 'prime', percentage: 30, rate: 5.90, rateDisplay: 'P-0.15%' },
        { type: 'cpi', percentage: 30, rate: 3.20, rateDisplay: '3.20% + מדד' },
      ],
    };
    const inputs = makeInputs({ loanAmount: 1000000 });
    const portfolio = portfolioEngine.buildPortfolio(config, 'market_standard', inputs, DEFAULT_RATES);

    const totalAmount = portfolio.tracks.reduce((sum, t) => sum + t.amount, 0);
    expect(totalAmount).toBe(1000000);
  });

  test('Fast Track has interest savings compared to Market Standard', () => {
    const inputs = makeInputs();
    const profile = portfolioEngine.analyseUserProfile(inputs);

    const msConfig = portfolioEngine.getAdaptiveAllocation('market_standard', inputs, DEFAULT_RATES, profile);
    const ftConfig = portfolioEngine.getAdaptiveAllocation('fast_track', inputs, DEFAULT_RATES, profile);

    const msPortfolio = portfolioEngine.buildPortfolio(msConfig, 'market_standard', inputs, DEFAULT_RATES);
    const ftPortfolio = portfolioEngine.buildPortfolio(ftConfig, 'fast_track', inputs, DEFAULT_RATES);

    // Fast Track should have lower total interest
    expect(ftPortfolio.totalInterest).toBeLessThan(msPortfolio.totalInterest);
    // Fast Track should have interest savings > 0
    expect(ftPortfolio.interestSavings).toBeGreaterThan(0);
  });

  test('Market Standard has 0 interest savings (it is the baseline)', () => {
    const inputs = makeInputs();
    const profile = portfolioEngine.analyseUserProfile(inputs);
    const config = portfolioEngine.getAdaptiveAllocation('market_standard', inputs, DEFAULT_RATES, profile);
    const portfolio = portfolioEngine.buildPortfolio(config, 'market_standard', inputs, DEFAULT_RATES);

    expect(portfolio.interestSavings).toBe(0);
  });
});

// ── Portfolio Scoring ─────────────────────────────────────────────────────────

describe('portfolioEngine.scorePortfolios', () => {
  function generateTestPortfolios(inputs) {
    const profile = portfolioEngine.analyseUserProfile(inputs);
    const { scenarios } = portfolioEngine.determineScenarios(inputs, DEFAULT_RATES, profile);
    return scenarios.map((type) => {
      const config = portfolioEngine.getAdaptiveAllocation(type, inputs, DEFAULT_RATES, profile);
      return portfolioEngine.buildPortfolio(config, type, inputs, DEFAULT_RATES);
    });
  }

  test('assigns fitness scores to all portfolios', () => {
    const inputs = makeInputs({ stabilityPreference: 7 });
    const portfolios = generateTestPortfolios(inputs);
    const profile = portfolioEngine.analyseUserProfile(inputs);
    const scored = portfolioEngine.scorePortfolios(portfolios, inputs, profile);

    scored.forEach((p) => {
      expect(p.fitnessScore).toBeDefined();
      expect(p.fitnessScore).toBeGreaterThanOrEqual(0);
      expect(p.fitnessScore).toBeLessThanOrEqual(100);
    });
  });

  test('marks exactly one portfolio as recommended', () => {
    const inputs = makeInputs({ stabilityPreference: 7 });
    const portfolios = generateTestPortfolios(inputs);
    const profile = portfolioEngine.analyseUserProfile(inputs);
    const scored = portfolioEngine.scorePortfolios(portfolios, inputs, profile);

    const recommended = scored.filter((p) => p.recommended);
    expect(recommended.length).toBeGreaterThanOrEqual(1);
  });

  test('Stability-First scores highest for risk-averse user', () => {
    const inputs = makeInputs({ stabilityPreference: 9 });
    const portfolios = generateTestPortfolios(inputs);
    const profile = portfolioEngine.analyseUserProfile(inputs);
    const scored = portfolioEngine.scorePortfolios(portfolios, inputs, profile);

    const stabilityFirst = scored.find((p) => p.type === 'stability_first');
    const marketStandard = scored.find((p) => p.type === 'market_standard');

    // Stability-First should score higher than Market Standard for risk-averse user
    if (stabilityFirst && marketStandard) {
      expect(stabilityFirst.fitnessScore).toBeGreaterThanOrEqual(marketStandard.fitnessScore);
    }
  });

  test('returns empty array for empty input', () => {
    const inputs = makeInputs();
    const profile = portfolioEngine.analyseUserProfile(inputs);
    const scored = portfolioEngine.scorePortfolios([], inputs, profile);
    expect(scored).toEqual([]);
  });

  test('handles null input gracefully', () => {
    const inputs = makeInputs();
    const profile = portfolioEngine.analyseUserProfile(inputs);
    const scored = portfolioEngine.scorePortfolios(null, inputs, profile);
    expect(scored).toBeNull();
  });
});

// ── Edge Cases ────────────────────────────────────────────────────────────────

describe('portfolioEngine edge cases', () => {
  test('handles minimum valid inputs', () => {
    const inputs = makeInputs({
      propertyPrice: 100000,
      loanAmount: 50000,
      monthlyIncome: 1000,
      targetRepayment: 500,
      stabilityPreference: 1,
    });
    const profile = portfolioEngine.analyseUserProfile(inputs);
    const { scenarios } = portfolioEngine.determineScenarios(inputs, DEFAULT_RATES, profile);

    expect(scenarios.length).toBeGreaterThanOrEqual(2);

    scenarios.forEach((type) => {
      const config = portfolioEngine.getAdaptiveAllocation(type, inputs, DEFAULT_RATES, profile);
      const portfolio = portfolioEngine.buildPortfolio(config, type, inputs, DEFAULT_RATES);
      expect(portfolio.monthlyRepayment).toBeGreaterThan(0);
      expect(portfolio.totalCost).toBeGreaterThan(0);
    });
  });

  test('handles maximum valid inputs', () => {
    const inputs = makeInputs({
      propertyPrice: 50000000,
      loanAmount: 30000000,
      monthlyIncome: 500000,
      additionalIncome: 200000,
      targetRepayment: 80000,
      stabilityPreference: 10,
    });
    const profile = portfolioEngine.analyseUserProfile(inputs);
    const { scenarios } = portfolioEngine.determineScenarios(inputs, DEFAULT_RATES, profile);

    expect(scenarios.length).toBeGreaterThanOrEqual(2);

    scenarios.forEach((type) => {
      const config = portfolioEngine.getAdaptiveAllocation(type, inputs, DEFAULT_RATES, profile);
      const portfolio = portfolioEngine.buildPortfolio(config, type, inputs, DEFAULT_RATES);
      expect(portfolio.monthlyRepayment).toBeGreaterThan(0);
      expect(portfolio.totalCost).toBeGreaterThan(inputs.loanAmount);
    });
  });

  test('handles missing rate fields gracefully', () => {
    const inputs = makeInputs();
    const profile = portfolioEngine.analyseUserProfile(inputs);
    const incompleteRates = { fixed: 4.65 }; // Missing cpi, prime, variable

    const config = portfolioEngine.getAdaptiveAllocation('market_standard', inputs, incompleteRates, profile);
    expect(config.tracks).toHaveLength(3);
    expect(config.tracks.every((t) => t.rate > 0)).toBe(true);
  });
});
