/**
 * Portfolio Engine – Advanced Mortgage Portfolio Calculation & Scoring
 *
 * This module provides the core calculation engine for generating and
 * evaluating mortgage portfolio scenarios. It is used by wizardService.js
 * to produce the 4 strategic scenarios.
 *
 * Responsibilities:
 *   - Analyse user profile (risk tolerance, affordability, LTV classification)
 *   - Determine which scenarios to generate based on conditional logic
 *   - Build adaptive track allocations that respond to user preferences
 *   - Calculate financial metrics (PMT, total cost, interest savings)
 *   - Score and rank portfolios by fitness for the user's profile
 *
 * Conditional Logic Summary:
 *   1. Market Standard (30y) – ALWAYS generated. Balanced mix.
 *   2. Fast Track (20y) – ALWAYS generated. Shorter term, interest savings.
 *   3. Inflation-Proof – CONDITIONAL:
 *      - Generated when CPI rate >= 2.5% (high inflation environment)
 *      - OR when user has moderate-to-high stability preference (4-8)
 *      - OR when user expects future funds (can prepay CPI-free tracks)
 *   4. Stability-First – CONDITIONAL:
 *      - Generated when stabilityPreference >= 7
 *      - OR when income-to-repayment ratio is tight (> 35% of income)
 *        AND stability preference >= 5
 *
 * @module portfolioEngine
 */

'use strict';

const logger = require('../utils/logger');

// ── Constants ─────────────────────────────────────────────────────────────────

/** Portfolio scenario type identifiers */
const SCENARIO_TYPES = Object.freeze({
  MARKET_STANDARD: 'market_standard',
  FAST_TRACK: 'fast_track',
  INFLATION_PROOF: 'inflation_proof',
  STABILITY_FIRST: 'stability_first',
});

/** Hebrew names for each scenario */
const SCENARIO_NAMES_HE = Object.freeze({
  [SCENARIO_TYPES.MARKET_STANDARD]: 'תיק שוק סטנדרטי',
  [SCENARIO_TYPES.FAST_TRACK]: 'מסלול מהיר',
  [SCENARIO_TYPES.INFLATION_PROOF]: 'חסין אינפלציה',
  [SCENARIO_TYPES.STABILITY_FIRST]: 'יציבות קודם',
});

/** English names for each scenario */
const SCENARIO_NAMES_EN = Object.freeze({
  [SCENARIO_TYPES.MARKET_STANDARD]: 'Market Standard',
  [SCENARIO_TYPES.FAST_TRACK]: 'Fast Track',
  [SCENARIO_TYPES.INFLATION_PROOF]: 'Inflation-Proof',
  [SCENARIO_TYPES.STABILITY_FIRST]: 'Stability-First',
});

/** Descriptions (Hebrew) */
const SCENARIO_DESCRIPTIONS = Object.freeze({
  [SCENARIO_TYPES.MARKET_STANDARD]: '30 שנה – תמהיל מאוזן להחזר חודשי נמוך',
  [SCENARIO_TYPES.FAST_TRACK]: '20 שנה – חיסכון משמעותי בריבית',
  [SCENARIO_TYPES.INFLATION_PROOF]: 'מסלולים לא צמודים בלבד – הגנה מפני עליית מדד',
  [SCENARIO_TYPES.STABILITY_FIRST]: 'דגש על ריבית קבועה – החזר חודשי צפוי ויציב',
});

/** Track type labels (Hebrew) */
const TRACK_LABELS_HE = Object.freeze({
  fixed: 'קבועה לא צמודה (קל"צ)',
  cpi: 'צמוד מדד',
  prime: 'פריים',
  variable: 'משתנה לא צמודה',
});

/** Stability preference threshold for Stability-First scenario */
const STABILITY_THRESHOLD = 7;

/** CPI rate threshold above which Inflation-Proof is recommended */
const CPI_RATE_THRESHOLD = 2.5;

/** Maximum recommended repayment-to-income ratio */
const MAX_REPAYMENT_RATIO = 0.40;

/** Tight repayment-to-income ratio threshold */
const TIGHT_REPAYMENT_RATIO = 0.35;

/** LTV thresholds for risk classification */
const LTV_THRESHOLDS = Object.freeze({
  LOW: 50,      // <= 50% LTV = low risk
  MODERATE: 60, // <= 60% LTV = moderate risk
  HIGH: 75,     // <= 75% LTV = high risk (Israeli regulatory max for most cases)
});

