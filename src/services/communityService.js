/**
 * Community Intelligence Service
 *
 * Implements the "Community Intelligence" engine that transitions from
 * static Bank of Israel benchmarks to dynamic user-contributed data.
 *
 * Core Capabilities:
 *   1. **Profile Hashing**: Generates a deterministic SHA-256 hash from
 *      normalized/binned user profile data (income, loan amount, LTV, etc.)
 *      to enable anonymous matching without storing PII.
 *
 *   2. **Similar Profile Matching**: Queries the `community_profiles`
 *      Firestore collection using range queries on binned fields
 *      (income ±10%, loan ±20%) to find users with similar financial profiles.
 *
 *   3. **Winning Offer Identification**: Aggregates matched profiles to
 *      identify which bank/branch combinations provided the best rates
 *      for similar users. Produces hyper-local recommendations like:
 *      "Users with your profile recently secured better rates at
 *       Leumi Herzliya."
 *
 *   4. **Anonymous Storage**: When users consent, stores their anonymized
 *      profile (binned fields + bank/branch/rates) for future matching.
 *      No PII is ever stored in community_profiles.
 *
 * Data Model (community_profiles):
 *   - profileHash: SHA-256 of normalized binned profile
 *   - incomeBin: binned monthly income (e.g., 15000)
 *   - loanBin: binned loan amount (e.g., 1000000)
 *   - ltvBin: binned LTV percentage (e.g., 60)
 *   - stabilityBin: binned stability preference (e.g., 7)
 *   - bank: bank name (Hebrew)
 *   - branch: branch name (Hebrew)
 *   - rates: { fixed, cpi, prime, variable } – actual rates received
 *   - weightedRate: single weighted average rate for quick comparison
 *   - consent: always true (only stored if user consented)
 *   - createdAt: ISO timestamp
 *
 * @module communityService
 */

'use strict';

const crypto = require('crypto');
const db = require('../config/firestore');
const logger = require('../utils/logger');
const { COLLECTIONS } = require('../config/collections');

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * Bin sizes for normalizing profile fields.
 * Binning ensures that similar (but not identical) values map to the same
 * bucket, enabling efficient Firestore equality queries.
 */
const BIN_SIZES = Object.freeze({
  /** Income binned to nearest ₪5,000 */
  INCOME: 5000,
  /** Loan amount binned to nearest ₪50,000 */
  LOAN: 50000,
  /** LTV binned to nearest 5% */
  LTV: 5,
  /** Stability preference binned to nearest 2 (1-2, 3-4, 5-6, 7-8, 9-10) */
  STABILITY: 2,
});

/**
 * Range multipliers for fuzzy matching.
 * When querying similar profiles, we search within these ranges
 * around the user's binned values.
 */
const MATCH_RANGES = Object.freeze({
  /** Income: ±10% (architecture spec) */
  INCOME_TOLERANCE: 0.10,
  /** Loan: ±20% (architecture spec) */
  LOAN_TOLERANCE: 0.20,
  /** LTV: ±10 percentage points */
  LTV_TOLERANCE: 10,
  /** Stability: ±2 points */
  STABILITY_TOLERANCE: 2,
});

/** Maximum number of similar profiles to fetch for aggregation */
const MAX_MATCH_RESULTS = 100;

/** Maximum number of community tips to return */
const MAX_TIPS = 3;

/** Minimum number of matching profiles required to generate a tip */
const MIN_PROFILES_FOR_TIP = 2;

/** Cache TTL for community aggregation results: 30 minutes */
const COMMUNITY_CACHE_TTL_MS = 30 * 60 * 1000;

/** Firestore collection reference helper */
const communityRef = () => db.collection(COLLECTIONS.COMMUNITY_PROFILES);

// ── In-Memory Cache ───────────────────────────────────────────────────────────

/**
 * Simple in-memory cache for community aggregation results.
 * Keyed by profile hash, stores { tips, timestamp }.
 * Prevents redundant Firestore queries for identical profiles.
 */
const _cache = new Map();

/**
 * Clear the community tips cache.
 * Useful for testing and after new profile storage.
 */
function clearCache() {
  _cache.clear();
}

/**
 * Get a cached result if still valid.
 * @param {string} cacheKey - Cache key (typically profile hash)
 * @returns {Array|null} Cached tips or null if expired/missing
 */
function getCached(cacheKey) {
  const entry = _cache.get(cacheKey);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > COMMUNITY_CACHE_TTL_MS) {
    _cache.delete(cacheKey);
    return null;
  }
  return entry.tips;
}

