/**
 * Wizard Service – Portfolio Generation Engine
 *
 * Generates up to 4 distinct mortgage portfolio scenarios based on:
 *   - User wizard inputs (6 steps)
 *   - Bank of Israel current average rates (from ratesService)
 *   - AI-powered optimization (OpenAI GPT-4o-mini)
 *
 * Portfolio Scenarios:
 *   1. "Market Standard" (30 years) – Always generated. Generic mix for lowest monthly repayment.
 *   2. "Fast Track" (20 years) – Always generated. Shorter term for massive interest savings.
 *   3. "Inflation-Proof" (conditional) – Non-indexed tracks only. Generated when CPI rates
 *      are high or user has moderate stability preference.
 *   4. "Stability-First" (conditional) – Fixed-rate heavy. Generated when user's
 *      stabilityPreference >= 7.
 *
 * Each portfolio contains:
 *   - id, name (Hebrew + English), description
 *   - tracks: array of { name, nameHe, type, percentage, rate, termYears }
 *   - monthlyRepayment: average monthly payment (₪)
 *   - totalCost: principal + total interest over full term (₪)
 *   - totalInterest: total interest paid (₪)
 *   - termYears: loan duration
 *
 * The service first attempts AI-powered generation via OpenAI.
 * If OpenAI is unavailable, it falls back to deterministic rule-based generation.
 */

'use strict';

const OpenAI = require('openai');
const ratesService = require('./ratesService');
const logger = require('../utils/logger');