// ── User Profile Analysis ─────────────────────────────────────────────────────

/**
 * Analyse the user's financial profile to derive risk indicators
 * and preference signals used for conditional portfolio generation.
 *
 * @param {object} inputs - Validated wizard inputs
 * @param {number} inputs.propertyPrice - Property purchase price (₪)
 * @param {number} inputs.loanAmount - Requested loan amount (₪)
 * @param {number} inputs.monthlyIncome - Primary monthly income (₪)
 * @param {number} [inputs.additionalIncome=0] - Additional monthly income (₪)
 * @param {number} inputs.targetRepayment - Desired monthly repayment (₪)
 * @param {object} inputs.futureFunds - Future funds info { timeframe, amount }
 * @param {number} inputs.stabilityPreference - Stability slider value (1-10)
 * @returns {object} User profile analysis
 */
function analyseUserProfile(inputs) {
  const totalIncome = inputs.monthlyIncome + (inputs.additionalIncome || 0);
  const ltv = (inputs.loanAmount / inputs.propertyPrice) * 100;
  const equity = inputs.propertyPrice - inputs.loanAmount;
  const repaymentRatio = inputs.targetRepayment / totalIncome;

  // LTV classification
  let ltvClass;
  if (ltv <= LTV_THRESHOLDS.LOW) {
    ltvClass = 'low';
  } else if (ltv <= LTV_THRESHOLDS.MODERATE) {
    ltvClass = 'moderate';
  } else if (ltv <= LTV_THRESHOLDS.HIGH) {
    ltvClass = 'high';
  } else {
    ltvClass = 'very_high';
  }

  // Affordability classification
  let affordability;
  if (repaymentRatio <= 0.25) {
    affordability = 'comfortable';
  } else if (repaymentRatio <= TIGHT_REPAYMENT_RATIO) {
    affordability = 'moderate';
  } else if (repaymentRatio <= MAX_REPAYMENT_RATIO) {
    affordability = 'tight';
  } else {
    affordability = 'stretched';
  }

  // Risk tolerance derived from stability preference
  // 1-3 = risk_tolerant, 4-6 = balanced, 7-10 = risk_averse
  let riskTolerance;
  if (inputs.stabilityPreference <= 3) {
    riskTolerance = 'risk_tolerant';
  } else if (inputs.stabilityPreference <= 6) {
    riskTolerance = 'balanced';
  } else {
    riskTolerance = 'risk_averse';
  }

  // Future funds analysis
  const hasFutureFunds = inputs.futureFunds.timeframe !== 'none';
  const futureFundsAmount = hasFutureFunds ? (inputs.futureFunds.amount || 0) : 0;
  const futureFundsNearTerm = ['within_5_years'].includes(inputs.futureFunds.timeframe);
  const futureFundsMidTerm = ['within_5_years', 'within_10_years'].includes(inputs.futureFunds.timeframe);

  // Can the user benefit from early prepayment strategies?
  const canPrepayEarly = hasFutureFunds && futureFundsNearTerm && futureFundsAmount > 0;

  // Is the user's target repayment achievable with a 30-year term?
  // (rough estimate: loan / 360 months as minimum possible payment)
  const minMonthlyEstimate = inputs.loanAmount / 360;
  const targetAchievable = inputs.targetRepayment >= minMonthlyEstimate;

  return {
    totalIncome,
    ltv: Math.round(ltv * 100) / 100,
    ltvClass,
    equity,
    repaymentRatio: Math.round(repaymentRatio * 1000) / 1000,
    affordability,
    riskTolerance,
    stabilityPreference: inputs.stabilityPreference,
    hasFutureFunds,
    futureFundsAmount,
    futureFundsNearTerm,
    futureFundsMidTerm,
    canPrepayEarly,
    targetAchievable,
  };
}

// ── Scenario Selection (Conditional Logic) ────────────────────────────────────

/**
 * Determine which portfolio scenarios to generate based on user inputs,
 * current rates, and derived profile analysis.
 *
 * Always includes: Market Standard, Fast Track
 *
 * Conditionally includes:
 *   - Inflation-Proof: when CPI rate is above threshold, OR user has
 *     moderate stability preference (4-8), OR user expects future funds
 *     (non-indexed tracks are easier to prepay without penalty)
 *   - Stability-First: when stability preference >= 7, OR when the
 *     repayment-to-income ratio is tight (> 35%) AND stability >= 5
 *     (tight budgets benefit from predictable payments)
 *
 * @param {object} inputs - Wizard inputs
 * @param {object} rates - Current BOI average rates { fixed, cpi, prime, variable }
 * @param {object} profile - User profile analysis from analyseUserProfile()
 * @returns {{ scenarios: string[], reasons: object }} Scenarios to generate with reasons
 */
