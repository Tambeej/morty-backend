/**
 * Financial Service – Firestore CRUD for the `financials` collection.
 *
 * Each user has at most ONE financial profile document.
 * The Firestore document ID is set to the userId for O(1) lookups
 * (no secondary index needed for the common get-by-userId query).
 *
 * Document shape stored in Firestore:
 * {
 *   id:               string  (== userId, Firestore document ID)
 *   userId:           string  (required, indexed)
 *   income:           number  (required, >= 0)
 *   additionalIncome: number  (default 0)
 *   expenses: {
 *     housing:        number  (default 0)
 *     loans:          number  (default 0)
 *     other:          number  (default 0)
 *   }
 *   assets: {
 *     savings:        number  (default 0)
 *     investments:    number  (default 0)
 *   }
 *   debts: Array<{ type: string, amount: number }>
 *   updatedAt:        ISO string
 * }
 *
 * Public shape returned to callers is identical to the stored shape
 * (no sensitive fields to strip for financials).
 */

'use strict';

const db = require('../config/firestore');
const logger = require('../utils/logger');

/** Firestore collection name */
const COLLECTION = 'financials';

/** Reference to the financials collection */
const financialsRef = () => db.collection(COLLECTION);

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
 * Build a normalised financial data object with safe defaults.
 * Ensures all nested objects are present and numeric fields are numbers.
 *
 * @param {string} userId - Firestore user document ID
 * @param {Object} data   - Raw input data (from request body)
 * @returns {Object} Normalised financial document ready for Firestore
 */
function buildFinancialData(userId, data) {
  const {
    income = 0,
    additionalIncome = 0,
    expenses = {},
    assets = {},
    debts = [],
  } = data;

  return {
    id: userId,
    userId,
    income: Number(income) || 0,
    additionalIncome: Number(additionalIncome) || 0,
    expenses: {
      housing: Number(expenses.housing) || 0,
      loans: Number(expenses.loans) || 0,
      other: Number(expenses.other) || 0,
    },
    assets: {
      savings: Number(assets.savings) || 0,
      investments: Number(assets.investments) || 0,
    },
    debts: Array.isArray(debts)
      ? debts.map((d) => ({
          type: String(d.type || ''),
          amount: Number(d.amount) || 0,
        }))
      : [],
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Return the financial document as a plain object suitable for API responses.
 * Currently a pass-through (no sensitive fields), but kept for symmetry with
 * userService.toPublicUser and future extensibility.
 *
 * @param {Object|null} doc - Raw Firestore document data
 * @returns {Object|null}
 */
function toPublicFinancial(doc) {
  if (!doc) return null;
  return { ...doc };
}

// ── Read operations ───────────────────────────────────────────────────────────

/**
 * Retrieve the financial profile for a given user.
 *
 * Because the document ID equals the userId, this is a direct O(1) lookup.
 *
 * @param {string} userId - Firestore user document ID
 * @returns {Promise<Object|null>} Financial profile or null if not found
 */
async function getFinancials(userId) {
  if (!userId) return null;
  try {
    const snap = await financialsRef().doc(userId).get();
    return toPublicFinancial(snapToDoc(snap));
  } catch (err) {
    logger.error(`financialService.getFinancials error (userId=${userId}): ${err.message}`);
    throw err;
  }
}

// ── Write operations ──────────────────────────────────────────────────────────

/**
 * Create or update the financial profile for a user (upsert semantics).
 *
 * Uses Firestore `set` with `{ merge: false }` so the entire document is
 * replaced on every update – this prevents stale nested fields from
 * persisting when the client sends a partial update.
 *
 * @param {string} userId - Firestore user document ID
 * @param {Object} data   - Financial fields from the request body
 * @returns {Promise<Object>} The saved financial profile
 */
async function upsertFinancials(userId, data) {
  if (!userId) throw new Error('userId is required for upsertFinancials');

  const financialData = buildFinancialData(userId, data);

  try {
    await financialsRef().doc(userId).set(financialData);
    logger.info(`financialService.upsertFinancials: upserted financials for user ${userId}`);
    return toPublicFinancial(financialData);
  } catch (err) {
    logger.error(`financialService.upsertFinancials error (userId=${userId}): ${err.message}`);
    throw err;
  }
}

/**
 * Partially update specific fields of a user's financial profile.
 *
 * Unlike upsertFinancials, this only writes the provided fields.
 * Useful for targeted updates (e.g., updating only `income`).
 *
 * @param {string} userId  - Firestore user document ID
 * @param {Object} updates - Partial financial fields to update
 * @returns {Promise<Object>} The updated financial profile
 */
async function updateFinancials(userId, updates) {
  if (!userId) throw new Error('userId is required for updateFinancials');

  const safeUpdates = { ...updates, updatedAt: new Date().toISOString() };

  // Prevent overwriting the immutable id/userId fields
  delete safeUpdates.id;
  delete safeUpdates.userId;

  try {
    const docRef = financialsRef().doc(userId);
    const snap = await docRef.get();

    if (!snap.exists) {
      // Document doesn't exist yet – fall back to full upsert
      return upsertFinancials(userId, updates);
    }

    await docRef.update(safeUpdates);
    const updated = await docRef.get();
    return toPublicFinancial(snapToDoc(updated));
  } catch (err) {
    logger.error(`financialService.updateFinancials error (userId=${userId}): ${err.message}`);
    throw err;
  }
}

/**
 * Delete the financial profile for a user.
 *
 * @param {string} userId - Firestore user document ID
 * @returns {Promise<void>}
 */
async function deleteFinancials(userId) {
  if (!userId) throw new Error('userId is required for deleteFinancials');
  try {
    await financialsRef().doc(userId).delete();
    logger.info(`financialService.deleteFinancials: deleted financials for user ${userId}`);
  } catch (err) {
    logger.error(`financialService.deleteFinancials error (userId=${userId}): ${err.message}`);
    throw err;
  }
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  // Read
  getFinancials,
  // Write
  upsertFinancials,
  updateFinancials,
  deleteFinancials,
  // Internal helpers (exported for testing)
  buildFinancialData,
  toPublicFinancial,
};
