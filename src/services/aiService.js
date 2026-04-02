/**
 * AI service
 * Uses OpenAI Vision API to extract mortgage terms from uploaded files
 * and compute analysis/recommendations.
 */
const OpenAI = require('openai');
const Offer = require('../models/Offer');
const logger = require('../utils/logger');

let openai;
if (process.env.OPENAI_API_KEY) {
  openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

/**
 * Analyse a mortgage offer document.
 * Updates the Offer document in-place with extracted data and analysis.
 *
 * @param {string} offerId - MongoDB ObjectId of the Offer document
 */
exports.analyzeOffer = async (offerId) => {
  const offer = await Offer.findById(offerId);
  if (!offer) throw new Error(`Offer ${offerId} not found`);

  try {
    if (!openai) {
      // Mock analysis when OpenAI key is not configured (dev/test)
      logger.warn('OPENAI_API_KEY not set – using mock analysis');
      offer.extractedData = {
        bank: offer.extractedData.bank || 'Unknown Bank',
        amount: 1200000,
        rate: 3.8,
        term: 25,
      };
      offer.analysis = {
        recommendedRate: 3.4,
        savings: 48000,
        aiReasoning:
          'Mock analysis: The offered rate of 3.8% is above the current market average of 3.4%. ' +
          'Negotiating to 3.4% would save approximately ₪48,000 over the loan term.',
      };
      offer.status = 'analyzed';
      await offer.save();
      return offer;
    }

    // Real OpenAI Vision analysis
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

    offer.extractedData = {
      bank: parsed.bank || offer.extractedData.bank || '',
      amount: parsed.amount || null,
      rate: parsed.rate || null,
      term: parsed.term || null,
    };
    offer.analysis = {
      recommendedRate: parsed.recommendedRate || null,
      savings: parsed.savings || null,
      aiReasoning: parsed.reasoning || '',
    };
    offer.status = 'analyzed';
    await offer.save();

    logger.info(`Offer ${offerId} analyzed successfully`);
    return offer;
  } catch (err) {
    logger.error(`analyzeOffer error for ${offerId}: ${err.message}`);
    offer.status = 'error';
    await offer.save();
    throw err;
  }
};
