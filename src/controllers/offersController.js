/**
 * Offers Controller
 * Handles mortgage offer file uploads and OCR processing
 */

const Offer = require('../models/Offer');
const Financial = require('../models/Financial');
const { extractMortgageData, analyzeMortgage } = require('../services/aiService');
const logger = require('../utils/logger');
const { AppError } = require('../utils/errors');

/**
 * POST /api/v1/offers
 * Upload a mortgage offer document
 */
const uploadOffer = async (req, res, next) => {
  try {
    if (!req.file) {
      return next(new AppError('No file uploaded', 400));
    }

    const userId = req.user.id;

    const fileUrl = req.file.path || '';
    const mimetype = req.file.mimetype || 'application/pdf';
    const originalName = req.file.originalname || 'offer';
    const size = req.file.size || 0;

    // Create offer record with pending status
    const offer = await Offer.create({
      userId,
      originalFile: {
        url: fileUrl,
        mimetype,
        originalName,
        size,
      },
      status: 'pending',
    });

    logger.info(`Offer created: ${offer._id} for user ${userId}`);

    // Process OCR and analysis asynchronously
    setImmediate(async () => {
      try {
        logger.info(`Starting OCR extraction for offer ${offer._id}`);

        const extractedData = await extractMortgageData(fileUrl, mimetype);
        await Offer.findByIdAndUpdate(offer._id, { extractedData });

        logger.info(`OCR complete for offer ${offer._id}, starting analysis`);

        const financial = await Financial.findOne({ userId }).lean();
        const analysis = await analyzeMortgage(extractedData, financial);

        await Offer.findByIdAndUpdate(offer._id, {
          extractedData,
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

        logger.info(`Analysis complete for offer ${offer._id}`);
      } catch (err) {
        logger.error(`Processing failed for offer ${offer._id}:`, err.message);
        await Offer.findByIdAndUpdate(offer._id, { status: 'error' });
      }
    });

    res.status(201).json({
      success: true,
      message: 'Offer uploaded successfully. Analysis in progress.',
      data: {
        offerId: offer._id,
        status: offer.status,
        originalFile: offer.originalFile,
        createdAt: offer.createdAt,
      },
    });
  } catch (error) {
    logger.error('Upload offer error:', error.message);
    next(error);
  }
};

/**
 * GET /api/v1/offers
 * Get all offers for the authenticated user
 */
const getOffers = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 10, status } = req.query;

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
        offers: offers.map((offer) => ({
          id: offer._id,
          status: offer.status,
          originalFile: offer.originalFile,
          extractedData: offer.extractedData,
          analysis: offer.analysis,
          createdAt: offer.createdAt,
          updatedAt: offer.updatedAt,
        })),
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(total / parseInt(limit)),
        },
      },
    });
  } catch (error) {
    logger.error('Get offers error:', error.message);
    next(error);
  }
};

/**
 * GET /api/v1/offers/:id
 * Get a specific offer by ID
 */
const getOffer = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const offer = await Offer.findOne({ _id: id, userId }).lean();

    if (!offer) {
      return next(new AppError('Offer not found', 404));
    }

    res.status(200).json({
      success: true,
      data: {
        id: offer._id,
        status: offer.status,
        originalFile: offer.originalFile,
        extractedData: offer.extractedData,
        analysis: offer.analysis,
        createdAt: offer.createdAt,
        updatedAt: offer.updatedAt,
      },
    });
  } catch (error) {
    logger.error('Get offer error:', error.message);
    next(error);
  }
};

/**
 * DELETE /api/v1/offers/:id
 * Delete a specific offer
 */
const deleteOffer = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const offer = await Offer.findOneAndDelete({ _id: id, userId });

    if (!offer) {
      return next(new AppError('Offer not found', 404));
    }

    logger.info(`Offer ${id} deleted by user ${userId}`);

    res.status(200).json({
      success: true,
      message: 'Offer deleted successfully',
    });
  } catch (error) {
    logger.error('Delete offer error:', error.message);
    next(error);
  }
};

module.exports = {
  uploadOffer,
  getOffers,
  getOffer,
  deleteOffer,
};
