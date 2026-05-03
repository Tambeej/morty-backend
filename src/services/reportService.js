/**
 * Report Service – Enhanced OCR Analysis for Paid Users
 *
 * Compares a user's real bank offer (extracted via OCR from offerService)
 * against their selected optimized portfolio model (from wizardService).
 *
 * Generates a comprehensive AI-powered report containing:
 *   1. **OCR vs Model Comparison**: Track-by-track rate comparison showing
 *      where the bank offer is better/worse than the optimized model.
 *   2. **Mortgage Tricks**: Strategic suggestions like the "Enticement Track"
 *      (מסלול פיתיון) – taking a high-interest track to lower others and
 *      refinancing later.
 *   3. **Negotiation Script**: A personalized, word-for-word Hebrew script
 *      for the bank meeting, referencing specific rates and savings.
 *   4. **Strategic Insights**: Explanations of the "Why" behind suggestions,
 *      matching tracks to expected future funds, risk profile, etc.
 *
 * The report is stored in the offer document under `analysis.enhanced`
 * for future retrieval.
 *
 * @module reportService
 */

'use strict';

const OpenAI = require('openai');
const offerService = require('./offerService');
const ratesService = require('./ratesService');
const logger = require('../utils/logger');

let openai;
if (process.env.OPENAI_API_KEY) {
  openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** Track type labels in Hebrew for report generation */
const TRACK_LABELS_HE = Object.freeze({
  fixed: 'קבועה לא צמודה (קל"צ)',
  cpi: 'צמוד מדד',
  prime: 'פריים',
  variable: 'משתנה לא צמודה',
});

/** Track type labels in English */
const TRACK_LABELS_EN = Object.freeze({
  fixed: 'Fixed (Non-Indexed)',
  cpi: 'CPI-Indexed',
  prime: 'Prime',
  variable: 'Variable (Non-Indexed)',
});

// ── Main Entry Point ──────────────────────────────────────────────────────────

/**
 * Generate an enhanced analysis report comparing a real bank offer
 * to the user's selected optimized portfolio.
 *
 * Flow:
 *   1. Fetch the offer document (must be analyzed via OCR already)
 *   2. Validate the portfolio data
 *   3. Fetch current BOI rates for context
 *   4. Build the comparison data structure
 *   5. Generate AI-powered report (tricks, script, insights)
 *   6. Store the enhanced report in the offer document
 *   7. Return the complete report
 *
 * @param {string} offerId - Firestore document ID of the analyzed offer
 * @param {string} userId - Authenticated user's ID (for ownership check)
 * @param {object} portfolio - The user's selected portfolio from the wizard
 * @param {string} portfolio.id - Portfolio scenario type (e.g., 'market_standard')
 * @param {string} portfolio.name - Portfolio name
 * @param {string} [portfolio.nameHe] - Hebrew name
 * @param {number} portfolio.termYears - Loan term in years
 * @param {Array<object>} portfolio.tracks - Track breakdown
 * @param {number} portfolio.monthlyRepayment - Monthly payment (₪)
 * @param {number} portfolio.totalCost - Total cost over loan term (₪)
 * @param {number} portfolio.totalInterest - Total interest paid (₪)
 * @returns {Promise<object>} Enhanced analysis report
 */
async function generateEnhancedReport(offerId, userId, portfolio) {
  const startTime = Date.now();

  // 1. Fetch and validate the offer
  const offer = await offerService.findByIdAndUserId(offerId, userId);
  if (!offer) {
    const err = new Error('Offer not found or access denied');
    err.statusCode = 404;
    throw err;
  }

  if (offer.status !== 'analyzed') {
    const err = new Error(
      'Offer must be analyzed via OCR before generating an enhanced report. ' +
      'Current status: ' + offer.status
    );
    err.statusCode = 400;
    throw err;
  }

  // 2. Validate portfolio data
  validatePortfolio(portfolio);

  // 3. Fetch current BOI rates for context
  let currentRates;
  try {
    currentRates = await ratesService.getCurrentAverages();
  } catch (err) {
    logger.warn(`reportService: failed to get current rates: ${err.message}`);
    currentRates = { fixed: 4.65, cpi: 3.15, prime: 6.05, variable: 4.95 };
  }

  // 4. Build comparison data
  const comparison = buildComparison(offer, portfolio, currentRates);

  // 5. Generate AI-powered report
  let aiReport;
  try {
    aiReport = await generateAIReport(offer, portfolio, comparison, currentRates);
    logger.info(`reportService: AI report generated for offer ${offerId}`);
  } catch (err) {
    logger.warn(`reportService: AI report generation failed, using rule-based: ${err.message}`);
    aiReport = generateRuleBasedReport(offer, portfolio, comparison, currentRates);
  }

  // 6. Build the complete enhanced report
  const elapsed = Date.now() - startTime;
  const enhancedReport = {
    offerId,
    portfolioId: portfolio.id,
    portfolioName: portfolio.name,
    portfolioNameHe: portfolio.nameHe || portfolio.name,
    generatedAt: new Date().toISOString(),
    processingTimeMs: elapsed,
    comparison,
    tricks: aiReport.tricks || [],
    negotiationScript: aiReport.negotiationScript || '',
    insights: aiReport.insights || [],
    summary: aiReport.summary || '',
    summaryHe: aiReport.summaryHe || '',
  };

  // 7. Store the enhanced report in the offer document
  try {
    await offerService.updateOffer(offerId, {
      'analysis.enhanced': enhancedReport,
      portfolioId: portfolio.id,
    });
    logger.info(`reportService: enhanced report stored for offer ${offerId}`);
  } catch (err) {
    logger.error(`reportService: failed to store enhanced report: ${err.message}`);
    // Non-fatal – still return the report even if storage fails
  }

  return enhancedReport;
}

// ── Comparison Builder ────────────────────────────────────────────────────────

/**
 * Build a structured comparison between the bank offer and the optimized portfolio.
 *
 * @param {object} offer - The analyzed offer document
 * @param {object} portfolio - The selected portfolio
 * @param {object} currentRates - Current BOI average rates
 * @returns {object} Comparison data structure
 */
function buildComparison(offer, portfolio, currentRates) {
  const extracted = offer.extractedData || {};
  const offerRate = extracted.rate;
  const offerAmount = extracted.amount;
  const offerTerm = extracted.term;
  const offerBank = extracted.bank || 'לא ידוע';

  // Calculate portfolio weighted average rate
  const portfolioWeightedRate = calculateWeightedRate(portfolio.tracks);

  // Rate difference (positive = bank offer is more expensive)
  const rateDifference = offerRate != null && portfolioWeightedRate != null
    ? Math.round((offerRate - portfolioWeightedRate) * 100) / 100
    : null;

  // Estimate potential savings
  const potentialSavings = estimateSavings(
    offerAmount || portfolio.tracks.reduce((sum, t) => sum + (t.amount || 0), 0),
    offerRate,
    portfolioWeightedRate,
    offerTerm || portfolio.termYears
  );

  // Track-by-track comparison (where possible)
  const trackComparisons = buildTrackComparisons(offer, portfolio, currentRates);

  return {
    bankOffer: {
      bank: offerBank,
      amount: offerAmount,
      rate: offerRate,
      term: offerTerm,
      recommendedRate: offer.analysis?.recommendedRate || null,
    },
    optimizedModel: {
      name: portfolio.name,
      nameHe: portfolio.nameHe || portfolio.name,
      termYears: portfolio.termYears,
      monthlyRepayment: portfolio.monthlyRepayment,
      totalCost: portfolio.totalCost,
      totalInterest: portfolio.totalInterest,
      weightedRate: portfolioWeightedRate,
      tracks: portfolio.tracks.map((t) => ({
        type: t.type,
        name: TRACK_LABELS_HE[t.type] || t.type,
        percentage: t.percentage,
        rate: t.rate,
        rateDisplay: t.rateDisplay || `${t.rate}%`,
      })),
    },
    rateDifference,
    potentialMonthlySavings: potentialSavings.monthly,
    potentialTotalSavings: potentialSavings.total,
    potentialInterestSavings: potentialSavings.interest,
    trackComparisons,
    boiAverages: currentRates,
    verdict: rateDifference != null
      ? (rateDifference > 0.3 ? 'significantly_worse'
        : rateDifference > 0 ? 'slightly_worse'
        : rateDifference > -0.3 ? 'comparable'
        : 'better_than_model')
      : 'insufficient_data',
  };
}

/**
 * Calculate the weighted average rate across portfolio tracks.
 *
 * @param {Array<object>} tracks - Portfolio tracks with percentage and rate
 * @returns {number|null} Weighted average rate, or null if no valid tracks
 */
function calculateWeightedRate(tracks) {
  if (!tracks || tracks.length === 0) return null;

  let totalWeight = 0;
  let weightedSum = 0;

  for (const track of tracks) {
    if (track.rate != null && track.percentage != null) {
      weightedSum += track.rate * (track.percentage / 100);
      totalWeight += track.percentage / 100;
    }
  }

  if (totalWeight === 0) return null;
  return Math.round((weightedSum / totalWeight) * 100) / 100;
}

/**
 * Estimate potential savings between the bank offer rate and the portfolio rate.
 *
 * @param {number} loanAmount - Loan principal
 * @param {number|null} offerRate - Bank offer rate (%)
 * @param {number|null} portfolioRate - Portfolio weighted rate (%)
 * @param {number} termYears - Loan term in years
 * @returns {{ monthly: number|null, total: number|null, interest: number|null }}
 */
function estimateSavings(loanAmount, offerRate, portfolioRate, termYears) {
  if (offerRate == null || portfolioRate == null || !loanAmount || !termYears) {
    return { monthly: null, total: null, interest: null };
  }

  const months = termYears * 12;

  const offerMonthly = calculatePMT(loanAmount, offerRate / 100 / 12, months);
  const portfolioMonthly = calculatePMT(loanAmount, portfolioRate / 100 / 12, months);

  const monthlySavings = Math.round(offerMonthly - portfolioMonthly);
  const totalSavings = monthlySavings * months;
  const interestSavings = totalSavings; // Simplified: all savings are interest savings

  return {
    monthly: Math.max(0, monthlySavings),
    total: Math.max(0, totalSavings),
    interest: Math.max(0, interestSavings),
  };
}

/**
 * Standard PMT (amortization) formula.
 *
 * @param {number} principal - Loan principal
 * @param {number} monthlyRate - Monthly interest rate (decimal)
 * @param {number} totalMonths - Total number of payments
 * @returns {number} Monthly payment
 */
function calculatePMT(principal, monthlyRate, totalMonths) {
  if (principal <= 0) return 0;
  if (monthlyRate <= 0) return principal / totalMonths;
  if (totalMonths <= 0) return 0;

  const factor = Math.pow(1 + monthlyRate, totalMonths);
  return principal * (monthlyRate * factor) / (factor - 1);
}

/**
 * Build track-by-track comparisons between the bank offer and BOI averages.
 *
 * Since OCR typically extracts a single blended rate, we compare it against
 * each track type in the portfolio and the BOI averages.
 *
 * @param {object} offer - The analyzed offer
 * @param {object} portfolio - The selected portfolio
 * @param {object} currentRates - Current BOI averages
 * @returns {Array<object>} Track comparison entries
 */
function buildTrackComparisons(offer, portfolio, currentRates) {
  const comparisons = [];
  const offerRate = offer.extractedData?.rate;

  for (const track of portfolio.tracks) {
    const boiRate = currentRates[track.type] || null;
    const portfolioRate = track.rate;

    const entry = {
      trackType: track.type,
      trackName: TRACK_LABELS_HE[track.type] || track.type,
      trackNameEn: TRACK_LABELS_EN[track.type] || track.type,
      percentage: track.percentage,
      portfolioRate,
      boiAverage: boiRate,
      rateDisplay: track.rateDisplay || `${portfolioRate}%`,
    };

    // Compare portfolio rate to BOI average
    if (boiRate != null && portfolioRate != null) {
      entry.vsBoi = Math.round((portfolioRate - boiRate) * 100) / 100;
      entry.vsBoiLabel = entry.vsBoi > 0 ? 'above_average' : entry.vsBoi < 0 ? 'below_average' : 'at_average';
    }

    // If we have the bank offer rate, compare it too
    if (offerRate != null && portfolioRate != null) {
      entry.bankOfferRate = offerRate;
      entry.vsBank = Math.round((offerRate - portfolioRate) * 100) / 100;
      entry.vsBankLabel = entry.vsBank > 0 ? 'bank_higher' : entry.vsBank < 0 ? 'bank_lower' : 'equal';
    }

    comparisons.push(entry);
  }

  return comparisons;
}

// ── AI-Powered Report Generation ──────────────────────────────────────────────

/**
 * Generate the enhanced report sections using OpenAI GPT-4o.
 *
 * Produces:
 *   - Mortgage tricks (strategic suggestions)
 *   - Negotiation script (Hebrew, word-for-word)
 *   - Strategic insights (explanations)
 *   - Summary (Hebrew + English)
 *
 * @param {object} offer - The analyzed offer
 * @param {object} portfolio - The selected portfolio
 * @param {object} comparison - The comparison data
 * @param {object} currentRates - Current BOI averages
 * @returns {Promise<object>} AI-generated report sections
 */
async function generateAIReport(offer, portfolio, comparison, currentRates) {
  if (!openai) {
    throw new Error('OpenAI client not initialized (OPENAI_API_KEY not set)');
  }

  const extracted = offer.extractedData || {};
  const bankName = extracted.bank || 'הבנק';
  const offerRate = extracted.rate;
  const offerAmount = extracted.amount;
  const offerTerm = extracted.term;

  // Build portfolio tracks description
  const tracksDesc = portfolio.tracks.map((t) => {
    const heLabel = TRACK_LABELS_HE[t.type] || t.type;
    return `${heLabel}: ${t.percentage}% at ${t.rate}% (${t.rateDisplay || t.rate + '%'})`;
  }).join('\n');

  // Build comparison summary
  const compSummary = comparison.rateDifference != null
    ? `Bank offer rate: ${offerRate}%. Optimized model weighted rate: ${comparison.optimizedModel.weightedRate}%. Difference: ${comparison.rateDifference > 0 ? '+' : ''}${comparison.rateDifference}%.`
    : 'Bank offer rate not fully extracted from OCR.';

  const savingsSummary = comparison.potentialTotalSavings != null
    ? `Potential total savings: ₪${comparison.potentialTotalSavings.toLocaleString()}. Monthly savings: ₪${comparison.potentialMonthlySavings.toLocaleString()}.`
    : 'Savings calculation not available due to incomplete data.';

  const prompt = `You are an expert Israeli mortgage consultant generating a professional analysis report in Hebrew.

Context:
- Bank: ${bankName}
- Bank Offer: Rate ${offerRate != null ? offerRate + '%' : 'unknown'}, Amount ₪${offerAmount != null ? offerAmount.toLocaleString() : 'unknown'}, Term ${offerTerm != null ? offerTerm + ' years' : 'unknown'}
- Optimized Portfolio ("${portfolio.nameHe || portfolio.name}"):
${tracksDesc}
  Monthly Repayment: ₪${portfolio.monthlyRepayment.toLocaleString()}
  Total Cost: ₪${portfolio.totalCost.toLocaleString()}
  Total Interest: ₪${portfolio.totalInterest.toLocaleString()}
- Comparison: ${compSummary}
- Savings: ${savingsSummary}
- Current BOI Averages: Fixed ${currentRates.fixed}%, CPI ${currentRates.cpi}%, Prime ${currentRates.prime}%, Variable ${currentRates.variable}%

Generate a comprehensive report with these sections:

1. **tricks** (Array of 2-4 mortgage tricks/strategies):
   Each trick should have:
   - nameHe: Hebrew name (e.g., "מסלול פיתיון")
   - nameEn: English name (e.g., "Enticement Track")
   - descriptionHe: Hebrew explanation (2-3 sentences)
   - descriptionEn: English explanation (2-3 sentences)
   - potentialSavings: estimated savings in ₪ (number or null)
   - riskLevel: "low", "medium", or "high"
   - applicability: "high", "medium", or "low" (how relevant to this specific case)

   MUST include the "Enticement Track" (מסלול פיתיון) strategy: taking a high-interest track to lower the rates on other tracks, then refinancing that track later.

2. **negotiationScript** (String): A complete, word-for-word Hebrew script for the bank meeting. Must:
   - Start with a greeting and introduction
   - Reference specific rates from the comparison
   - Mention BOI averages as leverage
   - Include specific asks (rate reductions per track)
   - Be polite but firm
   - Be 150-300 words in Hebrew

3. **insights** (Array of 2-4 strategic insights):
   Each insight should have:
   - titleHe: Hebrew title
   - titleEn: English title
   - bodyHe: Hebrew explanation (2-3 sentences)
   - bodyEn: English explanation (2-3 sentences)
   - icon: suggested icon name (e.g., "shield", "trending-down", "calendar", "target")

4. **summary**: English summary (2-3 sentences)
5. **summaryHe**: Hebrew summary (2-3 sentences)

Respond ONLY with valid JSON (no markdown, no explanation):
{
  "tricks": [...],
  "negotiationScript": "...",
  "insights": [...],
  "summary": "...",
  "summaryHe": "..."
}`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: 'You are an expert Israeli mortgage consultant. You generate professional, actionable reports in Hebrew and English. All financial advice must be practical and specific to the user\'s situation. Respond only with valid JSON.',
      },
      { role: 'user', content: prompt },
    ],
    max_tokens: 3000,
    temperature: 0.4,
    response_format: { type: 'json_object' },
  });

  const content = response.choices[0].message.content;
  const parsed = JSON.parse(content);

  // Validate the response structure
  if (!parsed.tricks || !Array.isArray(parsed.tricks)) {
    throw new Error('AI response missing tricks array');
  }
  if (!parsed.negotiationScript || typeof parsed.negotiationScript !== 'string') {
    throw new Error('AI response missing negotiationScript');
  }

  return {
    tricks: parsed.tricks.map(sanitizeTrick),
    negotiationScript: parsed.negotiationScript,
    insights: Array.isArray(parsed.insights) ? parsed.insights.map(sanitizeInsight) : [],
    summary: parsed.summary || '',
    summaryHe: parsed.summaryHe || '',
  };
}