/**
 * Store a result in the cache.
 * @param {string} cacheKey - Cache key
 * @param {Array} tips - Community tips to cache
 */
function setCache(cacheKey, tips) {
  // Limit cache size to prevent memory leaks
  if (_cache.size > 1000) {
    // Evict oldest entries
    const keysToDelete = [];
    let count = 0;
    for (const [key] of _cache) {
      if (count++ < 200) keysToDelete.push(key);
      else break;
    }
    keysToDelete.forEach((k) => _cache.delete(k));
  }
  _cache.set(cacheKey, { tips, timestamp: Date.now() });
}

// ── Binning Functions ─────────────────────────────────────────────────────────

/**
 * Bin a numeric value to the nearest multiple of the bin size.
 * This normalizes values so that similar amounts map to the same bucket.
 *
 * @param {number} value - Raw numeric value
 * @param {number} binSize - Bin size (e.g., 5000 for income)
 * @returns {number} Binned value
 *
 * @example
 * binValue(17500, 5000) // → 15000
 * binValue(18000, 5000) // → 20000
 * binValue(1250000, 50000) // → 1250000
 */
function binValue(value, binSize) {
  if (!value || !binSize || binSize <= 0) return 0;
  return Math.round(value / binSize) * binSize;
}

/**
 * Compute binned profile fields from raw wizard inputs.
 *
 * @param {object} inputs - Wizard inputs
 * @param {number} inputs.monthlyIncome - Primary monthly income
 * @param {number} [inputs.additionalIncome=0] - Additional income
 * @param {number} inputs.loanAmount - Requested loan amount
 * @param {number} inputs.propertyPrice - Property price
 * @param {number} inputs.stabilityPreference - Stability slider (1-10)
 * @returns {object} Binned profile fields
 */
function computeBinnedProfile(inputs) {
  const totalIncome = (inputs.monthlyIncome || 0) + (inputs.additionalIncome || 0);
  const ltv = inputs.propertyPrice > 0
    ? (inputs.loanAmount / inputs.propertyPrice) * 100
    : 0;

  return {
    incomeBin: binValue(totalIncome, BIN_SIZES.INCOME),
    loanBin: binValue(inputs.loanAmount, BIN_SIZES.LOAN),
    ltvBin: binValue(ltv, BIN_SIZES.LTV),
    stabilityBin: binValue(inputs.stabilityPreference, BIN_SIZES.STABILITY),
  };
}

// ── Profile Hashing ───────────────────────────────────────────────────────────

/**
 * Generate a deterministic SHA-256 hash from binned profile fields.
 *
 * The hash is computed from a sorted, normalized string representation
 * of the binned fields. This ensures:
 *   - Identical profiles always produce the same hash
 *   - No PII is recoverable from the hash
 *   - The hash is stable across different JS engine property orderings
 *
 * @param {object} binnedProfile - Binned profile from computeBinnedProfile()
 * @returns {string} Hex-encoded SHA-256 hash
 */
function hashProfile(binnedProfile) {
  // Sort keys for deterministic ordering
  const sortedKeys = Object.keys(binnedProfile).sort();
  const normalized = sortedKeys
    .map((key) => `${key}:${binnedProfile[key]}`)
    .join('|');

  return crypto
    .createHash('sha256')
    .update(normalized)
    .digest('hex');
}

// ── Similar Profile Matching ──────────────────────────────────────────────────

/**
 * Find community profiles similar to the given wizard inputs.
 *
 * Uses a two-phase approach:
 *   Phase 1: Query Firestore with the primary range filter (incomeBin)
 *            using Firestore's native range query capability.
 *   Phase 2: Filter results in-memory for loanBin, ltvBin, and
 *            stabilityBin ranges (Firestore only supports one range
 *            filter per query on different fields).
 *
 * Architecture spec: income ±10%, loan ±20%
 *
 * @param {object} inputs - Wizard inputs
 * @returns {Promise<Array<object>>} Matching community profiles
 */
