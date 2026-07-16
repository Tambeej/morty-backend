/**
 * Offers Controller
 *
 * Handles mortgage offer file upload, listing, retrieval, deletion, and stats.
 * All database operations are delegated to offerService (Firestore-backed).
 * File uploads use offerService.uploadFileToStorage (Firebase Storage).
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
const paymentService = require('../services/paymentService');
const logger = require('../utils/logger');

// ── POST /api/v1/offers ───────────────────────────────────────────────────────

/**
 * Upload a mortgage offer file.
 *
 * Pay-per-upload: every upload must present an unconsumed payment session
 * (the "voucher" from POST /stripe/checkout). The voucher is consumed
 * atomically right before the upload is accepted — earlier failures (bad
 * file, storage error) never burn the payment. The client keeps the
 * sessionId until this endpoint returns success, so genuine retries reuse
 * the same session; only `consumed: true` blocks reuse.
 *
 * Expects multipart/form-data with:
 *   - file             (required) – PDF, PNG, or JPG (validated by multer middleware)
 *   - paymentSessionId (required) – unconsumed checkout session ID (voucher)
 *   - bankName         (optional) – hint for the bank name
 *
 * Flow:
 *   1. Upload file buffer to Firebase Storage via offerService.uploadFileToStorage
 *   2. Consume the payment voucher (atomic; 402 on failure + orphan cleanup)
 *   3. Create a Firestore offer document (status: 'pending', linked to voucher)
 *   4. Trigger async AI analysis (non-blocking)
 *   5. Return { id, status: 'pending' } per API contract
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
    const { bankName, paymentSessionId } = req.body;

    let uploadResult;
    try {
      uploadResult = await offerService.uploadFileToStorage(
        req.file.buffer,
        req.file.mimetype,
        userId
      );
    } catch (uploadErr) {
      logger.error(`offersController.uploadOffer: Storage upload failed: ${uploadErr.message}`);
      return res.status(502).json({ success: false, message: 'File upload to storage failed' });
    }

    // Consume the voucher now that the upload itself has succeeded.
    const consumed = await paymentService.consumePaymentForUpload(userId, paymentSessionId);
    if (!consumed) {
      // Don't leave an orphan file behind for a rejected upload.
      await offerService.deleteFileFromStorage(uploadResult.storagePath);
      return res.status(402).json({
        success: false,
        error: {
          code: 'PAYMENT_REQUIRED',
          message:
            'A valid unused payment is required for each upload. Please complete checkout and try again.',
        },
      });
    }

    const offer = await offerService.createOffer(
      userId,
      { storagePath: uploadResult.storagePath, mimetype: req.file.mimetype },
      bankName || '',
      paymentSessionId
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
 * Also removes the associated Storage file.
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