// ── Rule-Based Report Generation (Fallback) ───────────────────────────────────

/**
 * Generate a rule-based report when AI is unavailable.
 *
 * Produces deterministic tricks, a template negotiation script,
 * and basic insights based on the comparison data.
 *
 * @param {object} offer - The analyzed offer
 * @param {object} portfolio - The selected portfolio
 * @param {object} comparison - The comparison data
 * @param {object} currentRates - Current BOI averages
 * @returns {object} Rule-based report sections
 */
function generateRuleBasedReport(offer, portfolio, comparison, currentRates) {
  const extracted = offer.extractedData || {};
  const bankName = extracted.bank || 'הבנק';
  const offerRate = extracted.rate;
  const rateDiff = comparison.rateDifference;
  const savings = comparison.potentialTotalSavings;

  // ── Tricks ──────────────────────────────────────────────────────────────────
  const tricks = [];

  // Trick 1: Enticement Track (always included per spec)
  tricks.push({
    nameHe: 'מסלול פיתיון',
    nameEn: 'Enticement Track',
    descriptionHe:
      'קחו מסלול אחד בריבית גבוהה יותר (למשל פריים) כדי להוריד את הריבית במסלולים האחרים. ' +
      'לאחר שנה-שנתיים, בצעו מיחזור של המסלול היקר בלבד. ' +
      'הבנקים מוכנים להוריד ריבית במסלולים אחרים כשהם מרוויחים יותר במסלול אחד.',
    descriptionEn:
      'Accept a higher rate on one track (e.g., prime) to negotiate lower rates on other tracks. ' +
      'After 1-2 years, refinance only the expensive track. ' +
      'Banks are willing to lower rates on other tracks when they profit more on one.',
    potentialSavings: savings != null ? Math.round(savings * 0.15) : null,
    riskLevel: 'medium',
    applicability: 'high',
  });

  // Trick 2: Track splitting
  if (portfolio.tracks.length >= 2) {
    tricks.push({
      nameHe: 'פיצול מסלולים',
      nameEn: 'Track Splitting',
      descriptionHe:
        'בקשו לפצל את המשכנתא ליותר מסלולים ממה שהבנק מציע. ' +
        'פיצול מאפשר גמישות רבה יותר במיחזור עתידי ומפחית סיכון ריכוז.',
      descriptionEn:
        'Request splitting the mortgage into more tracks than the bank offers. ' +
        'Splitting provides more flexibility for future refinancing and reduces concentration risk.',
      potentialSavings: null,
      riskLevel: 'low',
      applicability: 'medium',
    });
  }

  // Trick 3: Rate matching with BOI data
  if (rateDiff != null && rateDiff > 0) {
    tricks.push({
      nameHe: 'התאמת ריבית לנתוני בנק ישראל',
      nameEn: 'BOI Rate Matching',
      descriptionHe:
        `הריבית שהוצעה לכם (${offerRate}%) גבוהה מהממוצע בבנק ישראל. ` +
        `הציגו את נתוני בנק ישראל (קל"צ: ${currentRates.fixed}%, פריים: ${currentRates.prime}%) ` +
        'ובקשו התאמה לממוצע השוק.',
      descriptionEn:
        `Your offered rate (${offerRate}%) is above the Bank of Israel average. ` +
        `Present BOI data (Fixed: ${currentRates.fixed}%, Prime: ${currentRates.prime}%) ` +
        'and request market-rate matching.',
      potentialSavings: savings,
      riskLevel: 'low',
      applicability: 'high',
    });
  }

  // Trick 4: Early prepayment leverage
  tricks.push({
    nameHe: 'מינוף פירעון מוקדם',
    nameEn: 'Early Prepayment Leverage',
    descriptionHe:
      'ציינו בפני הבנק שאתם שוקלים פירעון מוקדם חלקי בעתיד. ' +
      'זה מעודד את הבנק להציע ריבית טובה יותר כדי לשמור אתכם כלקוחות לטווח ארוך.',
    descriptionEn:
      'Mention to the bank that you are considering partial early repayment in the future. ' +
      'This encourages the bank to offer better rates to retain you as a long-term customer.',
    potentialSavings: null,
    riskLevel: 'low',
    applicability: 'medium',
  });

  // ── Negotiation Script ──────────────────────────────────────────────────────
  const rateStr = offerRate != null ? `${offerRate}%` : 'הריבית שהוצעה';
  const targetRate = comparison.optimizedModel.weightedRate != null
    ? `${comparison.optimizedModel.weightedRate}%`
    : 'ריבית תחרותית יותר';

  const negotiationScript =
    `שלום, שמי [שם]. אני מעוניין/ת במשכנתא ועשיתי מחקר מקיף לפני הפגישה.\n\n` +
    `בדקתי את נתוני בנק ישראל העדכניים וראיתי שהממוצע לריבית קבועה לא צמודה עומד על ${currentRates.fixed}%, ` +
    `ולפריים על ${currentRates.prime}%.\n\n` +
    `ההצעה שקיבלתי מ-${bankName} עומדת על ${rateStr}, ` +
    `שזה ${rateDiff != null && rateDiff > 0 ? `${rateDiff}% מעל הממוצע בשוק` : 'קרוב לממוצע בשוק'}.\n\n` +
    `על בסיס הניתוח שלי, אני מבקש/ת להגיע לריבית משוקללת של ${targetRate}. ` +
    `${savings != null ? `הפער הנוכחי מייצג חיסכון פוטנציאלי של כ-₪${savings.toLocaleString()} לאורך חיי ההלוואה.` : ''}\n\n` +
    `אני פתוח/ה לדון בתמהיל המסלולים – למשל, אני מוכן/ה לשקול ריבית מעט גבוהה יותר במסלול אחד ` +
    `אם זה יאפשר הורדה משמעותית במסלולים האחרים.\n\n` +
    `קיבלתי הצעות גם מבנקים אחרים, ואשמח לתת ל-${bankName} את ההזדמנות להציע את התנאים הטובים ביותר.\n\n` +
    `תודה רבה.`;

  // ── Insights ────────────────────────────────────────────────────────────────
  const insights = [];

  // Insight 1: Rate comparison
  if (rateDiff != null) {
    insights.push({
      titleHe: rateDiff > 0 ? 'הריבית שלכם גבוהה מהממוצע' : 'הריבית שלכם תחרותית',
      titleEn: rateDiff > 0 ? 'Your Rate is Above Average' : 'Your Rate is Competitive',
      bodyHe: rateDiff > 0
        ? `הריבית שהוצעה לכם גבוהה ב-${rateDiff}% מהמודל האופטימלי שלנו. יש מקום למשא ומתן משמעותי.`
        : `הריבית שהוצעה לכם קרובה למודל האופטימלי. עדיין ניתן לנסות לשפר בנקודות ספציפיות.`,
      bodyEn: rateDiff > 0
        ? `Your offered rate is ${rateDiff}% above our optimized model. There is significant room for negotiation.`
        : `Your offered rate is close to the optimized model. You can still try to improve on specific points.`,
      icon: rateDiff > 0 ? 'trending-down' : 'check-circle',
    });
  }

  // Insight 2: Portfolio strategy
  insights.push({
    titleHe: 'אסטרטגיית תמהיל',
    titleEn: 'Portfolio Strategy',
    bodyHe:
      `התיק "${portfolio.nameHe || portfolio.name}" מבוסס על תמהיל של ${portfolio.tracks.length} מסלולים ` +
      `לתקופה של ${portfolio.termYears} שנים. ` +
      `תמהיל זה מאזן בין עלות כוללת להחזר חודשי נוח.`,
    bodyEn:
      `The "${portfolio.name}" portfolio is based on a mix of ${portfolio.tracks.length} tracks ` +
      `over ${portfolio.termYears} years. ` +
      `This mix balances total cost with comfortable monthly payments.`,
    icon: 'target',
  });

  // Insight 3: Market timing
  insights.push({
    titleHe: 'תזמון שוק',
    titleEn: 'Market Timing',
    bodyHe:
      `ריביות בנק ישראל הנוכחיות: קל"צ ${currentRates.fixed}%, צמוד ${currentRates.cpi}%, פריים ${currentRates.prime}%. ` +
      'השתמשו בנתונים אלה כמנוף במשא ומתן.',
    bodyEn:
      `Current BOI rates: Fixed ${currentRates.fixed}%, CPI ${currentRates.cpi}%, Prime ${currentRates.prime}%. ` +
      'Use these figures as leverage in negotiations.',
    icon: 'calendar',
  });

  // ── Summary ─────────────────────────────────────────────────────────────────
  const summaryHe = rateDiff != null && rateDiff > 0
    ? `ההצעה מ-${bankName} גבוהה ב-${rateDiff}% מהמודל האופטימלי. ${savings != null ? `חיסכון פוטנציאלי: ₪${savings.toLocaleString()}.` : ''} מומלץ לנהל משא ומתן.`
    : `ההצעה מ-${bankName} קרובה למודל האופטימלי. עדיין ניתן לשפר בנקודות ספציפיות.`;

  const summary = rateDiff != null && rateDiff > 0
    ? `The offer from ${bankName} is ${rateDiff}% above the optimized model. ${savings != null ? `Potential savings: ₪${savings.toLocaleString()}.` : ''} Negotiation recommended.`
    : `The offer from ${bankName} is close to the optimized model. Minor improvements may still be possible.`;

  return {
    tricks: tricks.slice(0, 4),
    negotiationScript,
    insights,
    summary,
    summaryHe,
  };
}