let openai;
if (process.env.OPENAI_API_KEY) {
  openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

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

// ── Main Entry Point ──────────────────────────────────────────────────────────

/**
 * Generate up to 4 mortgage portfolio scenarios for the given wizard inputs.
 *
 * @param {object} inputs - Validated wizard inputs
 * @param {number} inputs.propertyPrice - Property purchase price (₪)
 * @param {number} inputs.loanAmount - Requested loan amount (₪)
 * @param {number} inputs.monthlyIncome - Primary monthly income (₪)
 * @param {number} [inputs.additionalIncome=0] - Additional monthly income (₪)
 * @param {number} inputs.targetRepayment - Desired monthly repayment (₪)
 * @param {object} inputs.futureFunds - Future funds info { timeframe, amount }
 * @param {number} inputs.stabilityPreference - Stability slider value (1-10)
 * @param {boolean} consent - Whether user consented to anonymous data storage
 * @returns {Promise<{portfolios: Array<object>, metadata: object}>}
 */
async function generatePortfolios(inputs, consent) {
  const startTime = Date.now();

  // 1. Fetch current BOI rates
  let rates;
  try {
    rates = await ratesService.getCurrentAverages();
  } catch (err) {
    logger.error(`wizardService.generatePortfolios: failed to get rates: ${err.message}`);
    // Use hardcoded fallback rates
    rates = { fixed: 4.65, cpi: 3.15, prime: 6.05, variable: 4.95 };
  }

  logger.info('wizardService.generatePortfolios: generating portfolios', {
    loanAmount: inputs.loanAmount,
    stabilityPreference: inputs.stabilityPreference,
    rates,
  });

  // 2. Determine which scenarios to generate
  const scenarioTypes = determineScenarios(inputs, rates);

  // 3. Try AI-powered generation first, fall back to rule-based
  let portfolios;
  try {
    portfolios = await generateWithAI(inputs, rates, scenarioTypes);
    logger.info('wizardService.generatePortfolios: AI generation succeeded');
  } catch (err) {
    logger.warn(`wizardService.generatePortfolios: AI generation failed, using rule-based: ${err.message}`);
    portfolios = generateRuleBased(inputs, rates, scenarioTypes);
  }

  const elapsed = Date.now() - startTime;
  logger.info(`wizardService.generatePortfolios: completed in ${elapsed}ms, ${portfolios.length} portfolios`);

  // 4. Build metadata
  const metadata = {
    generatedAt: new Date().toISOString(),
    ratesSource: rates ? 'bank_of_israel' : 'fallback',
    generationMethod: portfolios[0]?._generationMethod || 'rule_based',
    processingTimeMs: elapsed,
    inputSummary: {
      propertyPrice: inputs.propertyPrice,
      loanAmount: inputs.loanAmount,
      ltv: Math.round((inputs.loanAmount / inputs.propertyPrice) * 100),
      stabilityPreference: inputs.stabilityPreference,
      totalIncome: inputs.monthlyIncome + (inputs.additionalIncome || 0),
      targetRepayment: inputs.targetRepayment,
    },
    consent,
  };

  // Strip internal fields from portfolios
  const cleanPortfolios = portfolios.map((p) => {
    const { _generationMethod, ...clean } = p;
    return clean;
  });

  return { portfolios: cleanPortfolios, metadata };
}

// ── Scenario Selection ────────────────────────────────────────────────────────

/**
 * Determine which portfolio scenarios to generate based on user inputs and rates.
 *
 * Always includes: Market Standard, Fast Track
 * Conditionally includes:
 *   - Inflation-Proof: when CPI rate is above threshold OR stability pref is moderate (4-7)
 *   - Stability-First: when stability preference >= 7
 *
 * @param {object} inputs - Wizard inputs
 * @param {object} rates - Current BOI average rates
 * @returns {string[]} Array of scenario type identifiers
 */
function determineScenarios(inputs, rates) {
  const scenarios = [
    SCENARIO_TYPES.MARKET_STANDARD,
    SCENARIO_TYPES.FAST_TRACK,
  ];

  // Inflation-Proof: recommended when CPI rates are high or user has moderate stability preference
  const cpiRate = rates.cpi || 3.15;
  const shouldAddInflationProof =
    cpiRate >= CPI_RATE_THRESHOLD ||
    (inputs.stabilityPreference >= 4 && inputs.stabilityPreference <= 8);

  if (shouldAddInflationProof) {
    scenarios.push(SCENARIO_TYPES.INFLATION_PROOF);
  }

  // Stability-First: recommended when user prefers high stability
  if (inputs.stabilityPreference >= STABILITY_THRESHOLD) {
    scenarios.push(SCENARIO_TYPES.STABILITY_FIRST);
  }

  return scenarios;
}

// ── AI-Powered Generation ─────────────────────────────────────────────────────

/**
 * Generate portfolios using OpenAI GPT-4o-mini.
 *
 * The AI is given the user's inputs, current BOI rates, and instructions
 * to produce specific portfolio scenarios with track breakdowns.
 *
 * @param {object} inputs - Wizard inputs
 * @param {object} rates - Current BOI average rates
 * @param {string[]} scenarioTypes - Which scenarios to generate
 * @returns {Promise<Array<object>>} Generated portfolios
 */
async function generateWithAI(inputs, rates, scenarioTypes) {
  if (!openai) {
    throw new Error('OpenAI client not initialized (OPENAI_API_KEY not set)');
  }

  const totalIncome = inputs.monthlyIncome + (inputs.additionalIncome || 0);
  const ltv = Math.round((inputs.loanAmount / inputs.propertyPrice) * 100);
  const equity = inputs.propertyPrice - inputs.loanAmount;

  const scenarioDescriptions = scenarioTypes.map((type) => {
    switch (type) {
      case SCENARIO_TYPES.MARKET_STANDARD:
        return '"Market Standard" (30 years): A balanced mix of tracks aimed at the lowest possible monthly repayment. Use a mix of fixed, prime, and CPI-indexed tracks.';
      case SCENARIO_TYPES.FAST_TRACK:
        return '"Fast Track" (20 years): A shorter duration aimed at massive interest savings. Favor prime and variable tracks for lower rates.';
      case SCENARIO_TYPES.INFLATION_PROOF:
        return '"Inflation-Proof" (חסין אינפלציה): A portfolio consisting STRICTLY of non-indexed tracks only (fixed/קל"צ, prime/פריים, variable/משתנה). NO CPI-indexed tracks allowed.';
      case SCENARIO_TYPES.STABILITY_FIRST:
        return '"Stability-First" (יציבות קודם): A mix heavily prioritizing fixed rates (קל"צ) for predictable monthly repayment. At least 60% should be fixed-rate.';
      default:
        return '';
    }
  }).filter(Boolean);

  const prompt = `You are an Israeli mortgage portfolio advisor. Generate ${scenarioTypes.length} distinct mortgage portfolio scenarios based on the following user profile and current Bank of Israel rates.

User Profile:
- Property Price: ₪${inputs.propertyPrice.toLocaleString()}
- Loan Amount: ₪${inputs.loanAmount.toLocaleString()}
- Equity: ₪${equity.toLocaleString()} (LTV: ${ltv}%)
- Monthly Income: ₪${totalIncome.toLocaleString()}
- Target Monthly Repayment: ₪${inputs.targetRepayment.toLocaleString()}
- Future Funds: ${inputs.futureFunds.timeframe === 'none' ? 'None expected' : `₪${(inputs.futureFunds.amount || 0).toLocaleString()} expected ${inputs.futureFunds.timeframe.replace(/_/g, ' ')}`}
- Stability Preference: ${inputs.stabilityPreference}/10 (${inputs.stabilityPreference >= 7 ? 'high stability' : inputs.stabilityPreference >= 4 ? 'moderate' : 'flexible/risk-tolerant'})

Current Bank of Israel Average Rates:
- Fixed (קל"צ): ${rates.fixed}%
- CPI-Indexed (צמוד מדד): ${rates.cpi}%
- Prime (פריים): ${rates.prime}% (Prime rate = Bank of Israel base rate + bank spread)
- Variable (משתנה): ${rates.variable}%

Generate these specific scenarios:
${scenarioDescriptions.map((d, i) => `${i + 1}. ${d}`).join('\n')}

For each portfolio, provide:
- Track breakdown: each track with type (fixed/cpi/prime/variable), percentage allocation (must sum to 100%), and the interest rate
- The term in years
- Calculate the approximate monthly repayment using standard amortization
- Calculate total cost (principal + total interest)
- Calculate total interest paid

IMPORTANT:
- All percentages in a portfolio must sum to exactly 100%
- Use realistic rates close to the BOI averages (banks add 0-0.5% spread)
- Monthly repayment calculation should use standard PMT formula
- For prime tracks, express rate as "P-X%" or "P+X%" relative to prime rate

Respond ONLY with valid JSON in this exact format (no markdown, no explanation):
{
  "portfolios": [
    {
      "type": "market_standard",
      "tracks": [
        { "type": "fixed", "percentage": 40, "rate": 4.7, "rateDisplay": "4.70%" },
        { "type": "prime", "percentage": 30, "rate": 5.9, "rateDisplay": "P-0.1%" },
        { "type": "cpi", "percentage": 30, "rate": 3.2, "rateDisplay": "3.20% + מדד" }
      ],
      "termYears": 30,
      "monthlyRepayment": 5200,
      "totalCost": 1872000,
      "totalInterest": 672000
    }
  ]
}`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: 'You are an expert Israeli mortgage advisor. You respond only with valid JSON. All calculations must be mathematically accurate using standard amortization formulas.',
      },
      { role: 'user', content: prompt },
    ],
    max_tokens: 2000,
    temperature: 0.3,
    response_format: { type: 'json_object' },
  });

  const content = response.choices[0].message.content;
  const parsed = JSON.parse(content);

  if (!parsed.portfolios || !Array.isArray(parsed.portfolios)) {
    throw new Error('AI response missing portfolios array');
  }

  // Validate and enrich AI-generated portfolios
  const enriched = parsed.portfolios.map((aiPortfolio, index) => {
    const scenarioType = scenarioTypes[index] || SCENARIO_TYPES.MARKET_STANDARD;
    return enrichPortfolio(aiPortfolio, scenarioType, inputs, rates);
  });

  return enriched;
}