async function findSimilarProfiles(inputs) {
  const binned = computeBinnedProfile(inputs);

  // Calculate range bounds
  const totalIncome = (inputs.monthlyIncome || 0) + (inputs.additionalIncome || 0);
  const incomeMin = binValue(
    totalIncome * (1 - MATCH_RANGES.INCOME_TOLERANCE),
    BIN_SIZES.INCOME
  );
  const incomeMax = binValue(
    totalIncome * (1 + MATCH_RANGES.INCOME_TOLERANCE),
    BIN_SIZES.INCOME
  );

  const loanMin = binValue(
    inputs.loanAmount * (1 - MATCH_RANGES.LOAN_TOLERANCE),
    BIN_SIZES.LOAN
  );
  const loanMax = binValue(
    inputs.loanAmount * (1 + MATCH_RANGES.LOAN_TOLERANCE),
    BIN_SIZES.LOAN
  );

  const ltvMin = binned.ltvBin - MATCH_RANGES.LTV_TOLERANCE;
  const ltvMax = binned.ltvBin + MATCH_RANGES.LTV_TOLERANCE;

  const stabilityMin = Math.max(1, binned.stabilityBin - MATCH_RANGES.STABILITY_TOLERANCE);
  const stabilityMax = Math.min(10, binned.stabilityBin + MATCH_RANGES.STABILITY_TOLERANCE);

  logger.debug('communityService.findSimilarProfiles: query ranges', {
    incomeBin: binned.incomeBin,
    incomeRange: [incomeMin, incomeMax],
    loanBin: binned.loanBin,
    loanRange: [loanMin, loanMax],
    ltvBin: binned.ltvBin,
    ltvRange: [ltvMin, ltvMax],
    stabilityBin: binned.stabilityBin,
    stabilityRange: [stabilityMin, stabilityMax],
  });

  try {
    // Phase 1: Firestore query with incomeBin range + loanBin range
    // Firestore supports range filters on a single field in a compound query,
    // but we can use >= and <= on the same field.
    // We use incomeBin as the primary range filter since it's the most
    // discriminating field, then filter the rest in-memory.
    const snapshot = await communityRef()
      .where('incomeBin', '>=', incomeMin)
      .where('incomeBin', '<=', incomeMax)
      .orderBy('incomeBin', 'asc')
      .limit(MAX_MATCH_RESULTS)
      .get();

    if (snapshot.empty) {
      logger.debug('communityService.findSimilarProfiles: no matches found in Firestore');
      return [];
    }

    // Phase 2: In-memory filtering for remaining dimensions
    const matches = [];
    snapshot.forEach((doc) => {
      const data = doc.data();
      // Skip sentinel documents
      if (data._sentinel) return;

      // Filter by loan range
      if (data.loanBin < loanMin || data.loanBin > loanMax) return;

      // Filter by LTV range
      if (data.ltvBin < ltvMin || data.ltvBin > ltvMax) return;

      // Filter by stability range
      if (data.stabilityBin < stabilityMin || data.stabilityBin > stabilityMax) return;

      matches.push({ id: doc.id, ...data });
    });

    logger.info(`communityService.findSimilarProfiles: ${matches.length} matches from ${snapshot.size} candidates`);
    return matches;
  } catch (err) {
    logger.error(`communityService.findSimilarProfiles: query error: ${err.message}`);
    // Degrade gracefully – return empty array so wizard still works
    return [];
  }
}

// ── Winning Offer Aggregation ─────────────────────────────────────────────────

/**
 * Aggregate matched profiles to identify winning bank/branch offers.
 *
 * Groups profiles by bank+branch, computes average weighted rate for
 * each group, and ranks them. A "winning" offer is one where the
 * average rate is lower than the overall average across all matches.
 *
 * @param {Array<object>} profiles - Matched community profiles
 * @returns {Array<object>} Ranked bank/branch offers, best first
 */
function aggregateWinningOffers(profiles) {
  if (!profiles || profiles.length === 0) return [];

  // Group by bank + branch
  const groups = new Map();

  for (const profile of profiles) {
    if (!profile.bank) continue;

    const key = `${profile.bank}|${profile.branch || 'כללי'}`;

    if (!groups.has(key)) {
      groups.set(key, {
        bank: profile.bank,
        branch: profile.branch || 'כללי',
        rates: [],
        weightedRates: [],
        count: 0,
        latestDate: null,
      });
    }

    const group = groups.get(key);
    group.count += 1;

    if (profile.weightedRate != null && !isNaN(profile.weightedRate)) {
      group.weightedRates.push(profile.weightedRate);
    }

    if (profile.rates) {
      group.rates.push(profile.rates);
    }

    // Track the most recent contribution
    if (profile.createdAt) {
      if (!group.latestDate || profile.createdAt > group.latestDate) {
        group.latestDate = profile.createdAt;
      }
    }
  }

  // Compute averages and rank
  const ranked = [];

  for (const [, group] of groups) {
    if (group.weightedRates.length === 0) continue;

    const avgWeightedRate =
      group.weightedRates.reduce((sum, r) => sum + r, 0) / group.weightedRates.length;

    // Compute average rates per track type
    const avgRates = computeAverageRates(group.rates);

    ranked.push({
      bank: group.bank,
      branch: group.branch,
      avgWeightedRate: Math.round(avgWeightedRate * 100) / 100,
      avgRates,
      profileCount: group.count,
      latestDate: group.latestDate,
    });
  }

  // Sort by average weighted rate (ascending = best first)
  ranked.sort((a, b) => a.avgWeightedRate - b.avgWeightedRate);

  return ranked;
}

