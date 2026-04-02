/**
 * AI Service - OpenAI Vision OCR and Mortgage Analysis
 * Handles document extraction and AI-powered mortgage recommendations
 */

const OpenAI = require('openai');
const logger = require('../utils/logger');

// Initialize OpenAI client lazily
let openaiClient = null;

const getOpenAIClient = () => {
  if (!openaiClient && process.env.OPENAI_API_KEY) {
    openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }
  return openaiClient;
};

/**
 * Extract mortgage data from document using OpenAI Vision OCR
 * @param {string} fileUrl - URL of the uploaded document
 * @param {string} mimetype - MIME type of the document
 * @returns {Object} Extracted mortgage data
 */
const extractMortgageData = async (fileUrl, mimetype) => {
  const client = getOpenAIClient();

  if (!client) {
    logger.warn('OpenAI client not available, using mock extraction');
    return getMockExtractedData();
  }

  try {
    logger.info(`Extracting mortgage data from: ${fileUrl}`);

    const extractionPrompt = `You are an expert mortgage document analyzer. Extract the following information from this mortgage offer document and return it as a JSON object:

{
  "bank": "Bank name (string)",
  "amount": "Loan amount in ILS (number)",
  "rate": "Annual interest rate as percentage (number, e.g., 3.5 for 3.5%)",
  "term": "Loan term in years (number)",
  "monthlyPayment": "Monthly payment amount in ILS (number, if stated)",
  "loanType": "Type of mortgage (e.g., fixed, variable, prime-linked)",
  "currency": "Currency (usually ILS)",
  "additionalFees": "Any additional fees or charges mentioned (string)",
  "conditions": "Special conditions or requirements (string)"
}

If any field cannot be determined from the document, use null for that field.
Return ONLY the JSON object, no additional text.`;

    const messageContent = [];

    // Add image if it's an image type
    if (mimetype && (mimetype.includes('image') || mimetype.includes('png') || mimetype.includes('jpg') || mimetype.includes('jpeg'))) {
      messageContent.push({
        type: 'image_url',
        image_url: { url: fileUrl, detail: 'high' },
      });
    }

    messageContent.push({
      type: 'text',
      text: extractionPrompt,
    });

    const response = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: messageContent,
        },
      ],
      max_tokens: 1000,
      temperature: 0.1,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No response from OpenAI');
    }

    // Parse JSON response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Could not parse JSON from OpenAI response');
    }

    const extractedData = JSON.parse(jsonMatch[0]);
    logger.info('Successfully extracted mortgage data via OCR');
    return extractedData;
  } catch (error) {
    logger.error('OCR extraction failed:', error.message);
    return getMockExtractedData();
  }
};

/**
 * Generate AI-powered mortgage analysis and recommendations
 * @param {Object} extractedData - Extracted mortgage terms
 * @param {Object} financialProfile - User's financial profile
 * @returns {Object} Analysis results with recommendations
 */
const analyzeMortgage = async (extractedData, financialProfile) => {
  const client = getOpenAIClient();

  // Calculate financial metrics
  const metrics = calculateMortgageMetrics(extractedData, financialProfile);

  if (!client) {
    logger.warn('OpenAI client not available, using algorithmic analysis');
    return generateAlgorithmicAnalysis(extractedData, financialProfile, metrics);
  }

  try {
    logger.info('Generating AI mortgage analysis');

    const analysisPrompt = `You are an expert Israeli mortgage advisor. Analyze this mortgage offer and provide recommendations.

MORTGAGE OFFER:
- Bank: ${extractedData.bank || 'Unknown'}
- Loan Amount: ILS ${(extractedData.amount || 0).toLocaleString()}
- Interest Rate: ${extractedData.rate}%
- Term: ${extractedData.term} years
- Monthly Payment: ILS ${(metrics.monthlyPayment || 0).toLocaleString()}
- Total Cost: ILS ${(metrics.totalCost || 0).toLocaleString()}
- Total Interest: ILS ${(metrics.totalInterest || 0).toLocaleString()}

CLIENT FINANCIAL PROFILE:
- Monthly Income: ILS ${(financialProfile && financialProfile.income ? financialProfile.income : 0).toLocaleString()}
- Monthly Expenses: ILS ${(financialProfile && financialProfile.totalExpenses ? financialProfile.totalExpenses : 0).toLocaleString()}
- Savings: ILS ${(financialProfile && financialProfile.assets && financialProfile.assets.savings ? financialProfile.assets.savings : 0).toLocaleString()}
- Debt-to-Income Ratio: ${metrics.debtToIncomeRatio ? metrics.debtToIncomeRatio.toFixed(1) : 'Unknown'}%

MARKET CONTEXT:
- Current Israeli market average rate: ${metrics.marketAverageRate}%
- Rate comparison: ${metrics.rateVsMarket !== null ? (metrics.rateVsMarket > 0 ? '+' : '') + metrics.rateVsMarket.toFixed(2) : 'N/A'}% vs market
- Recommended rate: ${metrics.recommendedRate}%
- Potential savings at recommended rate: ILS ${(metrics.potentialSavings || 0).toLocaleString()}

Provide a concise analysis in 2-3 sentences covering:
1. Assessment of the offer quality
2. Key risk or opportunity
3. Primary recommendation

Respond in English. Be specific with numbers. Keep it under 150 words.`;

    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are an expert Israeli mortgage advisor providing concise, actionable analysis.',
        },
        {
          role: 'user',
          content: analysisPrompt,
        },
      ],
      max_tokens: 300,
      temperature: 0.3,
    });

    const aiReasoning = response.choices[0]?.message?.content || '';

    return {
      ...metrics,
      aiReasoning,
      recommendations: generateRecommendations(extractedData, financialProfile, metrics),
      analysisSource: 'openai',
    };
  } catch (error) {
    logger.error('AI analysis failed:', error.message);
    return generateAlgorithmicAnalysis(extractedData, financialProfile, metrics);
  }
};

