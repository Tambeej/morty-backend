/**
 * Firestore Collections Design
 *
 * This module is the single source of truth for:
 *  - Collection names (avoid magic strings throughout the codebase)
 *  - Document factory functions (create well-shaped documents)
 *  - Field-level validators (lightweight, synchronous checks)
 *  - Index definitions (documented here; applied via Firebase Console or
 *    firestore.indexes.json)
 *
 * Collections
 * ───────────
 *  users      – one document per registered user (doc ID == user UID)
 *  financials – one document per user (doc ID == userId)
 *  offers     – many documents per user (auto-generated doc IDs)
 *
 * Indexes
 * ───────
 *  users:      email (single-field, ascending) – for login lookup
 *  financials: userId (single-field, ascending) – for profile fetch
 *  offers:     (userId ASC, createdAt DESC) – composite, for list queries
 */

'use strict';

// ─── Collection Names ────────────────────────────────────────────────────────

/** @type {Readonly<{USERS: string, FINANCIALS: string, OFFERS: string}>} */
const COLLECTIONS = Object.freeze({
  USERS: 'users',
  FINANCIALS: 'financials',
  OFFERS: 'offers',
});

// ─── Offer Status Enum ───────────────────────────────────────────────────────

/** @type {Readonly<{PENDING: string, ANALYZED: string, ERROR: string}>} */
const OFFER_STATUS = Object.freeze({
  PENDING: 'pending',
  ANALYZED: 'analyzed',
  ERROR: 'error',
});

// ─── Document Factories ──────────────────────────────────────────────────────

/**
 * Build a new `users` document.
 *
 * @param {object} params
 * @param {string} params.id           - Firestore document ID (user UID)
 * @param {string} params.email        - Unique, lowercase email address
 * @param {string} params.password     - bcrypt-hashed password
 * @param {string} [params.phone]      - Phone number (default '')
 * @param {boolean} [params.verified]  - Email verified flag (default false)
 * @returns {object} Firestore-ready user document
 */
