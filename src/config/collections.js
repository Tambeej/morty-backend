'use strict';

/**
 * Firestore collection names.
 * Centralised to avoid magic strings throughout the codebase.
 */
const COLLECTIONS = {
  USERS: 'users',
  OFFERS: 'offers',
  PORTFOLIOS: 'portfolios',
  RATES: 'rates',
  MORTGAGE_RATES: 'rates',
  WIZARD_INPUTS: 'wizardInputs',
  FINANCIAL_PROFILES: 'financialProfiles',
  COMMUNITY_PORTFOLIOS: 'communityPortfolios',
  COMMUNITY_PROFILES: 'community_profiles',
};

// Support both `const COLLECTIONS = require('./collections')`
// and `const { COLLECTIONS } = require('./collections')`.
module.exports = COLLECTIONS;
module.exports.COLLECTIONS = COLLECTIONS;
