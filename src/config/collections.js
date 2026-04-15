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
 *  users              – one document per registered user (doc ID == user UID)
 *  financials         – one document per user (doc ID == userId)
 *  offers             – many documents per user (auto-generated doc IDs)
 *  mortgage_rates     – BOI average mortgage rates (doc ID == date or 'latest')
 *  community_profiles – anonymized user profiles for community intelligence
 *
 * Indexes
 * ───────
 *  users:              email (single-field, ascending) – for login lookup
 *  financials:         userId (single-field, ascending) – for profile fetch
 *  offers:             (userId ASC, createdAt DESC) – composite, for list queries
 *  mortgage_rates:     (date DESC) – for historical queries
 *  community_profiles: (incomeBin ASC) – for range queries
 *                      (incomeBin ASC, loanBin ASC) – compound for matching
 *                      profileHash (single-field) – for exact lookups
 */

'use strict';

// ─── Collection Names ────────────────────────────────────────────────────────

/** @type {Readonly<{USERS: string, FINANCIALS: string, OFFERS: string, MORTGAGE_RATES: string, COMMUNITY_PROFILES: string}>} */
const COLLECTIONS = Object.freeze({
  USERS: 'users',
  FINANCIALS: 'financials',
  OFFERS: 'offers',
  MORTGAGE_RATES: 'mortgage_rates',
  COMMUNITY_PROFILES: 'community_profiles',
});

// ─── Offer Status Enum ───────────────────────────────────────────────────────

/** @type {Readonly<{PENDING: string, ANALYZED: string, ERROR: string}>} */
const OFFER_STATUS = Object.freeze({
  PENDING: 'pending',
  ANALYZED: 'analyzed',
  ERROR: 'error',
});

// ─── Rates Source Enum ───────────────────────────────────────────────────────

