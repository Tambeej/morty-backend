/**
 * Offers controller
 * Handles file upload, listing, retrieval, deletion, and stats.
 */
const Offer = require('../models/Offer');
const cloudinary = require('../config/cloudinary');
const aiService = require('../services/aiService');
const logger = require('../utils/logger');
const fs = require('fs');

/**
 * POST /api/v1/offers
 * Accepts multipart/form-data with field 'file' and optional 'bankName'.
 */
exports.uploadOffer = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    const { bankName } = req.body;

    // Upload to Cloudinary
    let cloudinaryResult;
    try {
      cloudinaryResult = await cloudinary.uploader.upload(req.file.path, {
        folder: 'morty/offers',
        resource_type: 'auto',
      });
    } finally {
      // Remove temp file regardless of Cloudinary result
      if (fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
    }

    const offer = await Offer.create({
      userId: req.user._id,
      originalFile: { url: cloudinaryResult.secure_url, mimetype: req.file.mimetype },
      extractedData: { bank: bankName || '' },
      status: 'pending',
    });

    // Trigger async AI analysis (non-blocking)
    aiService.analyzeOffer(offer._id).catch((err) =>
      logger.error(`AI analysis failed for offer ${offer._id}: ${err.message}`)
    );

    return res.status(201).json({ success: true, data: offer });
  } catch (err) {
    logger.error('uploadOffer error: ' + err.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * GET /api/v1/offers/stats
 */
exports.getStats = async (req, res) => {
  try {
    const [total, pending, analyzed, error] = await Promise.all([
      Offer.countDocuments({ userId: req.user._id }),
      Offer.countDocuments({ userId: req.user._id, status: 'pending' }),
      Offer.countDocuments({ userId: req.user._id, status: 'analyzed' }),
      Offer.countDocuments({ userId: req.user._id, status: 'error' }),
    ]);

    return res.status(200).json({ success: true, data: { total, pending, analyzed, error } });
  } catch (err) {
    logger.error('getStats error: ' + err.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * GET /api/v1/offers
 */
exports.listOffers = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 10));
    const skip = (page - 1) * limit;

    const [offers, total] = await Promise.all([
      Offer.find({ userId: req.user._id }).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Offer.countDocuments({ userId: req.user._id }),
    ]);

    return res.status(200).json({
      success: true,
      data: offers,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    logger.error('listOffers error: ' + err.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * GET /api/v1/offers/:id
 */
exports.getOffer = async (req, res) => {
  try {
    const offer = await Offer.findOne({ _id: req.params.id, userId: req.user._id });
    if (!offer) {
      return res.status(404).json({ success: false, message: 'Offer not found' });
    }
    return res.status(200).json({ success: true, data: offer });
  } catch (err) {
    logger.error('getOffer error: ' + err.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * DELETE /api/v1/offers/:id
 */
exports.deleteOffer = async (req, res) => {
  try {
    const offer = await Offer.findOne({ _id: req.params.id, userId: req.user._id });
    if (!offer) {
      return res.status(404).json({ success: false, message: 'Offer not found' });
    }
    await offer.deleteOne();
    return res.status(200).json({ success: true, message: 'Offer deleted' });
  } catch (err) {
    logger.error('deleteOffer error: ' + err.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};
