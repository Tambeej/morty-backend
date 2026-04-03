/**
 * AI Service
 *
 * Uses OpenAI Vision API to extract mortgage terms from uploaded files
 * and compute analysis/recommendations.
 *
 * This module has been updated to use the Firestore-backed offerService
 * instead of the removed Mongoose Offer model.
 */

'use strict';

const OpenAI = require('openai');
const offerService = require('./offerService');
const logger = require('../utils/logger');

let openai;
if (process.env.OPENAI_API_KEY) {
  openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

/**
 * Analyse a mortgage offer document.
 *
 * Fetches the offer from Firestore, calls OpenAI Vision (or uses a mock
 * when OPENAI_API_KEY is not set), then persists the results back to
 * Firestore via offerService.
 *
 * @param {string} offerId - Firestore document ID of the Offer
 * @returns {Promise<Object>} Updated offer document
 */
exports.analyzeOffer = async (offerId) => {
  const offer = await offerService.findById(offerId);
  if (!offer) throw new Error(`Offer ${offerId} not found`);

  try {
    if (!openai) {
      // Mock analysis when OpenAI key is not configured (dev/test)
      logger.warn('OPENAI_API_KEY not set – using mock analysis');

      const extractedData = {
        bank:   offer.extractedData.bank || 'Unknown Bank',
        amount: 1200000,
        rate:   3.8,
        term:   25,
      };
      const analysis = {
        recommendedRate: 3.4,
        savings:         48000,
        aiReasoning:
          'Mock analysis: The offered rate of 3.8% is above the current market average of 3.4%. ' +
          'Negotiating to 3.4% would save approximately ₪48,000 over the loan term.',
      };

      return offerService.saveAnalysisResults(offerId, extractedData, analysis);
    }

    // ── Real OpenAI Vision analysis ──────────────────────────────────────────
    const prompt = `You are a mortgage analysis expert. Analyze this mortgage offer document image.
Extract the following information in JSON format:
{
  "bank": "bank name",
  "amount": loan amount in ILS (number),
  "rate": annual interest rate as percentage (number),
  "term": loan term in years (number),
  "recommendedRate": your recommended competitive rate (number),
  "savings": estimated lifetime savings at recommended rate in ILS (number),
  "reasoning": brief explanation of your analysis
}
If you cannot extract a value, use null.`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: offer.originalFile.url } },
          ],
        },
      ],
      max_tokens: 500,
    });

    const content = response.choices[0].message.content;

    // Extract JSON from the response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found in AI response');

    const parsed = JSON.parse(jsonMatch[0]);

    const extractedData = {
      bank:   parsed.bank   || offer.extractedData.bank || '',
      amount: parsed.amount ?? null,
      rate:   parsed.rate   ?? null,
      term:   parsed.term   ?? null,
    };
    const analysis = {
      recommendedRate: parsed.recommendedRate ?? null,
      savings:         parsed.savings         ?? null,
      aiReasoning:     parsed.reasoning       || '',
    };

    const updated = await offerService.saveAnalysisResults(offerId, extractedData, analysis);
    logger.info(`aiService.analyzeOffer: offer ${offerId} analyzed successfully`);
    return updated;
  } catch (err) {
    logger.error(`aiService.analyzeOffer error for ${offerId}: ${err.message}`);
    // Mark the offer as errored in Firestore
    try {
      await offerService.markOfferError(offerId);
    } catch (markErr) {
      logger.error(`aiService.analyzeOffer: failed to mark offer ${offerId} as error: ${markErr.message}`);
    }
    throw err;
  }
};
