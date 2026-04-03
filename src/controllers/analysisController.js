/**
 * Analysis Controller
 *
 * Returns the full offer document (including AI analysis results) for a
 * specific offer.  The offer must belong to the authenticated user.
 *
 * Route:
 *   GET /api/v1/analysis/:id  – get full OfferShape for an offer
 *
 * Response shape (per architecture contract):
 * {
 *   success: true,
 *   data: {
 *     id:            string
 *     userId:        string
 *     originalFile:  { url: string, mimetype: string }
 *     extractedData: { bank: string, amount: number|null, rate: number|null, term: number|null }
 *     analysis:      { recommendedRate: number|null, savings: number|null, aiReasoning: string }
 *     status:        'pending'|'analyzed'|'error'
 *     createdAt:     ISO string
 *     updatedAt:     ISO string
 *   }
 * }
 */

'use strict';

const offerService = require('../services/offerService');
const logger = require('../utils/logger');

/**
 * GET /api/v1/analysis/:id
 *
 * Fetches the full offer document (including analysis sub-object) from
 * Firestore and returns it.  Ownership is enforced via findByIdAndUserId.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 */
exports.getAnalysis = async (req, res) => {
  try {
    const userId  = req.user.id;
    const offerId = req.params.id;

    if (!offerId) {
      return res.status(400).json({ success: false, message: 'Offer ID is required' });
    }

    // Fetch offer and enforce ownership in a single call
    const offer = await offerService.findByIdAndUserId(offerId, userId);
    if (!offer) {
      return res.status(404).json({ success: false, message: 'Offer not found' });
    }

    // Return the full OfferShape so the frontend can render all fields
    return res.status(200).json({
      success: true,
      data: offer,
    });
  } catch (err) {
    logger.error(`analysisController.getAnalysis error: ${err.message}`);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};