// ── Rule-Based Generation (Fallback) ──────────────────────────────────────────

/**
 * Generate portfolios using deterministic rules when AI is unavailable.
 *
 * Uses standard amortization formulas and predefined track allocations
 * based on the scenario type and user preferences.
 *
 * @param {object} inputs - Wizard inputs
 * @param {object} rates - Current BOI average rates
 * @param {string[]} scenarioTypes - Which scenarios to generate
 * @returns {Array<object>} Generated portfolios
 */
function generateRuleBased(inputs, rates, scenarioTypes) {
  return scenarioTypes.map((type) => {
    const config = getRuleBasedConfig(type, inputs, rates);
    const portfolio = buildPortfolio(config, type, inputs, rates);
    portfolio._generationMethod = 'rule_based';
    return portfolio;
  });
}

/**
 * Get the rule-based track allocation configuration for a scenario type.
 *
 * @param {string} type - Scenario type identifier
 * @param {object} inputs - Wizard inputs
 * @param {object} rates - Current BOI average rates
 * @returns {object} Configuration with tracks and termYears
 */
function getRuleBasedConfig(type, inputs, rates) {
  const fixedRate = rates.fixed || 4.65;
  const cpiRate = rates.cpi || 3.15;
  const primeRate = rates.prime || 6.05;
  const variableRate = rates.variable || 4.95;

  switch (type) {
    case SCENARIO_TYPES.MARKET_STANDARD:
      return {
        termYears: 30,
        tracks: [
          { type: 'fixed', percentage: 34, rate: fixedRate + 0.1, rateDisplay: `${(fixedRate + 0.1).toFixed(2)}%` },
          { type: 'prime', percentage: 33, rate: primeRate - 0.15, rateDisplay: 'P-0.15%' },
          { type: 'cpi', percentage: 33, rate: cpiRate + 0.05, rateDisplay: `${(cpiRate + 0.05).toFixed(2)}% + מדד` },
        ],
      };

    case SCENARIO_TYPES.FAST_TRACK:
      return {
        termYears: 20,
        tracks: [
          { type: 'prime', percentage: 40, rate: primeRate - 0.2, rateDisplay: 'P-0.2%' },
          { type: 'fixed', percentage: 30, rate: fixedRate + 0.05, rateDisplay: `${(fixedRate + 0.05).toFixed(2)}%` },
          { type: 'variable', percentage: 30, rate: variableRate, rateDisplay: `${variableRate.toFixed(2)}%` },
        ],
      };

    case SCENARIO_TYPES.INFLATION_PROOF:
      // Strictly non-indexed tracks only (no CPI)
      return {
        termYears: inputs.stabilityPreference >= 5 ? 25 : 30,
        tracks: [
          { type: 'fixed', percentage: 40, rate: fixedRate + 0.15, rateDisplay: `${(fixedRate + 0.15).toFixed(2)}%` },
          { type: 'prime', percentage: 35, rate: primeRate - 0.1, rateDisplay: 'P-0.1%' },
          { type: 'variable', percentage: 25, rate: variableRate + 0.05, rateDisplay: `${(variableRate + 0.05).toFixed(2)}%` },
        ],
      };

    case SCENARIO_TYPES.STABILITY_FIRST:
      // Heavy fixed-rate allocation (>= 60%)
      return {
        termYears: 25,
        tracks: [
          { type: 'fixed', percentage: 60, rate: fixedRate + 0.2, rateDisplay: `${(fixedRate + 0.2).toFixed(2)}%` },
          { type: 'cpi', percentage: 25, rate: cpiRate + 0.1, rateDisplay: `${(cpiRate + 0.1).toFixed(2)}% + מדד` },
          { type: 'prime', percentage: 15, rate: primeRate - 0.1, rateDisplay: 'P-0.1%' },
        ],
      };

    default:
      logger.warn(`wizardService.getRuleBasedConfig: unknown scenario type '${type}'`);
      return {
        termYears: 30,
        tracks: [
          { type: 'fixed', percentage: 34, rate: fixedRate, rateDisplay: `${fixedRate.toFixed(2)}%` },
          { type: 'prime', percentage: 33, rate: primeRate, rateDisplay: `${primeRate.toFixed(2)}%` },
          { type: 'cpi', percentage: 33, rate: cpiRate, rateDisplay: `${cpiRate.toFixed(2)}% + מדד` },
        ],
      };
  }
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
 * @returns {object} Complete portfolio object
 */
function buildPortfolio(config, scenarioType, inputs, rates) {
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
  // (only meaningful for non-Market-Standard scenarios)
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
    recommended: scenarioType === SCENARIO_TYPES.MARKET_STANDARD,
    _generationMethod: 'rule_based',
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

  // Recalculate financials from AI-provided tracks for accuracy
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
    recommended: scenarioType === SCENARIO_TYPES.MARKET_STANDARD,
    _generationMethod: 'ai',
  };
}

// ── Financial Calculations ────────────────────────────────────────────────────

/**
 * Calculate monthly payment using the standard PMT (amortization) formula.
 *
 * PMT = P * [r(1+r)^n] / [(1+r)^n - 1]
 *
 * Where:
 *   P = principal (loan amount for this track)
 *   r = monthly interest rate (annual rate / 12)
 *   n = total number of monthly payments
 *
 * @param {number} principal - Loan principal amount
 * @param {number} monthlyRate - Monthly interest rate (decimal, e.g., 0.004 for 4.8% annual)
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

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  // Main entry point
  generatePortfolios,

  // Internal helpers (exported for testing)
  determineScenarios,
  generateWithAI,
  generateRuleBased,
  getRuleBasedConfig,
  buildPortfolio,
  enrichPortfolio,
  calculatePMT,
  calculateBaselineMonthlyPayment,

  // Constants (exported for testing and other services)
  SCENARIO_TYPES,
  SCENARIO_NAMES_HE,
  SCENARIO_NAMES_EN,
  SCENARIO_DESCRIPTIONS,
  TRACK_LABELS_HE,
  STABILITY_THRESHOLD,
  CPI_RATE_THRESHOLD,
};
