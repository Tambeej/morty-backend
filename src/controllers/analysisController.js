/**
 * Analysis controller
 * Returns AI analysis results for a specific offer.
 */
const Offer = require('../models/Offer');
const logger = require('../utils/logger');

/**
 * GET /api/v1/analysis/:id
 */
exports.getAnalysis = async (req, res) => {
  try {
    const offer = await Offer.findOne({ _id: req.params.id, userId: req.user._id });
    if (!offer) {
      return res.status(404).json({ success: false, message: 'Offer not found' });
    }

    return res.status(200).json({
      success: true,
      data: {
        offerId: offer._id,
        status: offer.status,
        extractedData: offer.extractedData,
        analysis: offer.analysis,
      },
    });
  } catch (err) {
    logger.error('getAnalysis error: ' + err.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};