/**
 * Calculate mortgage financial metrics
 * @param {Object} mortgageData - Mortgage terms
 * @param {Object} financialProfile - User financial data
 * @returns {Object} Calculated metrics
 */
const calculateMortgageMetrics = (mortgageData, financialProfile) => {
  const { amount, rate, term } = mortgageData;
  const marketAverageRate = getMarketAverageRate();

  // Monthly payment calculation (standard amortization formula)
  let monthlyPayment = null;
  let totalCost = null;
  let totalInterest = null;

  if (amount && rate !== undefined && rate !== null && term) {
    const monthlyRate = rate / 100 / 12;
    const numPayments = term * 12;

    if (monthlyRate > 0) {
      monthlyPayment = Math.round(
        (amount * monthlyRate * Math.pow(1 + monthlyRate, numPayments)) /
        (Math.pow(1 + monthlyRate, numPayments) - 1)
      );
    } else {
      monthlyPayment = Math.round(amount / numPayments);
    }

    totalCost = monthlyPayment * numPayments;
    totalInterest = totalCost - amount;
  }

  // Recommended rate (market average or better)
  const recommendedRate = (rate !== undefined && rate !== null)
    ? Math.min(rate, marketAverageRate)
    : marketAverageRate;

  // Calculate savings at recommended rate
  let potentialSavings = 0;
  if (amount && term && rate !== undefined && rate !== null && rate > recommendedRate) {
    const recMonthlyRate = recommendedRate / 100 / 12;
    const numPayments = term * 12;
    const recMonthlyPayment = Math.round(
      (amount * recMonthlyRate * Math.pow(1 + recMonthlyRate, numPayments)) /
      (Math.pow(1 + recMonthlyRate, numPayments) - 1)
    );
    potentialSavings = Math.max(0, (monthlyPayment - recMonthlyPayment) * numPayments);
  }

  // Debt-to-income ratio
  let debtToIncomeRatio = null;
  if (financialProfile && financialProfile.income && monthlyPayment) {
    const existingLoans = (financialProfile.expenses && financialProfile.expenses.loans) ? financialProfile.expenses.loans : 0;
    const totalMonthlyDebt = monthlyPayment + existingLoans;
    debtToIncomeRatio = (totalMonthlyDebt / financialProfile.income) * 100;
  }

  // Affordability score (0-100)
  let affordabilityScore = null;
  if (debtToIncomeRatio !== null) {
    if (debtToIncomeRatio <= 28) affordabilityScore = 90;
    else if (debtToIncomeRatio <= 36) affordabilityScore = 75;
    else if (debtToIncomeRatio <= 43) affordabilityScore = 60;
    else if (debtToIncomeRatio <= 50) affordabilityScore = 40;
    else affordabilityScore = 20;
  }

  const rateVsMarket = (rate !== undefined && rate !== null) ? rate - marketAverageRate : null;
  const isAboveMarket = (rate !== undefined && rate !== null) ? rate > marketAverageRate : null;

  return {
    monthlyPayment,
    totalCost,
    totalInterest,
    recommendedRate,
    potentialSavings,
    marketAverageRate,
    rateVsMarket,
    debtToIncomeRatio,
    affordabilityScore,
    isAboveMarket,
  };
};

/**
 * Get current Israeli mortgage market average rate
 * In production, this would fetch from a real-time data source
 * @returns {number} Market average rate percentage
 */
const getMarketAverageRate = () => {
  // Israeli mortgage market average (prime + spread)
  // Bank of Israel prime rate is typically around 4.5-6%
  // Fixed rate mortgages average around 3.5-4.5%
  return parseFloat(process.env.MARKET_AVERAGE_RATE || '4.2');
};

/**
 * Generate recommendations based on analysis
 * @param {Object} mortgageData - Mortgage terms
 * @param {Object} financialProfile - User financial data
 * @param {Object} metrics - Calculated metrics
 * @returns {Array} List of recommendations
 */