function determineScenarios(inputs, rates, profile) {
  const scenarios = [
    SCENARIO_TYPES.MARKET_STANDARD,
    SCENARIO_TYPES.FAST_TRACK,
  ];

  const reasons = {
    [SCENARIO_TYPES.MARKET_STANDARD]: 'Always included – balanced baseline portfolio',
    [SCENARIO_TYPES.FAST_TRACK]: 'Always included – shorter term for interest savings',
  };

  // ── Inflation-Proof Conditional Logic ──────────────────────────────────────
  const cpiRate = rates.cpi || 3.15;
  const inflationReasons = [];

  // Condition 1: High CPI environment
  if (cpiRate >= CPI_RATE_THRESHOLD) {
    inflationReasons.push(`CPI rate (${cpiRate}%) >= ${CPI_RATE_THRESHOLD}% threshold`);
  }

  // Condition 2: Moderate-to-high stability preference (users who want some
  // protection but aren't fully risk-averse)
  if (inputs.stabilityPreference >= 4 && inputs.stabilityPreference <= 8) {
    inflationReasons.push(`Stability preference (${inputs.stabilityPreference}/10) in moderate-high range`);
  }

  // Condition 3: User expects future funds – non-indexed tracks are easier
  // to prepay without CPI linkage penalties
  if (profile.hasFutureFunds && profile.futureFundsMidTerm) {
    inflationReasons.push('Future funds expected – non-indexed tracks easier to prepay');
  }

  // Condition 4: High LTV – CPI-indexed tracks add inflation risk on top
  // of already high leverage
  if (profile.ltvClass === 'high' || profile.ltvClass === 'very_high') {
    inflationReasons.push(`High LTV (${profile.ltv.toFixed(1)}%) – reducing CPI exposure recommended`);
  }

  if (inflationReasons.length > 0) {
    scenarios.push(SCENARIO_TYPES.INFLATION_PROOF);
    reasons[SCENARIO_TYPES.INFLATION_PROOF] = inflationReasons.join('; ');
  }

  // ── Stability-First Conditional Logic ──────────────────────────────────────
  const stabilityReasons = [];

  // Condition 1: High stability preference (primary trigger)
  if (inputs.stabilityPreference >= STABILITY_THRESHOLD) {
    stabilityReasons.push(`Stability preference (${inputs.stabilityPreference}/10) >= ${STABILITY_THRESHOLD} threshold`);
  }

  // Condition 2: Tight budget + moderate stability preference
  // When the repayment-to-income ratio is tight, predictable payments
  // are more important even if the user didn't explicitly request max stability
  if (
    (profile.affordability === 'tight' || profile.affordability === 'stretched') &&
    inputs.stabilityPreference >= 5
  ) {
    stabilityReasons.push(
      `Tight affordability (${(profile.repaymentRatio * 100).toFixed(1)}% of income) with stability preference >= 5`
    );
  }

  // Condition 3: No future funds + risk-averse profile
  // Without future funds to fall back on, fixed rates provide safety
  if (!profile.hasFutureFunds && profile.riskTolerance === 'risk_averse') {
    stabilityReasons.push('No future funds expected with risk-averse profile');
  }

  if (stabilityReasons.length > 0) {
    scenarios.push(SCENARIO_TYPES.STABILITY_FIRST);
    reasons[SCENARIO_TYPES.STABILITY_FIRST] = stabilityReasons.join('; ');
  }

  return { scenarios, reasons };
}

// ── Adaptive Track Allocation ─────────────────────────────────────────────────

/**
 * Get adaptive track allocation for a scenario, adjusted based on
 * the user's profile. This goes beyond static percentages by
 * shifting allocations based on LTV, affordability, future funds,
 * and stability preference.
 *
 * @param {string} scenarioType - Scenario type identifier
 * @param {object} inputs - Wizard inputs
 * @param {object} rates - Current BOI average rates
 * @param {object} profile - User profile analysis
 * @returns {{ termYears: number, tracks: Array<object> }}
 */