/**
 * Compute average rates per track type from an array of rate objects.
 *
 * @param {Array<object>} ratesArray - Array of { fixed, cpi, prime, variable } objects
 * @returns {object} Average rates per track type
 */
function computeAverageRates(ratesArray) {
  if (!ratesArray || ratesArray.length === 0) return {};

  const sums = { fixed: 0, cpi: 0, prime: 0, variable: 0 };
  const counts = { fixed: 0, cpi: 0, prime: 0, variable: 0 };

  for (const rates of ratesArray) {
    for (const track of ['fixed', 'cpi', 'prime', 'variable']) {
      if (rates[track] != null && !isNaN(rates[track])) {
        sums[track] += rates[track];
        counts[track] += 1;
      }
    }
  }

  const averages = {};
  for (const track of ['fixed', 'cpi', 'prime', 'variable']) {
    if (counts[track] > 0) {
      averages[track] = Math.round((sums[track] / counts[track]) * 100) / 100;
    }
  }

  return averages;
}

// ── Community Tips Generation ─────────────────────────────────────────────────

/**
 * Generate community tips from matched profiles.
 *
 * Produces up to 3 actionable tips based on community data:
 *   1. Best bank/branch recommendation (hyper-local)
 *   2. Rate comparison insight (how community rates compare to BOI averages)
 *   3. Profile popularity insight (how many similar users exist)
 *
 * Per architecture spec:
 *   "If a specific bank branch provided a superior offer, explicitly state:
 *    'Users with your profile recently secured better rates at
 *     [Bank Name] - [Branch Name].'"
 *
 * @param {Array<object>} profiles - Matched community profiles
 * @param {object} [currentRates] - Current BOI average rates for comparison
 * @returns {Array<object>} Community tips (max 3)
 */
function generateCommunityTips(profiles, currentRates) {
  if (!profiles || profiles.length < MIN_PROFILES_FOR_TIP) {
    return [];
  }

  const tips = [];
  const rankedOffers = aggregateWinningOffers(profiles);

  // Tip 1: Best bank/branch recommendation (hyper-local)
  if (rankedOffers.length > 0) {
    const best = rankedOffers[0];
    const recentLabel = best.latestDate
      ? formatRecency(best.latestDate)
      : 'לאחרונה';

    tips.push({
      type: 'winning_offer',
      priority: 1,
      bank: best.bank,
      branch: best.branch,
      avgWeightedRate: best.avgWeightedRate,
      avgRates: best.avgRates,
      profileCount: best.profileCount,
      recency: recentLabel,
      messageHe: `משתמשים עם פרופיל דומה קיבלו ${recentLabel} ריבית טובה יותר ב-${best.bank} – ${best.branch}`,
      messageEn: `Users with your profile recently secured better rates at ${best.bank} – ${best.branch}`,
    });
  }

  // Tip 2: Rate comparison with BOI averages
  if (rankedOffers.length > 0 && currentRates) {
    const best = rankedOffers[0];
    const rateComparisons = [];

    for (const track of ['fixed', 'cpi', 'prime']) {
      const communityRate = best.avgRates[track];
      const boiRate = currentRates[track];

      if (communityRate != null && boiRate != null) {
        const diff = Math.round((boiRate - communityRate) * 100) / 100;
        if (diff > 0) {
          rateComparisons.push({
            track,
            communityRate,
            boiRate,
            savingBps: Math.round(diff * 100),
          });
        }
      }
    }

    if (rateComparisons.length > 0) {
      const bestSaving = rateComparisons.sort((a, b) => b.savingBps - a.savingBps)[0];
      const trackNameHe = {
        fixed: 'קל"צ',
        cpi: 'צמוד מדד',
        prime: 'פריים',
        variable: 'משתנה',
      };

      tips.push({
        type: 'rate_comparison',
        priority: 2,
        comparisons: rateComparisons,
        messageHe: `משתמשים דומים קיבלו ריבית ${trackNameHe[bestSaving.track] || bestSaving.track} נמוכה ב-${(bestSaving.savingBps / 100).toFixed(2)}% מהממוצע בבנק ישראל`,
        messageEn: `Similar users received ${bestSaving.track} rates ${(bestSaving.savingBps / 100).toFixed(2)}% below the Bank of Israel average`,
      });
    }
  }

  // Tip 3: Community size / confidence indicator
  if (profiles.length >= 5) {
    tips.push({
      type: 'community_size',
      priority: 3,
      matchCount: profiles.length,
      bankCount: new Set(profiles.map((p) => p.bank).filter(Boolean)).size,
      messageHe: `ניתוח מבוסס על ${profiles.length} משתמשים עם פרופיל דומה`,
      messageEn: `Analysis based on ${profiles.length} users with a similar profile`,
    });
  }

  // Sort by priority and limit
  return tips
    .sort((a, b) => a.priority - b.priority)
    .slice(0, MAX_TIPS);
}

