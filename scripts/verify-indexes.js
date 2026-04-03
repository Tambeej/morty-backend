/**
 * Firestore Index Verification Script
 *
 * This script documents and verifies the Firestore indexes required by the
 * Morty backend application.  It can be run standalone to print a summary
 * of required indexes, or imported as a module to perform runtime checks.
 *
 * Usage:
 *   node scripts/verify-indexes.js
 *
 * The authoritative index definitions live in `firestore.indexes.json`.
 * Deploy them with the Firebase CLI:
 *
 *   firebase deploy --only firestore:indexes
 *
 * Or create them manually in the Firebase Console:
 *   https://console.firebase.google.com/project/<PROJECT_ID>/firestore/indexes
 */

'use strict';

/**
 * Describes every Firestore index required by the application.
 *
 * Each entry maps to a query pattern used in the service layer.
 *
 * @type {Array<{
 *   collection: string,
 *   type: 'composite'|'single-field',
 *   fields: Array<{ field: string, direction: 'ASC'|'DESC' }>,
 *   usedBy: string[],
 *   notes?: string
 * }>}
 */
const REQUIRED_INDEXES = [
  // ── offers collection ──────────────────────────────────────────────────────
  {
    collection: 'offers',
    type: 'composite',
    fields: [
      { field: 'userId',    direction: 'ASC'  },
      { field: 'createdAt', direction: 'DESC' },
    ],
    usedBy: [
      'offerService.listOffersByUser  – .where(userId).orderBy(createdAt, desc)',
      'offerService.getRecentOffers   – .where(userId).orderBy(createdAt, desc).limit(n)',
    ],
    notes:
      'Most critical index. Without it, Firestore will reject the query with ' +
      '"The query requires an index" error.',
  },
  {
    collection: 'offers',
    type: 'composite',
    fields: [
      { field: 'userId', direction: 'ASC' },
      { field: 'status', direction: 'ASC' },
    ],
    usedBy: [
      'offerService.countOffersByUser – .where(userId).where(status)',
    ],
    notes:
      'Required when filtering by both userId and status simultaneously.',
  },
  {
    collection: 'offers',
    type: 'composite',
    fields: [
      { field: 'userId',    direction: 'ASC'  },
      { field: 'status',    direction: 'ASC'  },
      { field: 'createdAt', direction: 'DESC' },
    ],
    usedBy: [
      'Future: filtered + sorted offer listing (e.g., only analyzed offers)',
    ],
    notes:
      'Supports future queries that filter by status and sort by date.',
  },

  // ── users collection ───────────────────────────────────────────────────────
  {
    collection: 'users',
    type: 'single-field',
    fields: [
      { field: 'email', direction: 'ASC' },
    ],
    usedBy: [
      'userService.findByEmail – .where(email, ==, value).limit(1)',
    ],
    notes:
      'Firestore creates single-field indexes automatically by default. ' +
      'Explicitly listed here for documentation and to ensure it is not ' +
      'accidentally disabled via a fieldOverride.',
  },
  {
    collection: 'users',
    type: 'single-field',
    fields: [
      { field: 'refreshToken', direction: 'ASC' },
    ],
    usedBy: [
      'userService.findByRefreshToken – .where(refreshToken, ==, value).limit(1)',
    ],
    notes:
      'Enables O(log n) lookup of users by refresh token during token rotation.',
  },

  // ── financials collection ──────────────────────────────────────────────────
  {
    collection: 'financials',
    type: 'single-field',
    fields: [
      { field: 'userId', direction: 'ASC' },
    ],
    usedBy: [
      'financialService.getFinancials – direct doc(userId) lookup (O(1), no index needed)',
    ],
    notes:
      'The financials document ID equals the userId, so all reads are direct ' +
      'document lookups (no query index required). Listed here for completeness.',
  },
];

/**
 * Print a human-readable summary of all required indexes to stdout.
 */
function printIndexSummary() {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  Morty Backend – Required Firestore Indexes');
  console.log('═══════════════════════════════════════════════════════════════\n');

  REQUIRED_INDEXES.forEach((idx, i) => {
    const fieldStr = idx.fields
      .map((f) => `${f.field} ${f.direction}`)
      .join(', ');

    console.log(`[${i + 1}] Collection : ${idx.collection}`);
    console.log(`    Type       : ${idx.type}`);
    console.log(`    Fields     : ${fieldStr}`);
    console.log(`    Used by    :`);
    idx.usedBy.forEach((u) => console.log(`                 • ${u}`));
    if (idx.notes) {
      console.log(`    Notes      : ${idx.notes}`);
    }
    console.log();
  });

  console.log('Deploy indexes via Firebase CLI:');
  console.log('  firebase deploy --only firestore:indexes');
  console.log();
  console.log('Or create manually in Firebase Console:');
  console.log('  https://console.firebase.google.com/project/<PROJECT_ID>/firestore/indexes');
  console.log('═══════════════════════════════════════════════════════════════\n');
}

/**
 * Validate that the REQUIRED_INDEXES array is internally consistent.
 * Throws if any entry is malformed.
 *
 * @returns {boolean} true when all entries are valid
 */
function validateIndexDefinitions() {
  const errors = [];

  REQUIRED_INDEXES.forEach((idx, i) => {
    if (!idx.collection || typeof idx.collection !== 'string') {
      errors.push(`Index[${i}]: missing or invalid 'collection'`);
    }
    if (!['composite', 'single-field'].includes(idx.type)) {
      errors.push(`Index[${i}]: invalid type '${idx.type}'`);
    }
    if (!Array.isArray(idx.fields) || idx.fields.length === 0) {
      errors.push(`Index[${i}]: 'fields' must be a non-empty array`);
    } else {
      idx.fields.forEach((f, fi) => {
        if (!f.field || typeof f.field !== 'string') {
          errors.push(`Index[${i}].fields[${fi}]: missing 'field'`);
        }
        if (!['ASC', 'DESC'].includes(f.direction)) {
          errors.push(`Index[${i}].fields[${fi}]: invalid direction '${f.direction}'`);
        }
      });
    }
    if (!Array.isArray(idx.usedBy) || idx.usedBy.length === 0) {
      errors.push(`Index[${i}]: 'usedBy' must be a non-empty array`);
    }
  });

  if (errors.length > 0) {
    throw new Error(
      `Firestore index definition errors:\n${errors.map((e) => `  • ${e}`).join('\n')}`
    );
  }

  return true;
}

/**
 * Return the list of composite indexes (those requiring explicit creation
 * in Firestore – single-field indexes are auto-created by default).
 *
 * @returns {Array} Composite index definitions
 */
function getCompositeIndexes() {
  return REQUIRED_INDEXES.filter((idx) => idx.type === 'composite');
}

/**
 * Return the list of single-field index definitions.
 *
 * @returns {Array} Single-field index definitions
 */
function getSingleFieldIndexes() {
  return REQUIRED_INDEXES.filter((idx) => idx.type === 'single-field');
}

// ── Module exports ────────────────────────────────────────────────────────────

module.exports = {
  REQUIRED_INDEXES,
  validateIndexDefinitions,
  getCompositeIndexes,
  getSingleFieldIndexes,
  printIndexSummary,
};

// ── CLI entry point ───────────────────────────────────────────────────────────

if (require.main === module) {
  try {
    validateIndexDefinitions();
    printIndexSummary();
    process.exit(0);
  } catch (err) {
    console.error('ERROR:', err.message);
    process.exit(1);
  }
}
