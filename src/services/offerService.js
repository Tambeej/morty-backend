/**
 * Offer Service – Firestore CRUD, Cloudinary upload, and AI analysis.
 *
 * All interactions with the `offers` Firestore collection are centralised here.
 * Controllers should use this service rather than touching Firestore directly.
 *
 * Document shape stored in Firestore:
 * {
 *   id:           string  (Firestore document ID, also stored as field)
 *   userId:       string  (required, indexed with createdAt desc)
 *   originalFile: {
 *     url:        string  (Cloudinary secure URL)
 *     mimetype:   string
 *   }
 *   extractedData: {
 *     bank:       string  (default '')
 *     amount:     number|null
 *     rate:       number|null
 *     term:       number|null
 *   }
 *   analysis: {
 *     recommendedRate: number|null
 *     savings:         number|null
 *     aiReasoning:     string  (default '')
 *   }
 *   status:    'pending'|'analyzed'|'error'  (default 'pending')
 *   createdAt: ISO string
 *   updatedAt: ISO string
 * }
 *
 * Indexes required in Firestore console:
 *   Collection: offers
 *   Fields:     userId ASC, createdAt DESC
 */

'use strict';

const db = require('../config/firestore');
const cloudinary = require('../config/cloudinary');
const logger = require('../utils/logger');

/** Firestore collection name */
const COLLECTION = 'offers';

/** Valid offer status values */
const OFFER_STATUSES = Object.freeze(['pending', 'analyzed', 'error']);

/** Reference to the offers collection */
const offersRef = () => db.collection(COLLECTION);

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Convert a Firestore DocumentSnapshot to a plain JS object.
 * Returns null when the document does not exist.
 *
 * @param {FirebaseFirestore.DocumentSnapshot} snap
 * @returns {Object|null}
 */
function snapToDoc(snap) {
  if (!snap.exists) return null;
  return { id: snap.id, ...snap.data() };
}

/**
 * Build a normalised offer data object with safe defaults.
 *
 * @param {string} userId       - Firestore user document ID
 * @param {Object} originalFile - { url: string, mimetype: string }
 * @param {string} [bankName]   - Optional bank name hint from the client
 * @returns {Object} Normalised offer document ready for Firestore
 */