function getAdaptiveAllocation(scenarioType, inputs, rates, profile) {
  const fixedRate = rates.fixed || 4.65;
  const cpiRate = rates.cpi || 3.15;
  const primeRate = rates.prime || 6.05;
  const variableRate = rates.variable || 4.95;

  switch (scenarioType) {
    case SCENARIO_TYPES.MARKET_STANDARD:
      return buildMarketStandard(fixedRate, cpiRate, primeRate, profile);

    case SCENARIO_TYPES.FAST_TRACK:
      return buildFastTrack(fixedRate, primeRate, variableRate, profile);

    case SCENARIO_TYPES.INFLATION_PROOF:
      return buildInflationProof(fixedRate, primeRate, variableRate, profile);

    case SCENARIO_TYPES.STABILITY_FIRST:
      return buildStabilityFirst(fixedRate, cpiRate, primeRate, profile);

    default:
      logger.warn(`portfolioEngine.getAdaptiveAllocation: unknown scenario '${scenarioType}'`);
      return buildMarketStandard(fixedRate, cpiRate, primeRate, profile);
  }
}

/**
 * Market Standard (30 years) – Balanced mix for lowest monthly repayment.
 *
 * Adaptive adjustments:
 * - Higher stability preference → more fixed, less prime
 * - Tight affordability → more prime (lower initial rate)
 * - High LTV → more fixed for safety
 */
function buildMarketStandard(fixedRate, cpiRate, primeRate, profile) {
  let fixedPct = 34;
  let primePct = 33;
  let cpiPct = 33;

  // Adjust for stability preference
  if (profile.stabilityPreference >= 7) {
    fixedPct += 8;  // 42%
    primePct -= 5;  // 28%
    cpiPct -= 3;    // 30%
  } else if (profile.stabilityPreference <= 3) {
    fixedPct -= 6;  // 28%
    primePct += 6;  // 39%
    // cpiPct stays 33%
  }

  // Adjust for affordability – tight budgets benefit from lower initial prime rates
  if (profile.affordability === 'tight' || profile.affordability === 'stretched') {
    primePct += 5;
    fixedPct -= 5;
  }

  // Adjust for high LTV – more fixed for safety
  if (profile.ltvClass === 'high' || profile.ltvClass === 'very_high') {
    fixedPct += 4;
    primePct -= 4;
  }

  // Normalize to 100%
  const total = fixedPct + primePct + cpiPct;
  fixedPct = Math.round((fixedPct / total) * 100);
  primePct = Math.round((primePct / total) * 100);
  cpiPct = 100 - fixedPct - primePct;

  return {
    termYears: 30,
    tracks: [
      { type: 'fixed', percentage: fixedPct, rate: fixedRate + 0.1, rateDisplay: `${(fixedRate + 0.1).toFixed(2)}%` },
      { type: 'prime', percentage: primePct, rate: primeRate - 0.15, rateDisplay: 'P-0.15%' },
      { type: 'cpi', percentage: cpiPct, rate: cpiRate + 0.05, rateDisplay: `${(cpiRate + 0.05).toFixed(2)}% + מדד` },
    ],
  };
}

/**
 * Fast Track (20 years) – Shorter term for massive interest savings.
 *
 * Adaptive adjustments:
 * - Future funds near-term → more prime (can prepay when funds arrive)
 * - Risk-tolerant → more variable for lower rates
 * - Risk-averse → more fixed even in fast track
 */
function buildFastTrack(fixedRate, primeRate, variableRate, profile) {
  let primePct = 40;
  let fixedPct = 30;
  let variablePct = 30;

  // Future funds near-term: more prime (easy to prepay)
  if (profile.canPrepayEarly) {
    primePct += 8;  // 48%
    fixedPct -= 4;  // 26%
    variablePct -= 4; // 26%
  }

  // Risk-tolerant users: more variable for lower rates
  if (profile.riskTolerance === 'risk_tolerant') {
    variablePct += 8;
    fixedPct -= 8;
  }

  // Risk-averse users: more fixed even in fast track
  if (profile.riskTolerance === 'risk_averse') {
    fixedPct += 10;
    primePct -= 5;
    variablePct -= 5;
  }

  // Normalize to 100%
  const total = primePct + fixedPct + variablePct;
  primePct = Math.round((primePct / total) * 100);
  fixedPct = Math.round((fixedPct / total) * 100);
  variablePct = 100 - primePct - fixedPct;

  return {
    termYears: 20,
    tracks: [
      { type: 'prime', percentage: primePct, rate: primeRate - 0.2, rateDisplay: 'P-0.2%' },
      { type: 'fixed', percentage: fixedPct, rate: fixedRate + 0.05, rateDisplay: `${(fixedRate + 0.05).toFixed(2)}%` },
      { type: 'variable', percentage: variablePct, rate: variableRate, rateDisplay: `${variableRate.toFixed(2)}%` },
    ],
  };
}

