'use strict';

const { callGPT } = require('./aiService');
const { updateEnhancedAnalysis } = require('./offerService');
const logger = require('../utils/logger');

// ─── Sanitisation helpers ────────────────────────────────────────────────────

/**
 * Sanitise a trick object returned from AI to ensure safe, expected shape.
 * @param {*} trick
 * @returns {object}
 */
function sanitizeTrick(trick) {
  if (!trick || typeof trick !== 'object') return null;
  return {
    nameHe: String(trick.nameHe || '').slice(0, 200),
    nameEn: String(trick.nameEn || '').slice(0, 200),
    descriptionHe: String(trick.descriptionHe || '').slice(0, 1000),
    descriptionEn: String(trick.descriptionEn || '').slice(0, 1000),
    applicability: ['high', 'medium', 'low'].includes(trick.applicability)
      ? trick.applicability
      : 'medium',
    riskLevel: ['low', 'medium', 'high'].includes(trick.riskLevel)
      ? trick.riskLevel
      : 'medium',
    potentialSavings:
      typeof trick.potentialSavings === 'number' && trick.potentialSavings >= 0
        ? Math.round(trick.potentialSavings)
        : null,
  };
}

/**
 * Sanitise an insight object returned from AI.
 * @param {*} insight
 * @returns {object}
 */
function sanitizeInsight(insight) {
  if (!insight || typeof insight !== 'object') return null;
  const validIcons = ['trending-down', 'check-circle', 'target', 'calendar', 'shield', 'info'];
  return {
    titleHe: String(insight.titleHe || '').slice(0, 200),
    titleEn: String(insight.titleEn || '').slice(0, 200),
    bodyHe: String(insight.bodyHe || '').slice(0, 1000),
    bodyEn: String(insight.bodyEn || '').slice(0, 1000),
    icon: validIcons.includes(insight.icon) ? insight.icon : 'info',
  };
}

// ─── Comparison builder ──────────────────────────────────────────────────────

/**
 * Build a comparison object between the bank offer and the user's portfolio.
 *
 * @param {object} offer - Offer document data.
 * @param {object|null} portfolio - User portfolio data.
 * @returns {object} Comparison summary.
 */
function buildComparison(offer, portfolio) {
  const offerAnalysis = offer.analysis || {};
  const offerTerms = offerAnalysis.terms || {};

  // Extract bank offer rate (weighted average or first track rate)
  const bankRate =
    typeof offerTerms.interestRate === 'number'
      ? offerTerms.interestRate
      : typeof offerTerms.averageRate === 'number'
      ? offerTerms.averageRate
      : null;

  // Extract portfolio model rate
  const portfolioRate =
    portfolio && typeof portfolio.averageRate === 'number'
      ? portfolio.averageRate
      : portfolio && Array.isArray(portfolio.tracks) && portfolio.tracks.length > 0
      ? portfolio.tracks.reduce((sum, t) => sum + (t.rate || 0), 0) / portfolio.tracks.length
      : null;

  const loanAmount =
    typeof offerTerms.loanAmount === 'number'
      ? offerTerms.loanAmount
      : typeof offer.loanAmount === 'number'
      ? offer.loanAmount
      : 0;

  const termYears =
    typeof offerTerms.termYears === 'number'
      ? offerTerms.termYears
      : typeof offer.termYears === 'number'
      ? offer.termYears
      : 30;

  // Calculate monthly payment delta
  let rateDelta = null;
  let monthlySaving = null;
  let totalSaving = null;

  if (bankRate !== null && portfolioRate !== null) {
    rateDelta = parseFloat((bankRate - portfolioRate).toFixed(4));

    // Simplified monthly payment calculation (annuity formula)
    const monthlyBankRate = bankRate / 100 / 12;
    const monthlyPortfolioRate = portfolioRate / 100 / 12;
    const n = termYears * 12;

    const bankMonthly =
      monthlyBankRate > 0
        ? (loanAmount * monthlyBankRate * Math.pow(1 + monthlyBankRate, n)) /
          (Math.pow(1 + monthlyBankRate, n) - 1)
        : loanAmount / n;

    const portfolioMonthly =
      monthlyPortfolioRate > 0
        ? (loanAmount * monthlyPortfolioRate * Math.pow(1 + monthlyPortfolioRate, n)) /
          (Math.pow(1 + monthlyPortfolioRate, n) - 1)
        : loanAmount / n;

    monthlySaving = Math.round(bankMonthly - portfolioMonthly);
    totalSaving = Math.round(monthlySaving * n);
  }

  // Build track-level comparison
  const bankTracks = Array.isArray(offerTerms.tracks) ? offerTerms.tracks : [];
  const portfolioTracks = portfolio && Array.isArray(portfolio.tracks) ? portfolio.tracks : [];

  const trackComparison = bankTracks.map((bankTrack) => {
    const portfolioTrack = portfolioTracks.find(
      (pt) => pt.type === bankTrack.type || pt.name === bankTrack.name
    );
    return {
      name: bankTrack.name || bankTrack.type || 'Unknown',
      bankRate: bankTrack.rate || null,
      portfolioRate: portfolioTrack ? portfolioTrack.rate || null : null,
      delta:
        bankTrack.rate != null && portfolioTrack && portfolioTrack.rate != null
          ? parseFloat((bankTrack.rate - portfolioTrack.rate).toFixed(4))
          : null,
    };
  });

  return {
    rateDelta,
    monthlySaving,
    totalSaving,
    loanAmount,
    termYears,
    bankRate,
    portfolioRate,
    trackComparison,
  };
}

