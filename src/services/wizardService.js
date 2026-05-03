/**
 * Wizard Service – Portfolio Generation Engine
 *
 * Generates up to 4 distinct mortgage portfolio scenarios based on:
 *   - User wizard inputs (6 steps)
 *   - Bank of Israel current average rates (from ratesService)
 *   - AI-powered optimization (OpenAI GPT-4o-mini)
 *   - User profile analysis (LTV, affordability, risk tolerance)
 *
 * Portfolio Scenarios:
 *   1. "Market Standard" (30 years) – Always generated. Generic mix for lowest monthly repayment.
 *   2. "Fast Track" (20 years) – Always generated. Shorter term for massive interest savings.
 *   3. "Inflation-Proof" (conditional) – Non-indexed tracks only. Generated when CPI rates
 *      are high, user has moderate stability preference, expects future funds, or has high LTV.
 *   4. "Stability-First" (conditional) – Fixed-rate heavy. Generated when user's
 *      stabilityPreference >= 7, or tight affordability with moderate stability preference,
 *      or risk-averse profile without future funds.
 *
 * Each portfolio contains:
 *   - id, name (Hebrew + English), description
 *   - tracks: array of { name, nameHe, type, percentage, rate, termYears }
 *   - monthlyRepayment: average monthly payment (₪)
 *   - totalCost: principal + total interest over full term (₪)
 *   - totalInterest: total interest paid (₪)
 *   - termYears: loan duration
 *   - fitnessScore: 0-100 score indicating how well the portfolio fits the user
 *   - recommended: boolean flag for the best-fit portfolio
 *
 * The service first attempts AI-powered generation via OpenAI.
 * If OpenAI is unavailable, it falls back to deterministic rule-based generation
 * using the portfolioEngine module.
 */

'use strict';

const OpenAI = require('openai');
const ratesService = require('./ratesService');
const portfolioEngine = require('./portfolioEngine');
const logger = require('../utils/logger');