/**
 * Inflation-Proof – Strictly non-indexed tracks (no CPI).
 *
 * Adaptive adjustments:
 * - Term adjusted by stability preference (higher pref → shorter term)
 * - Future funds → more prime (prepayable)
 * - High stability → more fixed within the non-indexed universe
 * - Risk-tolerant → more variable for lower rates
 */
function buildInflationProof(fixedRate, primeRate, variableRate, profile) {
  // Term: 25 years for moderate stability, 30 for low, 22 for high
  let termYears;
  if (profile.stabilityPreference >= 7) {
    termYears = 22;
  } else if (profile.stabilityPreference >= 5) {
    termYears = 25;
  } else {
    termYears = 30;
  }

  let fixedPct = 40;
  let primePct = 35;
  let variablePct = 25;

  // High stability → more fixed
  if (profile.stabilityPreference >= 7) {
    fixedPct += 10; // 50%
    primePct -= 5;  // 30%
    variablePct -= 5; // 20%
  }

  // Risk-tolerant → more variable
  if (profile.riskTolerance === 'risk_tolerant') {
    variablePct += 10;
    fixedPct -= 10;
  }

  // Future funds near-term → more prime (easy to prepay)
  if (profile.canPrepayEarly) {
    primePct += 8;
    fixedPct -= 4;
    variablePct -= 4;
  }

  // Comfortable affordability → can handle shorter term
  if (profile.affordability === 'comfortable' && termYears > 22) {
    termYears = Math.max(22, termYears - 3);
  }

  // Normalize to 100%
  const total = fixedPct + primePct + variablePct;
  fixedPct = Math.round((fixedPct / total) * 100);
  primePct = Math.round((primePct / total) * 100);
  variablePct = 100 - fixedPct - primePct;

  return {
    termYears,
    tracks: [
      { type: 'fixed', percentage: fixedPct, rate: fixedRate + 0.15, rateDisplay: `${(fixedRate + 0.15).toFixed(2)}%` },
      { type: 'prime', percentage: primePct, rate: primeRate - 0.1, rateDisplay: 'P-0.1%' },
      { type: 'variable', percentage: variablePct, rate: variableRate + 0.05, rateDisplay: `${(variableRate + 0.05).toFixed(2)}%` },
    ],
  };
}

/**
 * Stability-First – Heavy fixed-rate allocation (>= 60%).
 *
 * Adaptive adjustments:
 * - Very high stability (9-10) → up to 70% fixed
 * - Tight affordability → longer term (30y) for lower payments
 * - Future funds → some CPI allowed (can prepay if inflation rises)
 * - Comfortable affordability → shorter term (22-25y)
 */
function buildStabilityFirst(fixedRate, cpiRate, primeRate, profile) {
  // Term: 25 default, 30 for tight budgets, 22 for comfortable
  let termYears = 25;
  if (profile.affordability === 'tight' || profile.affordability === 'stretched') {
    termYears = 30;
  } else if (profile.affordability === 'comfortable') {
    termYears = 22;
  }

  let fixedPct = 60;
  let cpiPct = 25;
  let primePct = 15;

  // Very high stability preference → even more fixed
  if (profile.stabilityPreference >= 9) {
    fixedPct = 70;
    cpiPct = 20;
    primePct = 10;
  } else if (profile.stabilityPreference >= 8) {
    fixedPct = 65;
    cpiPct = 22;
    primePct = 13;
  }

  // Future funds → can tolerate slightly more prime (prepayable)
  if (profile.hasFutureFunds && profile.futureFundsMidTerm) {
    primePct += 5;
    cpiPct -= 5;
  }

  // Normalize to 100%
  const total = fixedPct + cpiPct + primePct;
  fixedPct = Math.round((fixedPct / total) * 100);
  cpiPct = Math.round((cpiPct / total) * 100);
  primePct = 100 - fixedPct - cpiPct;

  return {
    termYears,
    tracks: [
      { type: 'fixed', percentage: fixedPct, rate: fixedRate + 0.2, rateDisplay: `${(fixedRate + 0.2).toFixed(2)}%` },
      { type: 'cpi', percentage: cpiPct, rate: cpiRate + 0.1, rateDisplay: `${(cpiRate + 0.1).toFixed(2)}% + מדד` },
      { type: 'prime', percentage: primePct, rate: primeRate - 0.1, rateDisplay: 'P-0.1%' },
    ],
  };
}

