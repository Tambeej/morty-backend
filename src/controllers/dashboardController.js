/**
 * Dashboard controller
 * Returns a summary of the user's mortgage analysis data.
 */
const Offer = require('../models/Offer');
const Financial = require('../models/Financial');
const logger = require('../utils/logger');

/**
 * GET /api/v1/dashboard
 */
exports.getSummary = async (req, res) => {
  try {
    const [offers, financial] = await Promise.all([
      Offer.find({ userId: req.user._id, status: 'analyzed' }),
      Financial.findOne({ userId: req.user._id }),
    ]);

    // Compute best rate and potential savings across analyzed offers
    let bestRate = null;
    let totalSavings = 0;

    offers.forEach((offer) => {
      if (offer.analysis) {
        if (bestRate === null || offer.analysis.recommendedRate < bestRate) {
          bestRate = offer.analysis.recommendedRate;
        }
        totalSavings += offer.analysis.savings || 0;
      }
    });

    return res.status(200).json({
      success: true,
      data: {
        bestRate,
        potentialSavings: totalSavings,
        activeOffers: offers.length,
        hasFinancialProfile: !!financial,
      },
    });
  } catch (err) {
    logger.error('getSummary error: ' + err.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};
