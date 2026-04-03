/**
 * Offers Controller
 *
 * Handles mortgage offer file upload, listing, retrieval, deletion, and stats.
 * All database operations are delegated to offerService (Firestore-backed).
 * File uploads use offerService.uploadFileToCloudinary (stream-based, no disk I/O).
 *
 * Routes:
 *   POST   /api/v1/offers          – upload a new offer file
 *   GET    /api/v1/offers          – list offers for the authenticated user
 *   GET    /api/v1/offers/stats    – aggregate stats (count by status)
 *   GET    /api/v1/offers/:id      – get a single offer
 *   DELETE /api/v1/offers/:id      – delete an offer
 */

'use strict';

const offerService = require('../services/offerService');
const aiService = require('../services/aiService');
const logger = require('../utils/logger');

// ── POST /api/v1/offers ───────────────────────────────────────────────────────

/**
 * Upload a mortgage offer file.
 *
 * Expects multipart/form-data with:
 *   - file     (required) – PDF, PNG, or JPG (validated by multer middleware)
 *   - bankName (optional) – hint for the bank name
 *
 * Flow:
 *   1. Stream file buffer to Cloudinary via offerService.uploadFileToCloudinary
 *   2. Create a Firestore offer document (status: 'pending')
 *   3. Trigger async AI analysis (non-blocking)
 *   4. Return { id, status: 'pending' } per API contract
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 */
exports.uploadOffer = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    const userId = req.user.id;
    const { bankName } = req.body;

    // Stream buffer to Cloudinary (no temp file on disk)
    let cloudinaryResult;
    try {
      cloudinaryResult = await offerService.uploadFileToCloudinary(
        req.file.buffer,
        req.file.mimetype
      );
    } catch (uploadErr) {
      logger.error(`offersController.uploadOffer: Cloudinary upload failed: ${uploadErr.message}`);
      return res.status(502).json({ success: false, message: 'File upload to storage failed' });
    }

    // Create offer document in Firestore
    const offer = await offerService.createOffer(
      userId,
      { url: cloudinaryResult.url, mimetype: req.file.mimetype },
      bankName || ''
    );

    // Trigger async AI analysis – fire-and-forget (non-blocking)
    aiService.analyzeOffer(offer.id).catch((err) =>
      logger.error(`offersController: AI analysis failed for offer ${offer.id}: ${err.message}`)
    );

    // Return minimal response per API contract: { id, status: 'pending' }
    return res.status(201).json({
      success: true,
      data: { id: offer.id, status: offer.status },
    });
  } catch (err) {
    logger.error(`offersController.uploadOffer error: ${err.message}`);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── GET /api/v1/offers/stats ──────────────────────────────────────────────────

/**
 * Get aggregate offer statistics for the authenticated user.
 *
 * Returns counts by status and total savings.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 */
exports.getStats = async (req, res) => {
  try {
    const userId = req.user.id;
    const stats = await offerService.getOfferStats(userId);

    return res.status(200).json({ success: true, data: stats });
  } catch (err) {
    logger.error(`offersController.getStats error: ${err.message}`);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── GET /api/v1/offers ────────────────────────────────────────────────────────

/**
 * List all offers for the authenticated user, sorted by createdAt descending.
 *
 * Supports optional pagination via query params:
 *   - page  (default: 1)
 *   - limit (default: 10, max: 50)
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 */
exports.listOffers = async (req, res) => {
  try {
    const userId = req.user.id;
    const page  = Math.max(1, parseInt(req.query.page, 10)  || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));

    const { offers, total } = await offerService.listOffersByUser(userId, { page, limit });

    return res.status(200).json({
      success: true,
      data: offers,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    logger.error(`offersController.listOffers error: ${err.message}`);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── GET /api/v1/offers/:id ────────────────────────────────────────────────────

/**
 * Get a single offer by ID (must belong to the authenticated user).
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 */
exports.getOffer = async (req, res) => {
  try {
    const userId  = req.user.id;
    const offerId = req.params.id;

    const offer = await offerService.findByIdAndUserId(offerId, userId);
    if (!offer) {
      return res.status(404).json({ success: false, message: 'Offer not found' });
    }

    return res.status(200).json({ success: true, data: offer });
  } catch (err) {
    logger.error(`offersController.getOffer error: ${err.message}`);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── DELETE /api/v1/offers/:id ─────────────────────────────────────────────────

/**
 * Delete an offer by ID (must belong to the authenticated user).
 * Also removes the associated Cloudinary file.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 */
exports.deleteOffer = async (req, res) => {
  try {
    const userId  = req.user.id;
    const offerId = req.params.id;

    await offerService.deleteOffer(offerId, userId);

    return res.status(200).json({ success: true, message: 'Offer deleted' });
  } catch (err) {
    // deleteOffer throws with statusCode 404 when not found / not owned
    if (err.statusCode === 404) {
      return res.status(404).json({ success: false, message: 'Offer not found' });
    }
    logger.error(`offersController.deleteOffer error: ${err.message}`);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};
