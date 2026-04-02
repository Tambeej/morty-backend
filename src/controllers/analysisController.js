/**
 * Analysis Controller
 * Handles mortgage analysis retrieval and dashboard summary
 */

const Offer = require('../models/Offer');
const Financial = require('../models/Financial');
const { analyzeMortgage, getMarketAverageRate } = require('../services/aiService');
const logger = require('../utils/logger');
const { AppError } = require('../utils/errors');

/**
 * GET /api/v1/analysis/:id
 * Get analysis results for a specific offer
 */
const getAnalysis = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const offer = await Offer.findOne({ _id: id, userId }).lean();

    if (!offer) {
      return next(new AppError('Offer not found', 404));
    }

    // If analysis is pending and we have extracted data, trigger analysis
    if (offer.status === 'pending' && offer.extractedData && offer.extractedData.rate) {
      logger.info(`Triggering analysis for offer ${id}`);

      const financial = await Financial.findOne({ userId }).lean();

      try {
        const analysis = await analyzeMortgage(offer.extractedData, financial);

        const updatedOffer = await Offer.findByIdAndUpdate(
          id,
          {
            analysis: {
              recommendedRate: analysis.recommendedRate,
              savings: analysis.potentialSavings || 0,
              aiReasoning: analysis.aiReasoning,
              monthlyPayment: analysis.monthlyPayment,
              totalCost: analysis.totalCost,
              totalInterest: analysis.totalInterest,
              marketAverageRate: analysis.marketAverageRate,
              rateVsMarket: analysis.rateVsMarket,
              debtToIncomeRatio: analysis.debtToIncomeRatio,
              affordabilityScore: analysis.affordabilityScore,
              recommendations: analysis.recommendations,
              analysisSource: analysis.analysisSource,
              analyzedAt: new Date(),
            },
            status: 'analyzed',
          },
          { new: true }
        ).lean();

        return res.status(200).json({
          success: true,
          data: formatOfferResponse(updatedOffer),
        });
      } catch (analysisError) {
        logger.error('Analysis failed during retrieval:', analysisError.message);
        await Offer.findByIdAndUpdate(id, { status: 'error' });
      }
    }

    res.status(200).json({
      success: true,
      data: formatOfferResponse(offer),
    });
  } catch (error) {
    logger.error('Get analysis error:', error.message);
    next(error);
  }
};

/**
 * GET /api/v1/analysis
 * Get all analysis results for the authenticated user
 */
const getAllAnalyses = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { status, page = 1, limit = 10 } = req.query;

    const query = { userId };
    if (status) query.status = status;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [offers, total] = await Promise.all([
      Offer.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Offer.countDocuments(query),
    ]);

    res.status(200).json({
      success: true,
      data: {
        offers: offers.map(formatOfferResponse),
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(total / parseInt(limit)),
        },
      },
    });
  } catch (error) {
    logger.error('Get all analyses error:', error.message);
    next(error);
  }
};

/**
 * POST /api/v1/analysis/:id/reanalyze
 * Trigger re-analysis for a specific offer
 */
const reanalyzeOffer = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const offer = await Offer.findOne({ _id: id, userId });

    if (!offer) {
      return next(new AppError('Offer not found', 404));
    }

    if (!offer.extractedData || !offer.extractedData.rate) {
      return next(new AppError('Offer has no extracted data to analyze', 400));
    }

    // Set status to pending
    offer.status = 'pending';
    await offer.save();

    const financial = await Financial.findOne({ userId }).lean();

    // Run analysis asynchronously
    setImmediate(async () => {
      try {
        const analysis = await analyzeMortgage(offer.extractedData, financial);

        await Offer.findByIdAndUpdate(id, {
          analysis: {
            recommendedRate: analysis.recommendedRate,
            savings: analysis.potentialSavings || 0,
            aiReasoning: analysis.aiReasoning,
            monthlyPayment: analysis.monthlyPayment,
            totalCost: analysis.totalCost,
            totalInterest: analysis.totalInterest,
            marketAverageRate: analysis.marketAverageRate,
            rateVsMarket: analysis.rateVsMarket,
            debtToIncomeRatio: analysis.debtToIncomeRatio,
            affordabilityScore: analysis.affordabilityScore,
            recommendations: analysis.recommendations,
            analysisSource: analysis.analysisSource,
            analyzedAt: new Date(),
          },
          status: 'analyzed',
        });

        logger.info(`Re-analysis completed for offer ${id}`);
      } catch (err) {
        logger.error(`Re-analysis failed for offer ${id}:`, err.message);
        await Offer.findByIdAndUpdate(id, { status: 'error' });
      }
    });

    res.status(202).json({
      success: true,
      message: 'Re-analysis started. Poll GET /api/v1/analysis/:id for results.',
      data: { offerId: id, status: 'pending' },
    });
  } catch (error) {
    logger.error('Reanalyze error:', error.message);
    next(error);
  }
};

/**
 * GET /api/v1/analysis/:id/stream
 * SSE endpoint for real-time analysis status updates
 */
const streamAnalysisStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const offer = await Offer.findOne({ _id: id, userId });

    if (!offer) {
      return next(new AppError('Offer not found', 404));
    }

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const sendEvent = (data) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    sendEvent({ status: offer.status, offerId: id });

    // If already analyzed or error, close immediately
    if (offer.status === 'analyzed' || offer.status === 'error') {
      const finalOffer = await Offer.findById(id).lean();
      sendEvent({ status: finalOffer.status, data: formatOfferResponse(finalOffer) });
      res.end();
      return;
    }

    // Poll for status changes every 2 seconds
    const pollInterval = setInterval(async () => {
      try {
        const currentOffer = await Offer.findById(id).lean();

        if (!currentOffer) {
          clearInterval(pollInterval);
          res.end();
          return;
        }

        sendEvent({ status: currentOffer.status, offerId: id });

        if (currentOffer.status === 'analyzed' || currentOffer.status === 'error') {
          sendEvent({ status: currentOffer.status, data: formatOfferResponse(currentOffer) });
          clearInterval(pollInterval);
          clearTimeout(timeout);
          res.end();
        }
      } catch (err) {
        logger.error('SSE poll error:', err.message);
        clearInterval(pollInterval);
        res.end();
      }
    }, 2000);

    // Timeout after 5 minutes
    const timeout = setTimeout(() => {
      clearInterval(pollInterval);
      sendEvent({ status: 'timeout', message: 'Analysis is taking longer than expected' });
      res.end();
    }, 5 * 60 * 1000);

    // Clean up on client disconnect
    req.on('close', () => {
      clearInterval(pollInterval);
      clearTimeout(timeout);
    });
  } catch (error) {
    logger.error('Stream analysis error:', error.message);
    next(error);
  }
};

/**
 * GET /api/v1/dashboard
 * Get dashboard summary for the authenticated user
 */
const getDashboardSummary = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const [offers, financial] = await Promise.all([
      Offer.find({ userId }).sort({ createdAt: -1 }).lean(),
      Financial.findOne({ userId }).lean(),
    ]);

    const analyzedOffers = offers.filter((o) => o.status === 'analyzed');
    const pendingOffers = offers.filter((o) => o.status === 'pending');

    let bestRate = null;
    let bestRateBank = null;
    let totalPotentialSavings = 0;
    let lowestMonthlyPayment = null;

    analyzedOffers.forEach((offer) => {
      const rate = offer.extractedData && offer.extractedData.rate !== undefined ? offer.extractedData.rate : null;
      const savings = (offer.analysis && offer.analysis.savings) ? offer.analysis.savings : 0;
      const monthlyPayment = offer.analysis ? offer.analysis.monthlyPayment : null;

      if (rate !== null) {
        if (bestRate === null || rate < bestRate) {
          bestRate = rate;
          bestRateBank = offer.extractedData ? offer.extractedData.bank : null;
        }
      }

      totalPotentialSavings += savings;

      if (monthlyPayment && (lowestMonthlyPayment === null || monthlyPayment < lowestMonthlyPayment)) {
        lowestMonthlyPayment = monthlyPayment;
      }
    });

    const marketRate = getMarketAverageRate();
    const rateVsMarket = bestRate !== null ? bestRate - marketRate : null;

    // Affordability assessment
    let affordabilityStatus = null;
    if (financial && financial.income && lowestMonthlyPayment) {
      const dti = (lowestMonthlyPayment / financial.income) * 100;
      if (dti <= 28) affordabilityStatus = 'excellent';
      else if (dti <= 36) affordabilityStatus = 'good';
      else if (dti <= 43) affordabilityStatus = 'fair';
      else affordabilityStatus = 'poor';
    }

    // Comparison data for charts
    const comparisonData = analyzedOffers.map((offer) => ({
      bank: (offer.extractedData && offer.extractedData.bank) ? offer.extractedData.bank : 'Unknown',
      rate: offer.extractedData ? offer.extractedData.rate : null,
      monthlyPayment: offer.analysis ? offer.analysis.monthlyPayment : null,
      totalCost: offer.analysis ? offer.analysis.totalCost : null,
      term: offer.extractedData ? offer.extractedData.term : null,
      status: offer.status,
      offerId: offer._id,
    }));

    const totalExpenses = financial
      ? ((financial.expenses && financial.expenses.housing ? financial.expenses.housing : 0) +
         (financial.expenses && financial.expenses.loans ? financial.expenses.loans : 0) +
         (financial.expenses && financial.expenses.other ? financial.expenses.other : 0))
      : 0;

    res.status(200).json({
      success: true,
      data: {
        summary: {
          totalOffers: offers.length,
          analyzedOffers: analyzedOffers.length,
          pendingOffers: pendingOffers.length,
          bestRate,
          bestRateBank,
          rateVsMarket,
          marketAverageRate: marketRate,
          totalPotentialSavings,
          lowestMonthlyPayment,
          affordabilityStatus,
        },
        financialProfile: financial
          ? {
              income: financial.income,
              totalExpenses,
              netMonthly: financial.income - totalExpenses,
              hasProfile: true,
            }
          : { hasProfile: false },
        comparisonData,
        recentOffers: offers.slice(0, 5).map(formatOfferResponse),
      },
    });
  } catch (error) {
    logger.error('Dashboard summary error:', error.message);
    next(error);
  }
};

/**
 * Format offer document for API response
 * @param {Object} offer - Mongoose offer document
 * @returns {Object} Formatted offer response
 */
const formatOfferResponse = (offer) => ({
  id: offer._id,
  status: offer.status,
  originalFile: offer.originalFile,
  extractedData: offer.extractedData,
  analysis: offer.analysis,
  createdAt: offer.createdAt,
  updatedAt: offer.updatedAt,
});

module.exports = {
  getAnalysis,
  getAllAnalyses,
  reanalyzeOffer,
  streamAnalysisStatus,
  getDashboardSummary,
};