/**
 * Format a date string into a Hebrew recency label.
 *
 * @param {string} dateStr - ISO date string
 * @returns {string} Hebrew recency label
 */
function formatRecency(dateStr) {
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));

    if (diffDays <= 7) return 'השבוע';
    if (diffDays <= 30) return 'החודש';
    if (diffDays <= 90) return 'לאחרונה';
    return 'לאחרונה';
  } catch {
    return 'לאחרונה';
  }
}

// ── Main Entry Point ──────────────────────────────────────────────────────────

/**
 * Get community intelligence tips for the given wizard inputs.
 *
 * This is the main entry point called by the wizard controller.
 * It orchestrates profile matching, aggregation, and tip generation.
 *
 * @param {object} inputs - Validated wizard inputs
 * @param {object} [currentRates] - Current BOI average rates (for comparison tips)
 * @returns {Promise<Array<object>>} Community tips (may be empty if insufficient data)
 */
async function getCommunityTips(inputs, currentRates) {
  const startTime = Date.now();

  try {
    // Compute binned profile and hash for caching
    const binned = computeBinnedProfile(inputs);
    const profileHash = hashProfile(binned);

    // Check cache first
    const cached = getCached(profileHash);
    if (cached) {
      logger.debug('communityService.getCommunityTips: returning cached tips');
      return cached;
    }

    // Find similar profiles
    const similarProfiles = await findSimilarProfiles(inputs);

    // Generate tips
    const tips = generateCommunityTips(similarProfiles, currentRates);

    // Cache the result
    setCache(profileHash, tips);

    const elapsed = Date.now() - startTime;
    logger.info(`communityService.getCommunityTips: ${tips.length} tips generated in ${elapsed}ms from ${similarProfiles.length} matches`);

    return tips;
  } catch (err) {
    logger.error(`communityService.getCommunityTips: error: ${err.message}`);
    // Degrade gracefully – return empty tips so wizard still works
    return [];
  }
}

// ── Anonymous Profile Storage ─────────────────────────────────────────────────

/**
 * Store an anonymized community profile when the user has consented.
 *
 * This is called after portfolio generation when consent === true.
 * The stored profile contains ONLY binned/hashed data and the
 * bank/branch/rates from the user's actual offer (if available).
 *
 * For wizard submissions (no actual bank offer yet), we store the
 * profile with placeholder bank/rates that will be updated later
 * when the user uploads their actual bank offer.
 *
 * @param {object} inputs - Wizard inputs
 * @param {object} [bankOffer] - Optional bank offer data
 * @param {string} [bankOffer.bank] - Bank name
 * @param {string} [bankOffer.branch] - Branch name
 * @param {object} [bankOffer.rates] - Actual rates { fixed, cpi, prime, variable }
 * @returns {Promise<string|null>} Document ID of stored profile, or null on failure
 */