// ── Financial Calculations ────────────────────────────────────────────────────

/**
 * Calculate monthly payment using the standard PMT (amortization) formula.
 *
 * PMT = P × [r(1+r)^n] / [(1+r)^n − 1]
 *
 * @param {number} principal - Loan principal amount
 * @param {number} monthlyRate - Monthly interest rate (decimal)
 * @param {number} totalMonths - Total number of monthly payments
 * @returns {number} Monthly payment amount
 */
function calculatePMT(principal, monthlyRate, totalMonths) {
  if (principal <= 0) return 0;
  if (monthlyRate <= 0) return principal / totalMonths;
  if (totalMonths <= 0) return 0;

  const factor = Math.pow(1 + monthlyRate, totalMonths);
  return principal * (monthlyRate * factor) / (factor - 1);
}

/**
 * Calculate a baseline monthly payment for a standard 30-year mixed portfolio.
 * Used to compute interest savings for alternative scenarios.
 *
 * @param {number} loanAmount - Total loan amount
 * @param {object} rates - Current BOI average rates
 * @param {number} termYears - Loan term in years
 * @returns {number} Baseline monthly payment
 */
function calculateBaselineMonthlyPayment(loanAmount, rates, termYears) {
  const totalMonths = termYears * 12;
  const fixedRate = (rates.fixed || 4.65) / 100 / 12;
  const primeRate = (rates.prime || 6.05) / 100 / 12;
  const cpiRate = (rates.cpi || 3.15) / 100 / 12;

  // Standard 34/33/33 split
  const fixedPayment = calculatePMT(loanAmount * 0.34, fixedRate, totalMonths);
  const primePayment = calculatePMT(loanAmount * 0.33, primeRate, totalMonths);
  const cpiPayment = calculatePMT(loanAmount * 0.33, cpiRate, totalMonths);

  return fixedPayment + primePayment + cpiPayment;
}

// ── Portfolio Building ────────────────────────────────────────────────────────

/**
 * Build a complete portfolio object from a track configuration.
 *
 * Calculates monthly repayment, total cost, and total interest
 * using standard amortization (PMT) formula for each track,
 * then aggregates across all tracks.
 *
 * @param {object} config - Track configuration { termYears, tracks }
 * @param {string} scenarioType - Scenario type identifier
 * @param {object} inputs - Wizard inputs
 * @param {object} rates - Current BOI average rates
 * @param {string} [generationMethod='rule_based'] - How the portfolio was generated
 * @returns {object} Complete portfolio object
 */
function buildPortfolio(config, scenarioType, inputs, rates, generationMethod) {
  const method = generationMethod || 'rule_based';
  const { termYears, tracks } = config;
  const loanAmount = inputs.loanAmount;
  const totalMonths = termYears * 12;

  let totalMonthlyRepayment = 0;
  let totalCost = 0;

  const enrichedTracks = tracks.map((track) => {
    const trackAmount = loanAmount * (track.percentage / 100);
    const monthlyRate = track.rate / 100 / 12;
    const monthlyPayment = calculatePMT(trackAmount, monthlyRate, totalMonths);
    const trackTotalCost = monthlyPayment * totalMonths;
    const trackInterest = trackTotalCost - trackAmount;

    totalMonthlyRepayment += monthlyPayment;
    totalCost += trackTotalCost;

    return {
      name: TRACK_LABELS_HE[track.type] || track.type,
      nameEn: track.type,
      type: track.type,
      percentage: track.percentage,
      rate: track.rate,
      rateDisplay: track.rateDisplay || `${track.rate.toFixed(2)}%`,
      amount: Math.round(trackAmount),
      monthlyPayment: Math.round(monthlyPayment),
      totalCost: Math.round(trackTotalCost),
      totalInterest: Math.round(trackInterest),
    };
  });

  totalMonthlyRepayment = Math.round(totalMonthlyRepayment);
  totalCost = Math.round(totalCost);
  const totalInterest = totalCost - loanAmount;

  // Calculate interest savings compared to Market Standard 30-year baseline
  const baselineMonthly = calculateBaselineMonthlyPayment(loanAmount, rates, 30);
  const baselineTotalCost = Math.round(baselineMonthly * 30 * 12);
  const interestSavings = scenarioType !== SCENARIO_TYPES.MARKET_STANDARD
    ? Math.max(0, baselineTotalCost - totalCost)
    : 0;

  return {
    id: scenarioType,
    type: scenarioType,
    name: SCENARIO_NAMES_EN[scenarioType] || scenarioType,
    nameHe: SCENARIO_NAMES_HE[scenarioType] || scenarioType,
    description: SCENARIO_DESCRIPTIONS[scenarioType] || '',
    termYears,
    tracks: enrichedTracks,
    monthlyRepayment: totalMonthlyRepayment,
    totalCost,
    totalInterest: Math.max(0, totalInterest),
    interestSavings,
    recommended: false, // Set by scorePortfolios()
    _generationMethod: method,
  };
}