/** @type {Readonly<{BOI: string, FALLBACK: string}>} */
const RATES_SOURCE = Object.freeze({
  BOI: 'bank_of_israel',
  FALLBACK: 'fallback',
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

/**
 * Build a new `mortgage_rates` document.
 *
 * @param {object} params
 * @param {string} params.date                - ISO date string of the fetch
 * @param {object} params.fetchPeriod         - Period covered
 * @param {string} params.fetchPeriod.start   - Start period (YYYY-MM)
 * @param {string} params.fetchPeriod.end     - End period (YYYY-MM)
 * @param {object} params.tracks              - Track data by type
 * @param {object} params.averages            - Flat averages { fixed, cpi, prime, variable }
 * @param {string} params.source              - Data source ('bank_of_israel' | 'fallback')
 * @param {string} [params.sourceUrl]         - URL of the data source
 * @returns {object} Firestore-ready mortgage_rates document
 */
function createMortgageRatesDocument({
  date,
  fetchPeriod,
  tracks,
  averages,
  source,
  sourceUrl = 'https://www.boi.org.il/en/economic-roles/statistics/',
}) {
  if (!date) throw new Error('createMortgageRatesDocument: date is required');
  if (!tracks || typeof tracks !== 'object') {
    throw new Error('createMortgageRatesDocument: tracks object is required');
  }
  if (!averages || typeof averages !== 'object') {
    throw new Error('createMortgageRatesDocument: averages object is required');
  }
  if (!source) throw new Error('createMortgageRatesDocument: source is required');

  return {
    date,
    fetchPeriod: fetchPeriod || null,
    tracks,
    averages: {
      fixed: averages.fixed ?? null,
      cpi: averages.cpi ?? null,
      prime: averages.prime ?? null,
      variable: averages.variable ?? null,
    },
    source,
    sourceUrl,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Build a new `community_profiles` document.
 *
 * Stores an anonymized user profile for community intelligence matching.
 * No PII is stored – only binned financial data and bank/branch/rates.
 *
 * @param {object} params
 * @param {string} params.profileHash       - SHA-256 hash of binned profile
 * @param {number} params.incomeBin         - Binned monthly income
 * @param {number} params.loanBin           - Binned loan amount
 * @param {number} params.ltvBin            - Binned LTV percentage
 * @param {number} params.stabilityBin      - Binned stability preference
 * @param {string} [params.bank]            - Bank name (Hebrew)
 * @param {string} [params.branch]          - Branch name (Hebrew)
 * @param {object} [params.rates]           - Actual rates received
 * @param {number} [params.rates.fixed]     - Fixed rate
 * @param {number} [params.rates.cpi]       - CPI-indexed rate
 * @param {number} [params.rates.prime]     - Prime rate
 * @param {number} [params.rates.variable]  - Variable rate
 * @param {number} [params.weightedRate]    - Weighted average rate
 * @returns {object} Firestore-ready community_profiles document
 */
function createCommunityProfileDocument({
  profileHash,
  incomeBin,
  loanBin,
  ltvBin,
  stabilityBin,
  bank = null,
  branch = null,
  rates = null,
  weightedRate = null,
}) {
  if (!profileHash) throw new Error('createCommunityProfileDocument: profileHash is required');
  if (incomeBin === undefined || incomeBin === null) {
    throw new Error('createCommunityProfileDocument: incomeBin is required');
  }
  if (loanBin === undefined || loanBin === null) {
    throw new Error('createCommunityProfileDocument: loanBin is required');
  }
  if (ltvBin === undefined || ltvBin === null) {
    throw new Error('createCommunityProfileDocument: ltvBin is required');
  }
  if (stabilityBin === undefined || stabilityBin === null) {
    throw new Error('createCommunityProfileDocument: stabilityBin is required');
  }

  const now = new Date().toISOString();
  return {
    profileHash,
    incomeBin: Number(incomeBin),
    loanBin: Number(loanBin),
    ltvBin: Number(ltvBin),
    stabilityBin: Number(stabilityBin),
    bank: bank || null,
    branch: branch || null,
    rates: rates || null,
    weightedRate: weightedRate != null ? Number(weightedRate) : null,
    consent: true,
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

/**
 * Validate a mortgage_rates document's required fields.
 *
 * @param {object} doc - Partial or full mortgage_rates document
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateMortgageRatesDocument(doc) {
  const errors = [];
  if (!doc.date || typeof doc.date !== 'string') errors.push('date must be a non-empty string');
  if (!doc.tracks || typeof doc.tracks !== 'object') errors.push('tracks must be an object');
  if (!doc.averages || typeof doc.averages !== 'object') errors.push('averages must be an object');
  if (!doc.source || typeof doc.source !== 'string') errors.push('source must be a non-empty string');

  // Validate track types if tracks exist
  if (doc.tracks && typeof doc.tracks === 'object') {
    const validTracks = ['fixed', 'cpi', 'prime', 'variable'];
    for (const key of Object.keys(doc.tracks)) {
      if (!validTracks.includes(key)) {
        errors.push(`tracks contains unknown track type: ${key}`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate a community_profiles document's required fields.
 *
 * @param {object} doc - Partial or full community_profiles document
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateCommunityProfileDocument(doc) {
  const errors = [];
  if (!doc.profileHash || typeof doc.profileHash !== 'string') {
    errors.push('profileHash must be a non-empty string');
  }
  if (typeof doc.incomeBin !== 'number' || doc.incomeBin < 0) {
    errors.push('incomeBin must be a non-negative number');
  }
  if (typeof doc.loanBin !== 'number' || doc.loanBin < 0) {
    errors.push('loanBin must be a non-negative number');
  }
  if (typeof doc.ltvBin !== 'number' || doc.ltvBin < 0) {
    errors.push('ltvBin must be a non-negative number');
  }
  if (typeof doc.stabilityBin !== 'number') {
    errors.push('stabilityBin must be a number');
  }
  if (doc.consent !== true) {
    errors.push('consent must be true');
  }
  if (doc.rates !== null && typeof doc.rates !== 'object') {
    errors.push('rates must be an object or null');
  }
  if (doc.weightedRate !== null && typeof doc.weightedRate !== 'number') {
    errors.push('weightedRate must be a number or null');
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
  {
    collection: COLLECTIONS.MORTGAGE_RATES,
    description: 'Single-field index on date (DESC) for latest rates query',
    fields: [{ fieldPath: 'date', order: 'DESCENDING' }],
    type: 'single',
  },
  {
    collection: COLLECTIONS.COMMUNITY_PROFILES,
    description: 'Single-field index on profileHash for exact lookups',
    fields: [{ fieldPath: 'profileHash', order: 'ASCENDING' }],
    type: 'single',
  },
  {
    collection: COLLECTIONS.COMMUNITY_PROFILES,
    description: 'Composite index on incomeBin (ASC) for range queries with ordering',
    fields: [{ fieldPath: 'incomeBin', order: 'ASCENDING' }],
    type: 'single',
  },
  {
    collection: COLLECTIONS.COMMUNITY_PROFILES,
    description: 'Composite index on incomeBin (ASC) + loanBin (ASC) for compound matching',
    fields: [
      { fieldPath: 'incomeBin', order: 'ASCENDING' },
      { fieldPath: 'loanBin', order: 'ASCENDING' },
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
    {
      collectionGroup: COLLECTIONS.COMMUNITY_PROFILES,
      queryScope: 'COLLECTION',
      fields: [
        { fieldPath: 'incomeBin', order: 'ASCENDING' },
        { fieldPath: 'loanBin', order: 'ASCENDING' },
      ],
    },
  ],
  fieldOverrides: [],
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Array of valid offer status strings (for quick includes() checks). */
const OFFER_STATUS_VALUES = Object.values(OFFER_STATUS);

/** Array of valid rates source strings. */
const RATES_SOURCE_VALUES = Object.values(RATES_SOURCE);

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  // Collection name constants
  COLLECTIONS,

  // Offer status enum
  OFFER_STATUS,
  OFFER_STATUS_VALUES,

  // Rates source enum
  RATES_SOURCE,
  RATES_SOURCE_VALUES,

  // Document factories
  createUserDocument,
  createFinancialDocument,
  createOfferDocument,
  createMortgageRatesDocument,
  createCommunityProfileDocument,

  // Field validators
  validateUserDocument,
  validateFinancialDocument,
  validateOfferDocument,
  validateMortgageRatesDocument,
  validateCommunityProfileDocument,

  // Index definitions (documentation + CLI config)
  INDEX_DEFINITIONS,
  FIRESTORE_INDEXES,
};