function createUserDocument({ id, email, password, phone = '', verified = false }) {
  if (!id) throw new Error('createUserDocument: id is required');
  if (!email) throw new Error('createUserDocument: email is required');
  if (!password) throw new Error('createUserDocument: password is required');

  const now = new Date().toISOString();
  return {
    id,
    email: email.toLowerCase().trim(),
    password,
    phone: phone || '',
    verified: Boolean(verified),
    refreshToken: null,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Build a new `financials` document.
 *
 * The document ID is always the userId so there is at most one financial
 * profile per user (upsert semantics).
 *
 * @param {object} params
 * @param {string} params.userId              - Owner's user ID (also the doc ID)
 * @param {number} params.income              - Primary monthly income (>= 0)
 * @param {number} [params.additionalIncome]  - Secondary income (default 0)
 * @param {object} [params.expenses]          - Expense breakdown
 * @param {number} [params.expenses.housing]  - Housing costs (default 0)
 * @param {number} [params.expenses.loans]    - Loan repayments (default 0)
 * @param {number} [params.expenses.other]    - Other expenses (default 0)
 * @param {object} [params.assets]            - Asset breakdown
 * @param {number} [params.assets.savings]    - Savings (default 0)
 * @param {number} [params.assets.investments]- Investments (default 0)
 * @param {Array}  [params.debts]             - Debt list [{type, amount}]
 * @returns {object} Firestore-ready financials document
 */
function createFinancialDocument({
  userId,
  income,
  additionalIncome = 0,
  expenses = {},
  assets = {},
  debts = [],
}) {
  if (!userId) throw new Error('createFinancialDocument: userId is required');
  if (income === undefined || income === null) {
    throw new Error('createFinancialDocument: income is required');
  }

  return {
    id: userId,
    userId,
    income: Number(income),
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
    debts: Array.isArray(debts) ? debts : [],
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Build a new `offers` document.
 *
 * @param {object} params
 * @param {string} params.id                        - Firestore document ID (auto-generated)
 * @param {string} params.userId                    - Owner's user ID
 * @param {object} params.originalFile              - Uploaded file metadata
 * @param {string} params.originalFile.url          - Cloudinary URL
 * @param {string} params.originalFile.mimetype     - MIME type
 * @param {object} [params.extractedData]           - AI-extracted mortgage data
 * @param {string} [params.extractedData.bank]      - Bank name
 * @param {number|null} [params.extractedData.amount] - Loan amount
 * @param {number|null} [params.extractedData.rate]   - Interest rate
 * @param {number|null} [params.extractedData.term]   - Loan term (months)
 * @param {object} [params.analysis]                - AI analysis results
 * @param {number|null} [params.analysis.recommendedRate] - Recommended rate
 * @param {number|null} [params.analysis.savings]         - Potential savings
 * @param {string} [params.analysis.aiReasoning]          - AI reasoning text
 * @param {string} [params.status]                  - Offer status (default 'pending')
 * @returns {object} Firestore-ready offer document
 */
function createOfferDocument({
  id,
  userId,
  originalFile,
  extractedData = {},
  analysis = {},
  status = OFFER_STATUS.PENDING,
}) {
  if (!id) throw new Error('createOfferDocument: id is required');
  if (!userId) throw new Error('createOfferDocument: userId is required');
  if (!originalFile || !originalFile.url) {
    throw new Error('createOfferDocument: originalFile.url is required');
  }
  if (!originalFile.mimetype) {
    throw new Error('createOfferDocument: originalFile.mimetype is required');
  }
  if (!OFFER_STATUS_VALUES.includes(status)) {
    throw new Error(`createOfferDocument: invalid status '${status}'`);
  }

  const now = new Date().toISOString();
  return {
    id,
    userId,
    originalFile: {
      url: originalFile.url,
      mimetype: originalFile.mimetype,
    },
    extractedData: {
      bank: extractedData.bank || '',
      amount: extractedData.amount !== undefined ? extractedData.amount : null,
      rate: extractedData.rate !== undefined ? extractedData.rate : null,
      term: extractedData.term !== undefined ? extractedData.term : null,
    },
    analysis: {
      recommendedRate: analysis.recommendedRate !== undefined ? analysis.recommendedRate : null,
      savings: analysis.savings !== undefined ? analysis.savings : null,
      aiReasoning: analysis.aiReasoning || '',
    },
    status,
    createdAt: now,
    updatedAt: now,
  };
}

// ─── Field Validators ────────────────────────────────────────────────────────

/**
 * Validate a user document's required fields.
 *
 * @param {object} doc - Partial or full user document
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateUserDocument(doc) {
  const errors = [];
  if (!doc.id || typeof doc.id !== 'string') errors.push('id must be a non-empty string');
  if (!doc.email || typeof doc.email !== 'string') errors.push('email must be a non-empty string');
  if (!doc.password || typeof doc.password !== 'string') errors.push('password must be a non-empty string');
  if (typeof doc.verified !== 'boolean') errors.push('verified must be a boolean');
  return { valid: errors.length === 0, errors };
}

/**
 * Validate a financials document's required fields.
 *
 * @param {object} doc - Partial or full financials document
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateFinancialDocument(doc) {
  const errors = [];
  if (!doc.userId || typeof doc.userId !== 'string') errors.push('userId must be a non-empty string');
  if (typeof doc.income !== 'number' || doc.income < 0) errors.push('income must be a non-negative number');
  if (doc.expenses) {
    ['housing', 'loans', 'other'].forEach((key) => {
      if (doc.expenses[key] !== undefined && typeof doc.expenses[key] !== 'number') {
        errors.push(`expenses.${key} must be a number`);
      }
    });
  }
  if (doc.assets) {
    ['savings', 'investments'].forEach((key) => {
      if (doc.assets[key] !== undefined && typeof doc.assets[key] !== 'number') {
        errors.push(`assets.${key} must be a number`);
      }
    });
  }
  if (doc.debts !== undefined && !Array.isArray(doc.debts)) {
    errors.push('debts must be an array');
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Validate an offer document's required fields.
 *
 * @param {object} doc - Partial or full offer document
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateOfferDocument(doc) {
  const errors = [];
  if (!doc.id || typeof doc.id !== 'string') errors.push('id must be a non-empty string');
  if (!doc.userId || typeof doc.userId !== 'string') errors.push('userId must be a non-empty string');
  if (!doc.originalFile || !doc.originalFile.url) errors.push('originalFile.url is required');
  if (!doc.originalFile || !doc.originalFile.mimetype) errors.push('originalFile.mimetype is required');
  if (!OFFER_STATUS_VALUES.includes(doc.status)) {
    errors.push(`status must be one of: ${OFFER_STATUS_VALUES.join(', ')}`);
  }
  return { valid: errors.length === 0, errors };
}

// ─── Index Definitions (documentation) ──────────────────────────────────────

/**
 * Firestore index definitions.
 *
 * These are applied via the Firebase Console or firestore.indexes.json.
 * They are documented here for reference and used by initCollections.js.
 *
 * @type {Array<object>}
 */
const INDEX_DEFINITIONS = Object.freeze([
  {
    collection: COLLECTIONS.USERS,
    description: 'Single-field index on email for login lookup',
    fields: [{ fieldPath: 'email', order: 'ASCENDING' }],
    type: 'single',
  },
  {
    collection: COLLECTIONS.FINANCIALS,
    description: 'Single-field index on userId for profile fetch',
    fields: [{ fieldPath: 'userId', order: 'ASCENDING' }],
    type: 'single',
  },
  {
    collection: COLLECTIONS.OFFERS,
    description: 'Composite index on userId (ASC) + createdAt (DESC) for offer list queries',
    fields: [
      { fieldPath: 'userId', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'DESCENDING' },
    ],
    type: 'composite',
  },
]);

// ─── Firestore Index Configuration (firestore.indexes.json format) ───────────

/**
 * Composite index configuration in Firestore CLI format.
 * Can be written to firestore.indexes.json for deployment.
 */
const FIRESTORE_INDEXES = Object.freeze({
  indexes: [
    {
      collectionGroup: COLLECTIONS.OFFERS,
      queryScope: 'COLLECTION',
      fields: [
        { fieldPath: 'userId', order: 'ASCENDING' },
        { fieldPath: 'createdAt', order: 'DESCENDING' },
      ],
    },
  ],
  fieldOverrides: [],
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Array of valid offer status strings (for quick includes() checks). */
const OFFER_STATUS_VALUES = Object.values(OFFER_STATUS);

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  // Collection name constants
  COLLECTIONS,

  // Offer status enum
  OFFER_STATUS,
  OFFER_STATUS_VALUES,

  // Document factories
  createUserDocument,
  createFinancialDocument,
  createOfferDocument,

  // Field validators
  validateUserDocument,
  validateFinancialDocument,
  validateOfferDocument,

  // Index definitions (documentation + CLI config)
  INDEX_DEFINITIONS,
  FIRESTORE_INDEXES,
};