async function storeAnonymousProfile(inputs, bankOffer) {
  try {
    const binned = computeBinnedProfile(inputs);
    const profileHash = hashProfile(binned);

    const now = new Date().toISOString();

    // Compute weighted average rate if rates are provided
    let weightedRate = null;
    if (bankOffer && bankOffer.rates) {
      const rates = bankOffer.rates;
      const rateValues = [
        rates.fixed,
        rates.cpi,
        rates.prime,
        rates.variable,
      ].filter((r) => r != null && !isNaN(r));

      if (rateValues.length > 0) {
        weightedRate =
          Math.round(
            (rateValues.reduce((sum, r) => sum + r, 0) / rateValues.length) * 100
          ) / 100;
      }
    }

    const profileDoc = {
      profileHash,
      ...binned,
      bank: (bankOffer && bankOffer.bank) || null,
      branch: (bankOffer && bankOffer.branch) || null,
      rates: (bankOffer && bankOffer.rates) || null,
      weightedRate,
      consent: true,
      createdAt: now,
      updatedAt: now,
    };

    const docRef = await communityRef().add(profileDoc);

    // Invalidate cache for this profile hash since new data was added
    _cache.delete(profileHash);

    logger.info(`communityService.storeAnonymousProfile: stored profile ${docRef.id}`);
    return docRef.id;
  } catch (err) {
    logger.error(`communityService.storeAnonymousProfile: error: ${err.message}`);
    // Non-critical – don't fail the wizard flow
    return null;
  }
}

/**
 * Update an existing community profile with actual bank offer data.
 *
 * Called when a user who previously submitted the wizard later uploads
 * their actual bank offer. Updates the community profile with real
 * bank/branch/rates data.
 *
 * @param {string} profileId - Firestore document ID of the community profile
 * @param {object} bankOffer - Bank offer data
 * @param {string} bankOffer.bank - Bank name
 * @param {string} [bankOffer.branch] - Branch name
 * @param {object} bankOffer.rates - Actual rates { fixed, cpi, prime, variable }
 * @returns {Promise<boolean>} True if updated successfully
 */
async function updateProfileWithOffer(profileId, bankOffer) {
  try {
    if (!profileId || !bankOffer || !bankOffer.bank) {
      logger.warn('communityService.updateProfileWithOffer: missing required fields');
      return false;
    }

    const rates = bankOffer.rates || {};
    const rateValues = [
      rates.fixed,
      rates.cpi,
      rates.prime,
      rates.variable,
    ].filter((r) => r != null && !isNaN(r));

    const weightedRate = rateValues.length > 0
      ? Math.round((rateValues.reduce((sum, r) => sum + r, 0) / rateValues.length) * 100) / 100
      : null;

    await communityRef().doc(profileId).update({
      bank: bankOffer.bank,
      branch: bankOffer.branch || null,
      rates: bankOffer.rates || null,
      weightedRate,
      updatedAt: new Date().toISOString(),
    });

    // Clear cache since community data changed
    clearCache();

    logger.info(`communityService.updateProfileWithOffer: updated profile ${profileId}`);
    return true;
  } catch (err) {
    logger.error(`communityService.updateProfileWithOffer: error: ${err.message}`);
    return false;
  }
}

// ── Statistics ─────────────────────────────────────────────────────────────────

/**
 * Get community statistics for monitoring/admin purposes.
 *
 * @returns {Promise<object>} Community statistics
 */
async function getCommunityStats() {
  try {
    // Count total profiles (excluding sentinel)
    const snapshot = await communityRef()
      .where('consent', '==', true)
      .select() // Only fetch document references, not data
      .get();

    const totalProfiles = snapshot.size;

    // Count profiles with bank data
    const withBankSnapshot = await communityRef()
      .where('consent', '==', true)
      .where('bank', '!=', null)
      .select()
      .get();

    const profilesWithBank = withBankSnapshot.size;

    return {
      totalProfiles,
      profilesWithBank,
      profilesWithoutBank: totalProfiles - profilesWithBank,
      cacheSize: _cache.size,
    };
  } catch (err) {
    logger.error(`communityService.getCommunityStats: error: ${err.message}`);
    return {
      totalProfiles: 0,
      profilesWithBank: 0,
      profilesWithoutBank: 0,
      cacheSize: _cache.size,
      error: err.message,
    };
  }
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  // Main entry points
  getCommunityTips,
  storeAnonymousProfile,
  updateProfileWithOffer,
  getCommunityStats,

  // Profile operations
  findSimilarProfiles,
  computeBinnedProfile,
  hashProfile,

  // Aggregation
  aggregateWinningOffers,
  generateCommunityTips,
  computeAverageRates,

  // Utilities
  binValue,
  formatRecency,
  clearCache,

  // Constants (exported for testing)
  BIN_SIZES,
  MATCH_RANGES,
  MAX_MATCH_RESULTS,
  MAX_TIPS,
  MIN_PROFILES_FOR_TIP,
  COMMUNITY_CACHE_TTL_MS,
};