/**
 * Enrich an AI-generated portfolio with standard fields and recalculated values.
 *
 * @param {object} aiPortfolio - Raw AI-generated portfolio
 * @param {string} scenarioType - Scenario type identifier
 * @param {object} inputs - Wizard inputs
 * @param {object} rates - Current BOI average rates
 * @returns {object} Enriched portfolio
 */
function enrichPortfolio(aiPortfolio, scenarioType, inputs, rates) {
  const termYears = aiPortfolio.termYears || 30;
  const loanAmount = inputs.loanAmount;
  const totalMonths = termYears * 12;

  let totalMonthlyRepayment = 0;
  let totalCost = 0;

  const enrichedTracks = (aiPortfolio.tracks || []).map((track) => {
    const trackAmount = loanAmount * (track.percentage / 100);
    const monthlyRate = track.rate / 100 / 12;
    const monthlyPayment = calculatePMT(trackAmount, monthlyRate, totalMonths);
    const trackTotalCost = monthlyPayment * totalMonths;
    const trackInterest = trackTotalCost - trackAmount;

    totalMonthlyRepayment += monthlyPayment;
    totalCost += trackTotalCost;

    return {
      name: TRACK_LABELS_HE[track.type] || track.type,
      nameEn: track.type,
      type: track.type,
      percentage: track.percentage,
      rate: track.rate,
      rateDisplay: track.rateDisplay || `${track.rate.toFixed(2)}%`,
      amount: Math.round(trackAmount),
      monthlyPayment: Math.round(monthlyPayment),
      totalCost: Math.round(trackTotalCost),
      totalInterest: Math.round(trackInterest),
    };
  });

  totalMonthlyRepayment = Math.round(totalMonthlyRepayment);
  totalCost = Math.round(totalCost);
  const totalInterest = totalCost - loanAmount;

  const baselineMonthly = calculateBaselineMonthlyPayment(loanAmount, rates, 30);
  const baselineTotalCost = Math.round(baselineMonthly * 30 * 12);
  const interestSavings = scenarioType !== SCENARIO_TYPES.MARKET_STANDARD
    ? Math.max(0, baselineTotalCost - totalCost)
    : 0;

  return {
    id: scenarioType,
    type: scenarioType,
    name: SCENARIO_NAMES_EN[scenarioType] || scenarioType,
    nameHe: SCENARIO_NAMES_HE[scenarioType] || scenarioType,
    description: SCENARIO_DESCRIPTIONS[scenarioType] || '',
    termYears,
    tracks: enrichedTracks,
    monthlyRepayment: totalMonthlyRepayment,
    totalCost,
    totalInterest: Math.max(0, totalInterest),
    interestSavings,
    recommended: false,
    _generationMethod: 'ai',
  };
}

// ── Portfolio Scoring & Ranking ───────────────────────────────────────────────

/**
 * Score and rank portfolios based on how well they fit the user's profile.
 *
 * Scoring criteria (weighted):
 *   - Repayment proximity to target (30%): How close is the monthly
 *     repayment to the user's target?
 *   - Stability match (25%): Does the portfolio's fixed-rate allocation
 *     match the user's stability preference?
 *   - Interest efficiency (20%): Lower total interest = better
 *   - Future funds alignment (15%): Does the portfolio work well with
 *     expected future funds?
 *   - Affordability safety (10%): Is the repayment within safe income ratio?
 *
 * @param {Array<object>} portfolios - Generated portfolios
 * @param {object} inputs - Wizard inputs
 * @param {object} profile - User profile analysis
 * @returns {Array<object>} Portfolios with fitnessScore and recommended flag
 */