function buildOfferData(userId, originalFile, bankName = '') {
  const now = new Date().toISOString();
  return {
    userId,
    originalFile: {
      url: originalFile.url,
      mimetype: originalFile.mimetype,
    },
    extractedData: {
      bank: bankName || '',
      amount: null,
      rate: null,
      term: null,
    },
    analysis: {
      recommendedRate: null,
      savings: null,
      aiReasoning: '',
    },
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Return the offer document as a plain object suitable for API responses.
 * Currently a pass-through (no sensitive fields), kept for symmetry with
 * other services and future extensibility.
 *
 * @param {Object|null} doc - Raw Firestore document data
 * @returns {Object|null}
 */
function toPublicOffer(doc) {
  if (!doc) return null;
  return { ...doc };
}

// ── Read operations ───────────────────────────────────────────────────────────

/**
 * Find an offer by its Firestore document ID.
 * Does NOT enforce userId ownership – callers must check ownership if needed.
 *
 * @param {string} offerId - Firestore document ID
 * @returns {Promise<Object|null>} Offer document or null
 */
async function findById(offerId) {
  if (!offerId) return null;
  try {
    const snap = await offersRef().doc(offerId).get();
    return toPublicOffer(snapToDoc(snap));
  } catch (err) {
    logger.error(`offerService.findById error (id=${offerId}): ${err.message}`);
    throw err;
  }
}

/**
 * Find an offer by ID and verify it belongs to the given user.
 *
 * @param {string} offerId - Firestore document ID
 * @param {string} userId  - Firestore user document ID
 * @returns {Promise<Object|null>} Offer document or null if not found / not owned
 */
async function findByIdAndUserId(offerId, userId) {
  if (!offerId || !userId) return null;
  try {
    const offer = await findById(offerId);
    if (!offer || offer.userId !== userId) return null;
    return offer;
  } catch (err) {
    logger.error(`offerService.findByIdAndUserId error (id=${offerId}, userId=${userId}): ${err.message}`);
    throw err;
  }
}

/**
 * List all offers for a user, sorted by createdAt descending.
 *
 * Requires a composite Firestore index on (userId ASC, createdAt DESC).
 *
 * @param {string} userId  - Firestore user document ID
 * @param {Object} [opts]  - Pagination options
 * @param {number} [opts.limit=10]  - Max documents to return (capped at 50)
 * @param {number} [opts.page=1]    - 1-based page number
 * @returns {Promise<{ offers: Object[], total: number }>}
 */
async function listOffersByUser(userId, { limit = 10, page = 1 } = {}) {
  if (!userId) return { offers: [], total: 0 };

  const safeLimit = Math.min(50, Math.max(1, Number(limit) || 10));
  const safePage  = Math.max(1, Number(page) || 1);
  const offset    = (safePage - 1) * safeLimit;

  try {
    // Firestore does not support native offset pagination efficiently;
    // we fetch all matching docs and slice in memory for simplicity.
    // For large datasets, cursor-based pagination should be used instead.
    const snap = await offersRef()
      .where('userId', '==', userId)
      .orderBy('createdAt', 'desc')
      .get();

    const allOffers = snap.docs.map((d) => toPublicOffer({ id: d.id, ...d.data() }));
    const total     = allOffers.length;
    const offers    = allOffers.slice(offset, offset + safeLimit);

    return { offers, total };
  } catch (err) {
    logger.error(`offerService.listOffersByUser error (userId=${userId}): ${err.message}`);
    throw err;
  }
}

/**
 * Return the N most recent offers for a user (no pagination).
 *
 * @param {string} userId - Firestore user document ID
 * @param {number} [n=5]  - Number of offers to return
 * @returns {Promise<Object[]>}
 */
async function getRecentOffers(userId, n = 5) {
  if (!userId) return [];
  try {
    const snap = await offersRef()
      .where('userId', '==', userId)
      .orderBy('createdAt', 'desc')
      .limit(n)
      .get();

    return snap.docs.map((d) => toPublicOffer({ id: d.id, ...d.data() }));
  } catch (err) {
    logger.error(`offerService.getRecentOffers error (userId=${userId}): ${err.message}`);
    throw err;
  }
}

/**
 * Count offers for a user, optionally filtered by status.
 *
 * @param {string} userId          - Firestore user document ID
 * @param {string} [status]        - Optional status filter
 * @returns {Promise<number>}
 */
async function countOffersByUser(userId, status) {
  if (!userId) return 0;
  try {
    let query = offersRef().where('userId', '==', userId);
    if (status && OFFER_STATUSES.includes(status)) {
      query = query.where('status', '==', status);
    }
    const snap = await query.get();
    return snap.size;
  } catch (err) {
    logger.error(`offerService.countOffersByUser error (userId=${userId}): ${err.message}`);
    throw err;
  }
}

/**
 * Compute aggregate stats for a user's offers.
 *
 * @param {string} userId - Firestore user document ID
 * @returns {Promise<{ total: number, pending: number, analyzed: number, error: number, savingsTotal: number }>}
 */
async function getOfferStats(userId) {
  if (!userId) {
    return { total: 0, pending: 0, analyzed: 0, error: 0, savingsTotal: 0 };
  }
  try {
    const snap = await offersRef().where('userId', '==', userId).get();
    let pending = 0;
    let analyzed = 0;
    let error = 0;
    let savingsTotal = 0;

    snap.docs.forEach((d) => {
      const data = d.data();
      if (data.status === 'pending')  pending++;
      if (data.status === 'analyzed') analyzed++;
      if (data.status === 'error')    error++;
      if (data.analysis && typeof data.analysis.savings === 'number') {
        savingsTotal += data.analysis.savings;
      }
    });

    return { total: snap.size, pending, analyzed, error, savingsTotal };
  } catch (err) {
    logger.error(`offerService.getOfferStats error (userId=${userId}): ${err.message}`);
    throw err;
  }
}

// ── Write operations ──────────────────────────────────────────────────────────

/**
 * Create a new offer document in Firestore.
 *
 * @param {string} userId       - Firestore user document ID
 * @param {Object} originalFile - { url: string, mimetype: string }
 * @param {string} [bankName]   - Optional bank name hint
 * @returns {Promise<Object>} The created offer document
 */
async function createOffer(userId, originalFile, bankName = '') {
  if (!userId) throw new Error('userId is required for createOffer');
  if (!originalFile || !originalFile.url) {
    throw new Error('originalFile.url is required for createOffer');
  }

  const offerData = buildOfferData(userId, originalFile, bankName);

  try {
    const docRef = offersRef().doc();
    const docWithId = { id: docRef.id, ...offerData };
    await docRef.set(docWithId);
    logger.info(`offerService.createOffer: created offer ${docRef.id} for user ${userId}`);
    return toPublicOffer(docWithId);
  } catch (err) {
    logger.error(`offerService.createOffer error (userId=${userId}): ${err.message}`);
    throw err;
  }
}

/**
 * Update arbitrary fields on an offer document.
 *
 * Always sets `updatedAt` to the current ISO timestamp.
 *
 * @param {string} offerId - Firestore document ID
 * @param {Object} updates - Fields to update
 * @returns {Promise<Object>} Updated offer document
 */
async function updateOffer(offerId, updates) {
  if (!offerId) throw new Error('offerId is required for updateOffer');

  const now = new Date().toISOString();
  const safeUpdates = { ...updates, updatedAt: now };

  // Prevent overwriting immutable fields
  delete safeUpdates.id;
  delete safeUpdates.userId;
  delete safeUpdates.createdAt;

  try {
    await offersRef().doc(offerId).update(safeUpdates);
    const updated = await findById(offerId);
    return toPublicOffer(updated);
  } catch (err) {
    logger.error(`offerService.updateOffer error (id=${offerId}): ${err.message}`);
    throw err;
  }
}

/**
 * Update the status of an offer.
 *
 * @param {string} offerId - Firestore document ID
 * @param {string} status  - New status ('pending'|'analyzed'|'error')
 * @returns {Promise<Object>} Updated offer document
 */
async function updateOfferStatus(offerId, status) {
  if (!OFFER_STATUSES.includes(status)) {
    throw new Error(`Invalid offer status: ${status}. Must be one of: ${OFFER_STATUSES.join(', ')}`);
  }
  return updateOffer(offerId, { status });
}

/**
 * Save AI-extracted data and analysis results to an offer document.
 * Sets status to 'analyzed' on success.
 *
 * @param {string} offerId       - Firestore document ID
 * @param {Object} extractedData - { bank, amount, rate, term }
 * @param {Object} analysis      - { recommendedRate, savings, aiReasoning }
 * @returns {Promise<Object>} Updated offer document
 */
async function saveAnalysisResults(offerId, extractedData, analysis) {
  if (!offerId) throw new Error('offerId is required for saveAnalysisResults');

  const updates = {
    extractedData: {
      bank:   extractedData.bank   || '',
      amount: extractedData.amount ?? null,
      rate:   extractedData.rate   ?? null,
      term:   extractedData.term   ?? null,
    },
    analysis: {
      recommendedRate: analysis.recommendedRate ?? null,
      savings:         analysis.savings         ?? null,
      aiReasoning:     analysis.aiReasoning     || '',
    },
    status: 'analyzed',
  };

  try {
    const updated = await updateOffer(offerId, updates);
    logger.info(`offerService.saveAnalysisResults: saved analysis for offer ${offerId}`);
    return updated;
  } catch (err) {
    logger.error(`offerService.saveAnalysisResults error (id=${offerId}): ${err.message}`);
    throw err;
  }
}

/**
 * Mark an offer as errored (e.g., AI analysis failed).
 *
 * @param {string} offerId - Firestore document ID
 * @returns {Promise<Object>} Updated offer document
 */
async function markOfferError(offerId) {
  return updateOfferStatus(offerId, 'error');
}

/**
 * Delete an offer document from Firestore.
 * Optionally deletes the associated Cloudinary file.
 *
 * @param {string}  offerId          - Firestore document ID
 * @param {string}  userId           - Must match offer.userId (ownership check)
 * @param {boolean} [deleteFile=true] - Whether to delete the Cloudinary file
 * @returns {Promise<void>}
 */
async function deleteOffer(offerId, userId, deleteFile = true) {
  if (!offerId) throw new Error('offerId is required for deleteOffer');
  if (!userId)  throw new Error('userId is required for deleteOffer');

  const offer = await findByIdAndUserId(offerId, userId);
  if (!offer) {
    const err = new Error('Offer not found or access denied');
    err.statusCode = 404;
    throw err;
  }

  try {
    // Attempt to delete the Cloudinary file (non-fatal if it fails)
    if (deleteFile && offer.originalFile && offer.originalFile.url) {
      try {
        // Extract public_id from Cloudinary URL
        // URL format: https://res.cloudinary.com/<cloud>/raw/upload/<version>/<public_id>
        const urlParts = offer.originalFile.url.split('/');
        const uploadIndex = urlParts.indexOf('upload');
        if (uploadIndex !== -1) {
          // Skip version segment (v1234567890) if present
          let publicIdParts = urlParts.slice(uploadIndex + 1);
          if (publicIdParts[0] && /^v\d+$/.test(publicIdParts[0])) {
            publicIdParts = publicIdParts.slice(1);
          }
          const publicId = publicIdParts.join('/').replace(/\.[^/.]+$/, '');
          if (publicId) {
            await cloudinary.uploader.destroy(publicId, { resource_type: 'raw' });
            logger.info(`offerService.deleteOffer: deleted Cloudinary file ${publicId}`);
          }
        }
      } catch (cloudErr) {
        logger.warn(`offerService.deleteOffer: Cloudinary delete failed for offer ${offerId}: ${cloudErr.message}`);
      }
    }

    await offersRef().doc(offerId).delete();
    logger.info(`offerService.deleteOffer: deleted offer ${offerId} for user ${userId}`);
  } catch (err) {
    logger.error(`offerService.deleteOffer error (id=${offerId}): ${err.message}`);
    throw err;
  }
}

// ── Upload helper ─────────────────────────────────────────────────────────────

/**
 * Upload a file buffer to Cloudinary and return the result.
 *
 * Uses a stream-based upload so the buffer is never written to disk.
 *
 * @param {Buffer} buffer   - File buffer (from multer memoryStorage)
 * @param {string} mimetype - MIME type of the file
 * @returns {Promise<{ url: string, publicId: string }>}
 */
async function uploadFileToCloudinary(buffer, mimetype) {
  if (!buffer) throw new Error('buffer is required for uploadFileToCloudinary');

  return new Promise((resolve, reject) => {
    const resourceType = mimetype === 'application/pdf' ? 'raw' : 'image';

    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: 'morty/offers',
        resource_type: resourceType,
      },
      (error, result) => {
        if (error) {
          logger.error(`offerService.uploadFileToCloudinary: Cloudinary error: ${error.message}`);
          return reject(new Error(`Cloudinary upload failed: ${error.message}`));
        }
        resolve({
          url: result.secure_url,
          publicId: result.public_id,
        });
      }
    );

    uploadStream.end(buffer);
  });
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  // Constants
  OFFER_STATUSES,
  // Read
  findById,
  findByIdAndUserId,
  listOffersByUser,
  getRecentOffers,
  countOffersByUser,
  getOfferStats,
  // Write
  createOffer,
  updateOffer,
  updateOfferStatus,
  saveAnalysisResults,
  markOfferError,
  deleteOffer,
  // Upload
  uploadFileToCloudinary,
  // Internal helpers (exported for testing)
  buildOfferData,
  toPublicOffer,
  snapToDoc,
};
