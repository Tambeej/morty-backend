/**
 * Offer Service – Firestore CRUD, Firebase Storage upload, and AI analysis.
 *
 * All interactions with the `offers` Firestore collection are centralised here.
 * Controllers should use this service rather than touching Firestore directly.
 *
 * Document shape stored in Firestore:
 * {
 *   id:           string  (Firestore document ID, also stored as field)
 *   userId:       string  (required, indexed with createdAt desc)
 *   originalFile: {
 *     storagePath: string  (path in Firebase Storage bucket)
 *     mimetype:    string
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
 *     enhanced:        object|null  (set by updateEnhancedAnalysis, if paid)
 *   }
 *   status:    'pending'|'analyzed'|'error'  (default 'pending')
 *   createdAt: ISO string
 *   updatedAt: ISO string
 * }
 *
 * Indexes required in Firestore console:
 *   Collection: offers
 *   Fields:     userId ASC, createdAt DESC
 *   Fields:     userId ASC, status ASC, updatedAt DESC  (for enhanced queries)
 */

'use strict';

const { v4: uuidv4 } = require('uuid');
const db = require('../config/firestore');
const { getStorage } = require('../config/firebase');
const logger = require('../utils/logger');

/**
 * Return the default Firebase Storage bucket instance.
 * Bucket name is configured via FIREBASE_STORAGE_BUCKET env var.
 */

const storageBucket = () => {
  const bucketName = process.env.FIREBASE_STORAGE_BUCKET || 'morty-8ce8f.firebasestorage.app';
  return getStorage().bucket(bucketName);
};

/** Signed URL TTL for offer files (15 minutes) */
const SIGNED_URL_TTL_MS = 15 * 60 * 1000;

/**
 * Generate a fresh signed URL for a Storage object.
 * Returns null if `storagePath` is falsy.
 */
async function signStoragePath(storagePath, ttlMs = SIGNED_URL_TTL_MS) {
  if (!storagePath) return null;
  try {
    const [url] = await storageBucket()
      .file(storagePath)
      .getSignedUrl({ action: 'read', expires: Date.now() + ttlMs });
    return url;
  } catch (err) {
    logger.warn(`offerService.signStoragePath failed (path=${storagePath}): ${err.message}`);
    return null;
  }
}

/**
 * Attach a fresh signed URL to `offer.originalFile.url` when a storagePath
 * is present. Leaves legacy documents (with a pre-populated `url` and no
 * `storagePath`) untouched.
 */
async function attachSignedUrl(offer) {
  if (!offer || !offer.originalFile) return offer;
  const { storagePath } = offer.originalFile;
  if (storagePath) {
    const url = await signStoragePath(storagePath);
    offer.originalFile = { ...offer.originalFile, url };
  }
  return offer;
}

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
 * @param {Object} originalFile - { storagePath: string, mimetype: string }
 * @param {string} [bankName]   - Optional bank name hint from the client
 * @returns {Object} Normalised offer document ready for Firestore
 */