let openai;
if (process.env.OPENAI_API_KEY) {
  openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

// Re-export constants from portfolioEngine for backward compatibility
const {
  SCENARIO_TYPES,
  SCENARIO_NAMES_HE,
  SCENARIO_NAMES_EN,
  SCENARIO_DESCRIPTIONS,
  TRACK_LABELS_HE,
  STABILITY_THRESHOLD,
  CPI_RATE_THRESHOLD,
} = portfolioEngine;

// ── Main Entry Point ──────────────────────────────────────────────────────────

/**
 * Generate up to 4 mortgage portfolio scenarios for the given wizard inputs.
 *
 * Flow:
 *   1. Fetch current BOI rates
 *   2. Analyse user profile (LTV, affordability, risk tolerance, future funds)
 *   3. Determine which scenarios to generate (conditional logic)
 *   4. Generate portfolios (AI-first, rule-based fallback)
 *   5. Score and rank portfolios by fitness for user profile
 *   6. Return portfolios with metadata
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

  // 2. Analyze user profile
  const profile = portfolioEngine.analyseUserProfile(inputs);

  logger.info('wizardService.generatePortfolios: generating portfolios', {
    loanAmount: inputs.loanAmount,
    stabilityPreference: inputs.stabilityPreference,
    ltvClass: profile.ltvClass,
    affordability: profile.affordability,
    riskTolerance: profile.riskTolerance,
    hasFutureFunds: profile.hasFutureFunds,
    rates,
  });

  // 3. Determine which scenarios to generate (conditional logic)
  const { scenarios: scenarioTypes, reasons } = portfolioEngine.determineScenarios(
    inputs,
    rates,
    profile
  );

  logger.info('wizardService.generatePortfolios: scenarios determined', {
    scenarioTypes,
    reasons,
  });

  // 4. Try AI-powered generation first, fall back to rule-based
  let portfolios;
  let generationMethod = 'rule_based';
  try {
    portfolios = await generateWithAI(inputs, rates, scenarioTypes, profile);
    generationMethod = 'ai';
    logger.info('wizardService.generatePortfolios: AI generation succeeded');
  } catch (err) {
    logger.warn(`wizardService.generatePortfolios: AI generation failed, using rule-based: ${err.message}`);
    portfolios = generateRuleBased(inputs, rates, scenarioTypes, profile);
  }

  // 5. Score and rank portfolios
  const scoredPortfolios = portfolioEngine.scorePortfolios(portfolios, inputs, profile);

  const elapsed = Date.now() - startTime;
  logger.info(`wizardService.generatePortfolios: completed in ${elapsed}ms, ${scoredPortfolios.length} portfolios`);

  // 6. Build metadata
  const metadata = {
    generatedAt: new Date().toISOString(),
    ratesSource: rates ? 'bank_of_israel' : 'fallback',
    generationMethod,
    processingTimeMs: elapsed,
    scenariosGenerated: scenarioTypes,
    scenarioReasons: reasons,
    inputSummary: {
      propertyPrice: inputs.propertyPrice,
      loanAmount: inputs.loanAmount,
      ltv: Math.round(profile.ltv),
      ltvClass: profile.ltvClass,
      stabilityPreference: inputs.stabilityPreference,
      totalIncome: profile.totalIncome,
      targetRepayment: inputs.targetRepayment,
      repaymentRatio: profile.repaymentRatio,
      affordability: profile.affordability,
      riskTolerance: profile.riskTolerance,
      hasFutureFunds: profile.hasFutureFunds,
      futureFundsTimeframe: inputs.futureFunds.timeframe,
    },
    consent,
  };

  // Strip internal fields from portfolios
  const cleanPortfolios = scoredPortfolios.map((p) => {
    const { _generationMethod, scoreBreakdown, ...clean } = p;
    return clean;
  });

  return { portfolios: cleanPortfolios, metadata };
}

// ── AI-Powered Generation ─────────────────────────────────────────────────────

/**
 * Generate portfolios using OpenAI GPT-4o-mini.
 *
 * The AI is given the user's inputs, current BOI rates, profile analysis,
 * and instructions to produce specific portfolio scenarios with track breakdowns.
 *
 * @param {object} inputs - Wizard inputs
 * @param {object} rates - Current BOI average rates
 * @param {string[]} scenarioTypes - Which scenarios to generate
 * @param {object} profile - User profile analysis
 * @returns {Promise<Array<object>>} Generated portfolios
 */
async function generateWithAI(inputs, rates, scenarioTypes, profile) {
  if (!openai) {
    throw new Error('OpenAI client not initialized (OPENAI_API_KEY not set)');
  }

  const totalIncome = profile.totalIncome;
  const ltv = profile.ltv;
  const equity = profile.equity;

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

  // Build future funds context
  let futureFundsContext;
  if (inputs.futureFunds.timeframe === 'none') {
    futureFundsContext = 'None expected';
  } else {
    const amount = inputs.futureFunds.amount || 0;
    const timeframe = inputs.futureFunds.timeframe;//.replace(/_/g, ' ');
    futureFundsContext = `₪${amount.toLocaleString()} expected ${timeframe}`;
    if (profile.canPrepayEarly) {
      futureFundsContext += ' (near-term – consider prepayable tracks like prime)';
    }
  }

  // Build profile context for AI
  const profileContext = [
    `Risk Tolerance: ${profile.riskTolerance} (stability pref ${inputs.stabilityPreference}/10)`,
    `Affordability: ${profile.affordability} (repayment is ${(profile.repaymentRatio * 100).toFixed(1)}% of income)`,
    `LTV: ${ltv.toFixed(1)}% (${profile.ltvClass})`,
    profile.hasFutureFunds ? 'Has future funds – consider prepayable tracks' : 'No future funds expected',
  ].join('\n');

  const prompt = `You are an Israeli mortgage portfolio advisor. Generate ${scenarioTypes.length} distinct mortgage portfolio scenarios based on the following user profile and current Bank of Israel rates.

User Profile:
- Property Price: ₪${inputs.propertyPrice.toLocaleString()}
- Loan Amount: ₪${inputs.loanAmount.toLocaleString()}
- Equity: ₪${equity.toLocaleString()} (LTV: ${ltv.toFixed(1)}%)
- Monthly Income: ₪${totalIncome.toLocaleString()}
- Target Monthly Repayment: ₪${inputs.targetRepayment.toLocaleString()}
- Future Funds: ${futureFundsContext}
- Stability Preference: ${inputs.stabilityPreference}/10

Profile Analysis:
${profileContext}

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

IMPORTANT RULES:
- All percentages in a portfolio must sum to exactly 100%
- Use realistic rates close to the BOI averages (banks add 0-0.5% spread)
- Monthly repayment calculation should use standard PMT formula
- For prime tracks, express rate as "P-X%" or "P+X%" relative to prime rate
- Adapt allocations to the user's profile: ${profile.riskTolerance} risk tolerance, ${profile.affordability} affordability
- For Inflation-Proof: ONLY use fixed, prime, and variable tracks (NO cpi tracks)
- For Stability-First: At least 60% must be fixed-rate tracks

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
        content: 'You are an expert Israeli mortgage advisor. You respond only with valid JSON. All calculations must be mathematically accurate using standard amortization formulas. Adapt your recommendations to the user\'s risk profile and financial situation.',
      },
      { role: 'user', content: prompt },
    ],
    max_tokens: 2500,
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
    return portfolioEngine.enrichPortfolio(aiPortfolio, scenarioType, inputs, rates);
  });

  // Validate portfolio constraints
  return enriched.map((portfolio) => validatePortfolioConstraints(portfolio));
}

// ── Rule-Based Generation (Fallback) ──────────────────────────────────────────

/**
 * Generate portfolios using deterministic rules when AI is unavailable.
 *
 * Uses the portfolioEngine's adaptive allocation system which adjusts
 * track percentages based on user profile analysis.
 *
 * @param {object} inputs - Wizard inputs
 * @param {object} rates - Current BOI average rates
 * @param {string[]} scenarioTypes - Which scenarios to generate
 * @param {object} profile - User profile analysis
 * @returns {Array<object>} Generated portfolios
 */
function generateRuleBased(inputs, rates, scenarioTypes, profile) {
  return scenarioTypes.map((type) => {
    const config = portfolioEngine.getAdaptiveAllocation(type, inputs, rates, profile);
    const portfolio = portfolioEngine.buildPortfolio(config, type, inputs, rates, 'rule_based');
    return portfolio;
  });
}

// ── Portfolio Validation ──────────────────────────────────────────────────────

/**
 * Validate that a portfolio meets its scenario-specific constraints.
 * Fixes minor issues (e.g., percentages not summing to 100) and logs warnings.
 *
 * @param {object} portfolio - Portfolio to validate
 * @returns {object} Validated (and possibly corrected) portfolio
 */
function validatePortfolioConstraints(portfolio) {
  const tracks = portfolio.tracks || [];

  // Check percentages sum to 100
  const totalPct = tracks.reduce((sum, t) => sum + t.percentage, 0);
  if (totalPct !== 100 && tracks.length > 0) {
    logger.warn(`wizardService.validatePortfolioConstraints: ${portfolio.type} tracks sum to ${totalPct}%, adjusting`);
    // Adjust the last track to make it sum to 100
    const diff = 100 - totalPct;
    tracks[tracks.length - 1].percentage += diff;
  }

  // Inflation-Proof: must not contain CPI tracks
  if (portfolio.type === SCENARIO_TYPES.INFLATION_PROOF) {
    const hasCpi = tracks.some((t) => t.type === 'cpi');
    if (hasCpi) {
      logger.warn('wizardService.validatePortfolioConstraints: Inflation-Proof contains CPI track, removing');
      // Redistribute CPI allocation to fixed and prime
      const cpiTracks = tracks.filter((t) => t.type === 'cpi');
      const cpiPct = cpiTracks.reduce((sum, t) => sum + t.percentage, 0);
      const nonCpiTracks = tracks.filter((t) => t.type !== 'cpi');

      if (nonCpiTracks.length > 0) {
        const addPerTrack = Math.floor(cpiPct / nonCpiTracks.length);
        nonCpiTracks.forEach((t) => { t.percentage += addPerTrack; });
        // Handle remainder
        const remainder = cpiPct - (addPerTrack * nonCpiTracks.length);
        nonCpiTracks[0].percentage += remainder;
        portfolio.tracks = nonCpiTracks;
      }
    }
  }

  // Stability-First: must have >= 60% fixed
  if (portfolio.type === SCENARIO_TYPES.STABILITY_FIRST) {
    const fixedPct = tracks
      .filter((t) => t.type === 'fixed')
      .reduce((sum, t) => sum + t.percentage, 0);
    if (fixedPct < 60) {
      logger.warn(`wizardService.validatePortfolioConstraints: Stability-First has only ${fixedPct}% fixed, adjusting`);
      // Increase fixed allocation by taking from the largest non-fixed track
      const deficit = 60 - fixedPct;
      const nonFixedTracks = tracks.filter((t) => t.type !== 'fixed');
      nonFixedTracks.sort((a, b) => b.percentage - a.percentage);

      if (nonFixedTracks.length > 0) {
        const takeFrom = nonFixedTracks[0];
        const canTake = Math.min(deficit, takeFrom.percentage - 5); // Keep at least 5%
        takeFrom.percentage -= canTake;
        const fixedTrack = tracks.find((t) => t.type === 'fixed');
        if (fixedTrack) {
          fixedTrack.percentage += canTake;
        }
      }
    }
  }

  return portfolio;
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  // Main entry point
  generatePortfolios,

  // Internal helpers (exported for testing)
  generateWithAI,
  generateRuleBased,
  validatePortfolioConstraints,

  // Re-exported from portfolioEngine for backward compatibility
  determineScenarios: (inputs, rates) => {
    const profile = portfolioEngine.analyseUserProfile(inputs);
    return portfolioEngine.determineScenarios(inputs, rates, profile).scenarios;
  },
  getRuleBasedConfig: (type, inputs, rates) => {
    const profile = portfolioEngine.analyseUserProfile(inputs);
    return portfolioEngine.getAdaptiveAllocation(type, inputs, rates, profile);
  },
  buildPortfolio: portfolioEngine.buildPortfolio,
  enrichPortfolio: portfolioEngine.enrichPortfolio,
  calculatePMT: portfolioEngine.calculatePMT,
  calculateBaselineMonthlyPayment: portfolioEngine.calculateBaselineMonthlyPayment,

  // Constants (re-exported for backward compatibility)
  SCENARIO_TYPES,
  SCENARIO_NAMES_HE,
  SCENARIO_NAMES_EN,
  SCENARIO_DESCRIPTIONS,
  TRACK_LABELS_HE,
  STABILITY_THRESHOLD,
  CPI_RATE_THRESHOLD,
};
