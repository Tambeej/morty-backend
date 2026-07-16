'use strict';

const OpenAI = require('openai');
const pdfParse = require('pdf-parse');
const offerService = require('./offerService');
const ratesService = require('./ratesService');
const logger = require('../utils/logger');

let openaiClient;

function getOpenAIClient() {
  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }
  return openaiClient;
}

/**
 * Call OpenAI GPT-4o-mini with JSON mode.
 *
 * @param {string} systemPrompt
 * @param {string} userPrompt
 * @param {object} [options]
 * @param {number} [options.temperature=0.4]
 * @param {number} [options.maxTokens=2000]
 * @returns {Promise<object>} Parsed JSON response.
 */
async function callGPT(systemPrompt, userPrompt, options = {}) {
  const { temperature = 0.4, maxTokens = 2000 } = options;

  const client = getOpenAIClient();

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature,
    max_tokens: maxTokens,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error('Empty response from OpenAI');
  }

  return JSON.parse(content);
}

/**
 * Call OpenAI GPT-4o-mini vision with JSON mode.
 * Sends an image (base64) alongside a text instruction.
 *
 * @param {string} systemPrompt
 * @param {string} instruction - Text instruction accompanying the image
 * @param {Buffer} imageBuffer - Raw image bytes
 * @param {string} mimetype    - image/png or image/jpeg
 * @returns {Promise<object>} Parsed JSON response.
 */
async function callGPTVision(systemPrompt, instruction, imageBuffer, mimetype) {
  const client = getOpenAIClient();

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.2,
    max_tokens: 2000,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: [
          { type: 'text', text: instruction },
          {
            type: 'image_url',
            image_url: { url: `data:${mimetype};base64,${imageBuffer.toString('base64')}` },
          },
        ],
      },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error('Empty response from OpenAI');
  }

  return JSON.parse(content);
}

// ── Offer analysis ────────────────────────────────────────────────────────────

const EXTRACTION_SYSTEM_PROMPT = `You are a mortgage document analyst for the Israeli market.
Extract the following fields from the mortgage offer document and reply ONLY with JSON:
{
  "bank":   string,       // Bank name (e.g. "לאומי", "Bank Hapoalim"); "" if not found
  "amount": number|null,  // Total loan amount in ILS (₪); null if not found
  "rate":   number|null,  // Interest rate as annual percentage (e.g. 4.85); null if not found
  "term":   number|null   // Loan term in YEARS; null if not found
}
Notes:
- The document may be in Hebrew or English.
- If multiple tracks/rates appear, use the blended/average rate or the most prominent one.
- Convert months to years when needed (e.g. 360 months -> 30).`;

/**
 * Standard annuity monthly payment.
 * @param {number} principal   - Loan amount
 * @param {number} annualRate  - Annual rate in percent (e.g. 4.85)
 * @param {number} years       - Term in years
 * @returns {number} Monthly payment
 */