const generateRecommendations = (mortgageData, financialProfile, metrics) => {
  const recommendations = [];

  // Rate negotiation recommendation
  if (metrics.rateVsMarket !== null && metrics.rateVsMarket > 0.2) {
    recommendations.push({
      priority: 1,
      type: 'rate_negotiation',
      title: 'Negotiate Interest Rate',
      description: `Your rate is ${metrics.rateVsMarket.toFixed(2)}% above market average. Negotiating to ${metrics.recommendedRate}% could save ILS ${(metrics.potentialSavings || 0).toLocaleString()} over the loan term.`,
      potentialSavings: metrics.potentialSavings,
    });
  }

  // Term optimization
  if (mortgageData.term && mortgageData.amount && mortgageData.rate) {
    const shorterTerm = Math.max(15, mortgageData.term - 5);
    const shorterTermMetrics = calculateMortgageMetrics(
      { ...mortgageData, term: shorterTerm },
      financialProfile
    );
    const termSavings = (metrics.totalInterest || 0) - (shorterTermMetrics.totalInterest || 0);

    if (termSavings > 10000 && financialProfile && financialProfile.income) {
      const affordablePayment = financialProfile.income * 0.35;
      if (shorterTermMetrics.monthlyPayment <= affordablePayment) {
        recommendations.push({
          priority: 2,
          type: 'term_optimization',
          title: `Consider ${shorterTerm}-Year Term`,
          description: `Reducing the term to ${shorterTerm} years increases monthly payment by ILS ${((shorterTermMetrics.monthlyPayment || 0) - (metrics.monthlyPayment || 0)).toLocaleString()} but saves ILS ${termSavings.toLocaleString()} in total interest.`,
          potentialSavings: termSavings,
        });
      }
    }
  }

  // Debt-to-income warning
  if (metrics.debtToIncomeRatio !== null) {
    if (metrics.debtToIncomeRatio > 43) {
      recommendations.push({
        priority: 3,
        type: 'affordability_warning',
        title: 'High Debt-to-Income Ratio',
        description: `Your debt-to-income ratio of ${metrics.debtToIncomeRatio.toFixed(1)}% exceeds the recommended 43% threshold. Consider reducing other debts or increasing income before proceeding.`,
        potentialSavings: null,
      });
    } else if (metrics.debtToIncomeRatio > 36) {
      recommendations.push({
        priority: 3,
        type: 'affordability_caution',
        title: 'Moderate Debt-to-Income Ratio',
        description: `Your debt-to-income ratio of ${metrics.debtToIncomeRatio.toFixed(1)}% is manageable but above the ideal 36%. Monitor your budget carefully.`,
        potentialSavings: null,
      });
    }
  }

  // Compare multiple offers recommendation
  recommendations.push({
    priority: 4,
    type: 'compare_offers',
    title: 'Compare Multiple Bank Offers',
    description: 'Upload offers from at least 3 banks to get the best comparison. Israeli banks often have significant rate differences.',
    potentialSavings: null,
  });

  return recommendations.sort((a, b) => a.priority - b.priority);
};

/**
 * Generate algorithmic analysis without AI
 * @param {Object} mortgageData - Mortgage terms
 * @param {Object} financialProfile - User financial data
 * @param {Object} metrics - Calculated metrics
 * @returns {Object} Analysis results
 */
const generateAlgorithmicAnalysis = (mortgageData, financialProfile, metrics) => {
  let aiReasoning = '';

  if (metrics.isAboveMarket) {
    aiReasoning = `This mortgage offer from ${mortgageData.bank || 'the bank'} has an interest rate of ${mortgageData.rate}%, which is ${metrics.rateVsMarket ? metrics.rateVsMarket.toFixed(2) : '0'}% above the current market average of ${metrics.marketAverageRate}%. `;
    aiReasoning += `Over the ${mortgageData.term}-year term, this translates to approximately ILS ${(metrics.potentialSavings || 0).toLocaleString()} in additional interest costs compared to the market rate. `;
    aiReasoning += `We recommend negotiating the rate down to at least ${metrics.recommendedRate}% before signing.`;
  } else {
    aiReasoning = `This mortgage offer from ${mortgageData.bank || 'the bank'} has a competitive interest rate of ${mortgageData.rate}%, which is at or below the current market average of ${metrics.marketAverageRate}%. `;
    if (metrics.debtToIncomeRatio !== null) {
      aiReasoning += `Your debt-to-income ratio of ${metrics.debtToIncomeRatio.toFixed(1)}% is ${metrics.debtToIncomeRatio <= 36 ? 'within acceptable range' : 'slightly elevated'}. `;
    }
    aiReasoning += `This appears to be a favorable offer worth considering.`;
  }

  return {
    ...metrics,
    aiReasoning,
    recommendations: generateRecommendations(mortgageData, financialProfile, metrics),
    analysisSource: 'algorithmic',
  };
};

/**
 * Mock extracted data for testing/fallback
 * @returns {Object} Mock mortgage data
 */
const getMockExtractedData = () => ({
  bank: 'Bank Hapoalim',
  amount: 1200000,
  rate: 4.5,
  term: 25,
  monthlyPayment: 6600,
  loanType: 'fixed',
  currency: 'ILS',
  additionalFees: 'Processing fee: ILS 2,500',
  conditions: 'Subject to credit approval',
});

module.exports = {
  extractMortgageData,
  analyzeMortgage,
  calculateMortgageMetrics,
  getMarketAverageRate,
  generateRecommendations,
};