function buildOfferData(userId, originalFile, bankName = '', paymentSessionId = null) {
  const now = new Date().toISOString();
  return {
    userId,
    // The consumed payment voucher that paid for this upload (pay-per-upload).
    // Its presence marks the offer as paid — enhanced analysis is included.
    paymentSessionId: paymentSessionId || null,
    originalFile: {
      storagePath: originalFile.storagePath,
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
    return attachSignedUrl(toPublicOffer(snapToDoc(snap)));
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
    const paged     = allOffers.slice(offset, offset + safeLimit);
    const offers    = await Promise.all(paged.map(attachSignedUrl));

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

    const offers = snap.docs.map((d) => toPublicOffer({ id: d.id, ...d.data() }));
    return Promise.all(offers.map(attachSignedUrl));
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
 * @param {Object} originalFile - { storagePath: string, mimetype: string }
 * @param {string} [bankName]   - Optional bank name hint
 * @returns {Promise<Object>} The created offer document (with a fresh signed URL)
 */
async function createOffer(userId, originalFile, bankName = '', paymentSessionId = null) {
  if (!userId) throw new Error('userId is required for createOffer');
  if (!originalFile || !originalFile.storagePath) {
    throw new Error('originalFile.storagePath is required for createOffer');
  }

  const offerData = buildOfferData(userId, originalFile, bankName, paymentSessionId);

  try {
    const docRef = offersRef().doc();
    const docWithId = { id: docRef.id, ...offerData };
    await docRef.set(docWithId);
    logger.info(`offerService.createOffer: created offer ${docRef.id} for user ${userId}`);
    return attachSignedUrl(toPublicOffer(docWithId));
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
      aiReasoningHe:   analysis.aiReasoningHe   || '',
      aiReasoningEn:   analysis.aiReasoningEn   || '',
      // Legacy alias — older frontend code reads `aiReasoning`
      aiReasoning:     analysis.aiReasoning || analysis.aiReasoningEn || '',
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
 * Optionally deletes the associated Firebase Storage file.
 *
 * @param {string}  offerId          - Firestore document ID
 * @param {string}  userId           - Must match offer.userId (ownership check)
 * @param {boolean} [deleteFile=true] - Whether to delete the Storage file
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
    // Attempt to delete the Storage file (non-fatal if it fails).
    if (deleteFile && offer.originalFile && offer.originalFile.storagePath) {
      const { storagePath } = offer.originalFile;
      try {
        await storageBucket().file(storagePath).delete();
        logger.info(`offerService.deleteOffer: deleted Storage file ${storagePath}`);
      } catch (storageErr) {
        logger.warn(
          `offerService.deleteOffer: Storage delete failed for offer ${offerId} (path=${storagePath}): ${storageErr.message}`
        );
      }
    }

    await offersRef().doc(offerId).delete();
    logger.info(`offerService.deleteOffer: deleted offer ${offerId} for user ${userId}`);
  } catch (err) {
    logger.error(`offerService.deleteOffer error (id=${offerId}): ${err.message}`);
    throw err;
  }
}

// ── Enhanced Analysis ─────────────────────────────────────────────────────────

/**
 * Store the enhanced AI report in `offer.analysis.enhanced` using a
 * Firestore transaction with an idempotent "if not exists" guard.
 *
 * If `analysis.enhanced` already exists on the document, the write is
 * skipped and the existing report is returned instead. This prevents:
 *   - Concurrent requests from overwriting a completed report.
 *   - Accidental re-generation charges (AI tokens, Stripe).
 *
 * @param {string} offerId        - Firestore document ID of the offer.
 * @param {object} enhancedReport - The enhanced report data to store.
 * @returns {Promise<{ stored: boolean, report: object }>}
 *   stored: true  → report was written to Firestore.
 *   stored: false → report already existed; existing report returned.
 * @throws {Error} If offerId is missing or the Firestore transaction fails.
 */
async function updateEnhancedAnalysis(offerId, enhancedReport) {
  if (!offerId) throw new Error('offerId is required for updateEnhancedAnalysis');

  const offerRef = offersRef().doc(offerId);

  try {
    let stored = false;
    let resultReport = enhancedReport;

    await db.runTransaction(async (transaction) => {
      const offerSnap = await transaction.get(offerRef);

      if (!offerSnap.exists) {
        throw new Error(`Offer '${offerId}' not found during enhanced analysis storage`);
      }

      const offerData = offerSnap.data();

      // Idempotency guard: skip write if enhanced report already exists
      if (offerData.analysis && offerData.analysis.enhanced) {
        logger.info('Enhanced analysis already exists, skipping write (idempotent)', { offerId });
        resultReport = offerData.analysis.enhanced;
        stored = false;
        return; // abort write, keep existing
      }

      // Write the enhanced report
      transaction.update(offerRef, {
        'analysis.enhanced': enhancedReport,
        updatedAt: new Date().toISOString(),
      });

      stored = true;
    });

    if (stored) {
      logger.info('Enhanced analysis stored successfully', { offerId });
    }

    return { stored, report: resultReport };
  } catch (err) {
    logger.error(`offerService.updateEnhancedAnalysis error (id=${offerId}): ${err.message}`);
    throw err;
  }
}

// ── Upload helper ─────────────────────────────────────────────────────────────

const MIME_EXTENSIONS = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
};

/**
 * Best-effort delete of a Storage file (used to clean up orphans when an
 * upload is rejected after the file was already written, e.g. payment
 * consumption failed). Never throws.
 *
 * @param {string} storagePath - Path within the default bucket
 * @returns {Promise<void>}
 */
async function deleteFileFromStorage(storagePath) {
  if (!storagePath) return;
  try {
    await storageBucket().file(storagePath).delete();
    logger.info(`offerService.deleteFileFromStorage: deleted ${storagePath}`);
  } catch (err) {
    logger.warn(`offerService.deleteFileFromStorage failed (path=${storagePath}): ${err.message}`);
  }
}

/**
 * Download a file from Firebase Storage as a Buffer.
 *
 * @param {string} storagePath - Path within the default bucket
 * @returns {Promise<Buffer>}
 */
async function downloadFileFromStorage(storagePath) {
  if (!storagePath) throw new Error('storagePath is required for downloadFileFromStorage');
  try {
    const [buffer] = await storageBucket().file(storagePath).download();
    return buffer;
  } catch (err) {
    logger.error(`offerService.downloadFileFromStorage error (path=${storagePath}): ${err.message}`);
    throw new Error(`Storage download failed: ${err.message}`);
  }
}

/**
 * Upload a file buffer to Firebase Storage.
 *
 * Path layout: `offers/<userId>/<uuid>.<ext>`. Files are private; callers
 * receive fresh signed URLs via `attachSignedUrl` on reads.
 *
 * @param {Buffer} buffer   - File buffer (from multer memoryStorage)
 * @param {string} mimetype - MIME type of the file
 * @param {string} userId   - Owner's Firestore user document ID
 * @returns {Promise<{ storagePath: string }>}
 */
async function uploadFileToStorage(buffer, mimetype, userId) {
  if (!buffer) throw new Error('buffer is required for uploadFileToStorage');
  if (!userId) throw new Error('userId is required for uploadFileToStorage');

  const ext = MIME_EXTENSIONS[mimetype] || 'bin';
  //const storagePath = `offers/${userId}/${uuidv4()}.${ext}`;
  // Create a clean destination path in your bucket
  const storagePath = `offers/${userId}/${Date.now()}_offer`;

  try {
    await storageBucket().file(storagePath).save(buffer, {
      contentType: mimetype,
      resumable: false,
      metadata: { cacheControl: 'private, max-age=0, no-store' },
    });
    logger.info(`offerService.uploadFileToStorage: uploaded ${storagePath}`);
    return { storagePath };
  } catch (err) {
    logger.error(`offerService.uploadFileToStorage error (path=${storagePath}): ${err.message}`);
    throw new Error(`Storage upload failed: ${err.message}`);
  }
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
  // Enhanced analysis (paid feature)
  updateEnhancedAnalysis,
  // Upload / download
  uploadFileToStorage,
  downloadFileFromStorage,
  deleteFileFromStorage,
  // URL signing
  signStoragePath,
  attachSignedUrl,
  // Internal helpers (exported for testing)
  buildOfferData,
  toPublicOffer,
  snapToDoc,
};