function monthlyPayment(principal, annualRate, years) {
  const r = annualRate / 100 / 12;
  const n = years * 12;
  if (r === 0) return principal / n;
  return (principal * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
}

/**
 * Compute a basic analysis of the extracted offer against current market rates.
 *
 * All reasoning text is produced in BOTH Hebrew and English so the frontend
 * can display whichever matches the user's chosen language (reports are
 * cached, so per-language regeneration is not an option).
 *
 * @param {object} extracted - { bank, amount, rate, term }
 * @param {object} averages  - { fixed, cpi, prime, variable } market averages
 * @returns {{ recommendedRate: number|null, savings: number|null, aiReasoning: string, aiReasoningHe: string, aiReasoningEn: string }}
 */
function computeBasicAnalysis(extracted, averages) {
  const recommendedRate = typeof averages.fixed === 'number' ? averages.fixed : null;

  const { amount, rate, term } = extracted;
  const canCompare =
    typeof amount === 'number' && amount > 0 &&
    typeof rate === 'number' && rate > 0 &&
    typeof term === 'number' && term > 0 &&
    typeof recommendedRate === 'number';

  if (!canCompare) {
    const reasoningEn =
      'Could not fully compare the offer against market averages because some fields (amount, rate, or term) were missing from the document.';
    const reasoningHe =
      'לא ניתן היה להשוות את ההצעה באופן מלא לממוצעי השוק מכיוון שחלק מהנתונים (סכום, ריבית או תקופה) חסרים במסמך.';
    return {
      recommendedRate,
      savings: null,
      aiReasoningHe: reasoningHe,
      aiReasoningEn: reasoningEn,
      // Legacy alias — older frontend code reads `aiReasoning`
      aiReasoning: reasoningEn,
    };
  }

  const offerMonthly = monthlyPayment(amount, rate, term);
  const marketMonthly = monthlyPayment(amount, recommendedRate, term);
  const totalDiff = Math.round((offerMonthly - marketMonthly) * term * 12);
  const savings = totalDiff > 0 ? totalDiff : 0;

  let reasoningEn;
  let reasoningHe;
  if (rate > recommendedRate) {
    reasoningEn = `The offered rate (${rate}%) is above the current market average for fixed-rate mortgages (${recommendedRate}%). Negotiating down to the market average could save roughly ₪${savings.toLocaleString('en-US')} over the life of the loan.`;
    reasoningHe = `הריבית המוצעת (${rate}%) גבוהה מהממוצע הנוכחי בשוק לריבית קבועה (${recommendedRate}%). משא ומתן להשוואת הריבית לממוצע השוק עשוי לחסוך כ-₪${savings.toLocaleString('he-IL')} לאורך חיי ההלוואה.`;
  } else {
    reasoningEn = `The offered rate (${rate}%) is at or below the current market average for fixed-rate mortgages (${recommendedRate}%). This is a competitive offer.`;
    reasoningHe = `הריבית המוצעת (${rate}%) נמוכה מהממוצע הנוכחי בשוק לריבית קבועה (${recommendedRate}%) או שווה לו. זוהי הצעה תחרותית.`;
  }

  return {
    recommendedRate,
    savings,
    aiReasoningHe: reasoningHe,
    aiReasoningEn: reasoningEn,
    // Legacy alias — older frontend code reads `aiReasoning`
    aiReasoning: reasoningEn,
  };
}

/**
 * Analyze an uploaded mortgage offer file.
 *
 * Flow:
 *   1. Load the offer document and download the file from Firebase Storage.
 *   2. Extract { bank, amount, rate, term } via GPT-4o-mini
 *      (vision for images, pdf-parse text extraction for PDFs).
 *   3. Compare against current market averages (ratesService).
 *   4. Persist results via offerService.saveAnalysisResults (status: 'analyzed').
 *
 * On any failure the offer is marked with status 'error'.
 *
 * @param {string} offerId - Firestore offer document ID
 * @returns {Promise<object|null>} The updated offer, or null on failure
 */
async function analyzeOffer(offerId) {
  try {
    const offer = await offerService.findById(offerId);
    if (!offer) throw new Error(`Offer ${offerId} not found`);

    const { storagePath, mimetype } = offer.originalFile || {};
    if (!storagePath) throw new Error(`Offer ${offerId} has no storagePath`);

    const buffer = await offerService.downloadFileFromStorage(storagePath);

    let extracted;
    if (mimetype === 'application/pdf') {
      const { text } = await pdfParse(buffer);
      if (!text || !text.trim()) {
        throw new Error('PDF contains no extractable text');
      }
      extracted = await callGPT(
        EXTRACTION_SYSTEM_PROMPT,
        `Mortgage offer document text:\n\n${text.slice(0, 12000)}`,
        { temperature: 0.2 }
      );
    } else {
      extracted = await callGPTVision(
        EXTRACTION_SYSTEM_PROMPT,
        'Extract the mortgage offer fields from this document image.',
        buffer,
        mimetype
      );
    }

    const averages = await ratesService.getCurrentAverages();
    const analysis = computeBasicAnalysis(extracted, averages);

    const updated = await offerService.saveAnalysisResults(offerId, extracted, analysis);
    logger.info(`aiService.analyzeOffer: offer ${offerId} analyzed successfully`);
    return updated;
  } catch (err) {
    logger.error(`aiService.analyzeOffer failed (id=${offerId}): ${err.message}`);
    try {
      await offerService.markOfferError(offerId);
    } catch (markErr) {
      logger.error(`aiService.analyzeOffer: failed to mark offer ${offerId} as error: ${markErr.message}`);
    }
    return null;
  }
}

module.exports = { callGPT, callGPTVision, analyzeOffer, getOpenAIClient };