// ── Sanitization Helpers ──────────────────────────────────────────────────────

/**
 * Sanitize an AI-generated trick object to ensure consistent shape.
 *
 * @param {object} trick - Raw trick from AI
 * @returns {object} Sanitized trick
 */
function sanitizeTrick(trick) {
  return {
    nameHe: String(trick.nameHe || trick.name || ''),
    nameEn: String(trick.nameEn || trick.name || ''),
    descriptionHe: String(trick.descriptionHe || trick.description || ''),
    descriptionEn: String(trick.descriptionEn || trick.description || ''),
    potentialSavings: typeof trick.potentialSavings === 'number' ? trick.potentialSavings : null,
    riskLevel: ['low', 'medium', 'high'].includes(trick.riskLevel) ? trick.riskLevel : 'medium',
    applicability: ['low', 'medium', 'high'].includes(trick.applicability) ? trick.applicability : 'medium',
  };
}

/**
 * Sanitize an AI-generated insight object to ensure consistent shape.
 *
 * @param {object} insight - Raw insight from AI
 * @returns {object} Sanitized insight
 */
function sanitizeInsight(insight) {
  return {
    titleHe: String(insight.titleHe || insight.title || ''),
    titleEn: String(insight.titleEn || insight.title || ''),
    bodyHe: String(insight.bodyHe || insight.body || ''),
    bodyEn: String(insight.bodyEn || insight.body || ''),
    icon: String(insight.icon || 'info'),
  };
}