function scorePortfolios(portfolios, inputs, profile) {
  if (!portfolios || portfolios.length === 0) return portfolios;

  const scored = portfolios.map((portfolio) => {
    const scores = {};

    // 1. Repayment proximity to target (30%)
    const repaymentDiff = Math.abs(portfolio.monthlyRepayment - inputs.targetRepayment);
    const repaymentRange = inputs.targetRepayment * 0.5; // 50% tolerance
    scores.repaymentProximity = Math.max(0, 1 - (repaymentDiff / repaymentRange));

    // 2. Stability match (25%)
    const fixedAllocation = portfolio.tracks
      .filter((t) => t.type === 'fixed')
      .reduce((sum, t) => sum + t.percentage, 0);
    // Map stability preference 1-10 to expected fixed allocation 10%-70%
    const expectedFixed = 10 + (inputs.stabilityPreference - 1) * (60 / 9);
    const fixedDiff = Math.abs(fixedAllocation - expectedFixed);
    scores.stabilityMatch = Math.max(0, 1 - (fixedDiff / 50));

    // 3. Interest efficiency (20%)
    // Compare to the highest-interest portfolio in the set
    const maxInterest = Math.max(...portfolios.map((p) => p.totalInterest));
    const minInterest = Math.min(...portfolios.map((p) => p.totalInterest));
    const interestRange = maxInterest - minInterest;
    scores.interestEfficiency = interestRange > 0
      ? 1 - ((portfolio.totalInterest - minInterest) / interestRange)
      : 1;

    // 4. Future funds alignment (15%)
    if (profile.hasFutureFunds) {
      // Portfolios with more prime/variable tracks are better for prepayment
      const prepayablePct = portfolio.tracks
        .filter((t) => t.type === 'prime' || t.type === 'variable')
        .reduce((sum, t) => sum + t.percentage, 0);
      scores.futureFundsAlignment = prepayablePct / 100;

      // Shorter terms are better when future funds are expected
      if (profile.futureFundsNearTerm && portfolio.termYears <= 20) {
        scores.futureFundsAlignment = Math.min(1, scores.futureFundsAlignment + 0.2);
      }
    } else {
      // No future funds: neutral score
      scores.futureFundsAlignment = 0.5;
    }

    // 5. Affordability safety (10%)
    const repaymentRatio = portfolio.monthlyRepayment / profile.totalIncome;
    if (repaymentRatio <= 0.30) {
      scores.affordabilitySafety = 1.0;
    } else if (repaymentRatio <= TIGHT_REPAYMENT_RATIO) {
      scores.affordabilitySafety = 0.8;
    } else if (repaymentRatio <= MAX_REPAYMENT_RATIO) {
      scores.affordabilitySafety = 0.5;
    } else {
      scores.affordabilitySafety = 0.2;
    }

    // Weighted total
    const fitnessScore = Math.round((
      scores.repaymentProximity * 0.30 +
      scores.stabilityMatch * 0.25 +
      scores.interestEfficiency * 0.20 +
      scores.futureFundsAlignment * 0.15 +
      scores.affordabilitySafety * 0.10
    ) * 100);

    return {
      ...portfolio,
      fitnessScore,
      scoreBreakdown: scores,
    };
  });

  // Mark the highest-scoring portfolio as recommended
  const maxScore = Math.max(...scored.map((p) => p.fitnessScore));
  return scored.map((p) => ({
    ...p,
    recommended: p.fitnessScore === maxScore,
  }));
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  // User profile analysis
  analyseUserProfile,

  // Scenario selection
  determineScenarios,

  // Track allocation
  getAdaptiveAllocation,

  // Portfolio building
  buildPortfolio,
  enrichPortfolio,

  // Scoring
  scorePortfolios,

  // Financial calculations
  calculatePMT,
  calculateBaselineMonthlyPayment,

  // Internal builders (exported for testing)
  buildMarketStandard,
  buildFastTrack,
  buildInflationProof,
  buildStabilityFirst,

  // Constants
  SCENARIO_TYPES,
  SCENARIO_NAMES_HE,
  SCENARIO_NAMES_EN,
  SCENARIO_DESCRIPTIONS,
  TRACK_LABELS_HE,
  STABILITY_THRESHOLD,
  CPI_RATE_THRESHOLD,
  MAX_REPAYMENT_RATIO,
  TIGHT_REPAYMENT_RATIO,
  LTV_THRESHOLDS,
};