// ─── Fallback rule-based report ──────────────────────────────────────────────

/**
 * Generate a rule-based enhanced report when AI is unavailable.
 *
 * @param {object} offer
 * @param {object|null} portfolio
 * @param {object} comparison
 * @returns {object} Enhanced report.
 */
function generateFallbackReport(offer, portfolio, comparison) {
  const tricks = [
    {
      nameHe: 'מסלול פיתיון',
      nameEn: 'Enticement Track',
      descriptionHe:
        'קחו מסלול בריבית גבוהה כדי להוריד את הריבית במסלולים האחרים, ואז מחזרו אותו לאחר שנה-שנתיים.',
      descriptionEn:
        'Take a high-interest track to lower rates on other tracks, then refinance it after 1-2 years.',
      applicability: 'high',
      riskLevel: 'medium',
      potentialSavings: comparison.totalSaving ? Math.round(comparison.totalSaving * 0.15) : null,
    },
    {
      nameHe: 'פיצול מסלולים',
      nameEn: 'Track Splitting',
      descriptionHe:
        'פצלו את ההלוואה למספר מסלולים כדי לפזר סיכונים ולנצל יתרונות של כל סוג ריבית.',
      descriptionEn:
        'Split the loan across multiple tracks to diversify risk and leverage benefits of each rate type.',
      applicability: 'high',
      riskLevel: 'low',
      potentialSavings: null,
    },
    {
      nameHe: 'מיחזור מוקדם',
      nameEn: 'Early Refinancing',
      descriptionHe:
        'תכננו מיחזור לאחר 3-5 שנים אם הריביות ירדו, תוך בדיקת עמלות פירעון מוקדם.',
      descriptionEn:
        'Plan refinancing after 3-5 years if rates drop, while checking early repayment penalties.',
      applicability: 'medium',
      riskLevel: 'low',
      potentialSavings: null,
    },
  ];

  const bankName = offer.bankName || offer.analysis?.bankName || 'הבנק';
  const rateDeltaStr =
    comparison.rateDelta != null
      ? `${comparison.rateDelta > 0 ? '+' : ''}${comparison.rateDelta.toFixed(2)}%`
      : 'גבוהה מהממוצע';

  const negotiationScript = `שלום, שמי [שם]. אני מעוניין/ת במשכנתא בסך ${(
    comparison.loanAmount || 0
  ).toLocaleString('he-IL')} ₪ ל-${comparison.termYears || 30} שנים.

בדקתי את נתוני בנק ישראל העדכניים וראיתי שהממוצע לריבית קבועה לא צמודה עומד על ${(
    comparison.portfolioRate || 0
  ).toFixed(2)}%.

הצעת ${bankName} שקיבלתי עומדת על ${rateDeltaStr} מעל הממוצע. אני מבקש/ת שתתאימו את ההצעה לממוצע השוק.

אם תוכלו להציע לי ריבית תחרותית יותר, אני מוכן/ה לסגור את העסקה עוד היום.

תודה רבה.`;

  const insights = [
    {
      titleHe: 'ניתוח הריבית',
      titleEn: 'Rate Analysis',
      bodyHe: `הריבית המוצעת ${rateDeltaStr} מהממוצע בשוק. יש מקום למשא ומתן.`,
      bodyEn: `The offered rate is ${rateDeltaStr} from market average. There is room for negotiation.`,
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
  ];

  return {
    tricks,
    negotiationScript,
    insights,
    comparison,
    generatedAt: new Date().toISOString(),
    generatedBy: 'rule-based-fallback',
    processingTimeMs: 0,
  };
}

// ─── AI-powered report generation ────────────────────────────────────────────

/**
 * Build the system prompt for the AI enhanced report.
 */
function buildSystemPrompt() {
  return `You are an expert Israeli mortgage consultant (יועץ משכנתאות מומחה).
You analyse bank mortgage offers and provide professional advice in both Hebrew and English.

You MUST respond with a valid JSON object containing exactly these fields:
{
  "tricks": [
    {
      "nameHe": "string (Hebrew name)",
      "nameEn": "string (English name)",
      "descriptionHe": "string (2-3 sentences in Hebrew)",
      "descriptionEn": "string (2-3 sentences in English)",
      "applicability": "high|medium|low",
      "riskLevel": "low|medium|high",
      "potentialSavings": number_or_null
    }
  ],
  "negotiationScript": "string (full Hebrew negotiation script, word-for-word, RTL)",
  "insights": [
    {
      "titleHe": "string",
      "titleEn": "string",
      "bodyHe": "string (2-3 sentences in Hebrew)",
      "bodyEn": "string (2-3 sentences in English)",
      "icon": "trending-down|check-circle|target|calendar|shield|info"
    }
  ]
}

Rules:
- tricks: 3-5 actionable mortgage strategies. ALWAYS include 'מסלול פיתיון' (Enticement Track) if applicable.
- negotiationScript: A complete, professional, word-for-word Hebrew script for the bank meeting. Include specific numbers from the offer.
- insights: 3-5 strategic insights explaining the WHY behind recommendations.
- Do NOT include PII. Use [שם] placeholder for the borrower's name.
- All monetary values in ILS (₪).
- Respond ONLY with the JSON object, no markdown.`;
}

/**
 * Build the user prompt with offer and portfolio context.
 */
function buildUserPrompt(offer, portfolio, comparison) {
  const offerAnalysis = offer.analysis || {};
  const offerTerms = offerAnalysis.terms || {};

  // Anonymise: only include financial data, no PII
  const context = {
    bankName: offer.bankName || offerAnalysis.bankName || 'Unknown Bank',
    loanAmount: comparison.loanAmount,
    termYears: comparison.termYears,
    bankRate: comparison.bankRate,
    portfolioRate: comparison.portfolioRate,
    rateDelta: comparison.rateDelta,
    monthlySaving: comparison.monthlySaving,
    totalSaving: comparison.totalSaving,
    tracks: offerTerms.tracks || [],
    portfolioTracks: portfolio ? portfolio.tracks || [] : [],
    trackComparison: comparison.trackComparison,
    offerStatus: offer.status,
  };

  return `Analyse this Israeli mortgage offer and provide expert advice:

${JSON.stringify(context, null, 2)}

Generate:
1. 3-5 mortgage tricks/strategies specific to this offer
2. A complete Hebrew negotiation script using the actual numbers above
3. 3-5 strategic insights explaining the recommendations

Respond with the JSON object as specified.`;
}

// ─── Main export ─────────────────────────────────────────────────────────────

/**
 * Generate an enhanced AI-powered mortgage analysis report.
 *
 * Steps:
 * 1. Build comparison between offer and portfolio.
 * 2. Call AI (GPT-4o-mini) for tricks, script, and insights.
 * 3. Fall back to rule-based report if AI fails.
 * 4. Store the result in `offer.analysis.enhanced` via offerService.
 *
 * @param {string} offerId - Firestore document ID of the offer.
 * @param {string} userId - UID of the authenticated user.
 * @param {object} offer - Full offer document data.
 * @param {object|null} portfolio - User's portfolio data.
 * @returns {Promise<object>} The generated enhanced report.
 */
async function generateEnhancedReport(offerId, userId, offer, portfolio) {
  const startTime = Date.now();
  logger.info('Generating enhanced report', { offerId, userId });

  // Build comparison data
  const comparison = buildComparison(offer, portfolio);

  let enhancedReport;
  let generatedBy = 'ai';

  // Attempt AI generation
  try {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OpenAI API key not configured');
    }

    const systemPrompt = buildSystemPrompt();
    const userPrompt = buildUserPrompt(offer, portfolio, comparison);

    const aiResponse = await callGPT(systemPrompt, userPrompt, {
      temperature: 0.4,
      maxTokens: 3000,
    });

    // Sanitise AI output
    const tricks = Array.isArray(aiResponse.tricks)
      ? aiResponse.tricks.map(sanitizeTrick).filter(Boolean)
      : [];

    const insights = Array.isArray(aiResponse.insights)
      ? aiResponse.insights.map(sanitizeInsight).filter(Boolean)
      : [];

    const negotiationScript =
      typeof aiResponse.negotiationScript === 'string'
        ? aiResponse.negotiationScript.slice(0, 5000)
        : '';

    if (tricks.length === 0 || !negotiationScript) {
      throw new Error('AI response missing required fields');
    }

    enhancedReport = {
      tricks,
      negotiationScript,
      insights,
      comparison,
      generatedAt: new Date().toISOString(),
      generatedBy,
      processingTimeMs: Date.now() - startTime,
    };

    logger.info('AI enhanced report generated successfully', {
      offerId,
      processingTimeMs: enhancedReport.processingTimeMs,
    });
  } catch (aiError) {
    logger.warn('AI generation failed, using rule-based fallback', {
      offerId,
      error: aiError.message,
    });

    enhancedReport = generateFallbackReport(offer, portfolio, comparison);
    enhancedReport.processingTimeMs = Date.now() - startTime;
    generatedBy = 'rule-based-fallback';
    enhancedReport.generatedBy = generatedBy;
  }

  // Persist to Firestore
  try {
    await updateEnhancedAnalysis(offerId, enhancedReport);
  } catch (storeError) {
    logger.error('Failed to store enhanced report', {
      offerId,
      error: storeError.message,
    });
    // Don't throw — still return the report to the client
  }

  return enhancedReport;
}

module.exports = {
  generateEnhancedReport,
  buildComparison,
  sanitizeTrick,
  sanitizeInsight,
  generateFallbackReport,
};