// ── Validation ────────────────────────────────────────────────────────────────

/**
 * Validate the portfolio object structure.
 *
 * @param {object} portfolio - Portfolio to validate
 * @throws {Error} If portfolio is invalid
 */
function validatePortfolio(portfolio) {
  if (!portfolio || typeof portfolio !== 'object') {
    const err = new Error('Portfolio data is required');
    err.statusCode = 400;
    throw err;
  }

  if (!portfolio.id || typeof portfolio.id !== 'string') {
    const err = new Error('Portfolio must have a valid id');
    err.statusCode = 400;
    throw err;
  }

  if (!Array.isArray(portfolio.tracks) || portfolio.tracks.length === 0) {
    const err = new Error('Portfolio must have at least one track');
    err.statusCode = 400;
    throw err;
  }

  if (typeof portfolio.termYears !== 'number' || portfolio.termYears <= 0) {
    const err = new Error('Portfolio must have a valid termYears');
    err.statusCode = 400;
    throw err;
  }

  if (typeof portfolio.monthlyRepayment !== 'number' || portfolio.monthlyRepayment <= 0) {
    const err = new Error('Portfolio must have a valid monthlyRepayment');
    err.statusCode = 400;
    throw err;
  }

  if (typeof portfolio.totalCost !== 'number' || portfolio.totalCost <= 0) {
    const err = new Error('Portfolio must have a valid totalCost');
    err.statusCode = 400;
    throw err;
  }

  if (typeof portfolio.totalInterest !== 'number' || portfolio.totalInterest < 0) {
    const err = new Error('Portfolio must have a valid totalInterest');
    err.statusCode = 400;
    throw err;
  }

  // Validate each track
  for (const track of portfolio.tracks) {
    if (!track.type || typeof track.type !== 'string') {
      const err = new Error('Each track must have a valid type');
      err.statusCode = 400;
      throw err;
    }
    if (typeof track.percentage !== 'number' || track.percentage <= 0 || track.percentage > 100) {
      const err = new Error('Each track must have a valid percentage (1-100)');
      err.statusCode = 400;
      throw err;
    }
    if (typeof track.rate !== 'number' || track.rate < 0) {
      const err = new Error('Each track must have a valid rate');
      err.statusCode = 400;
      throw err;
    }
  }

  // Validate percentages sum to ~100
  const totalPct = portfolio.tracks.reduce((sum, t) => sum + t.percentage, 0);
  if (totalPct < 98 || totalPct > 102) {
    const err = new Error(`Track percentages must sum to 100% (got ${totalPct}%)`);
    err.statusCode = 400;
    throw err;
  }
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  // Main entry point
  generateEnhancedReport,

  // Internal helpers (exported for testing)
  buildComparison,
  calculateWeightedRate,
  estimateSavings,
  calculatePMT,
  buildTrackComparisons,
  generateAIReport,
  generateRuleBasedReport,
  sanitizeTrick,
  sanitizeInsight,
  validatePortfolio,

  // Constants
  TRACK_LABELS_HE,
  TRACK_LABELS_EN,
};
