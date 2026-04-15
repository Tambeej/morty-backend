/**
 * Community Service – Unit Tests
 *
 * Tests the community intelligence algorithm including:
 *   - Profile binning and hashing
 *   - Similar profile matching
 *   - Winning offer aggregation
 *   - Community tips generation
 *   - Anonymous profile storage
 *   - Cache behavior
 */

'use strict';

// ── Mock Firestore ────────────────────────────────────────────────────────────

const mockGet = jest.fn();
const mockAdd = jest.fn();
const mockUpdate = jest.fn();
const mockWhere = jest.fn();
const mockOrderBy = jest.fn();
const mockLimit = jest.fn();
const mockSelect = jest.fn();
const mockDoc = jest.fn();
const mockCollection = jest.fn();

// Chain builder for Firestore queries
const queryChain = {
  where: mockWhere,
  orderBy: mockOrderBy,
  limit: mockLimit,
  select: mockSelect,
  get: mockGet,
};

mockWhere.mockReturnValue(queryChain);
mockOrderBy.mockReturnValue(queryChain);
mockLimit.mockReturnValue(queryChain);
mockSelect.mockReturnValue(queryChain);
mockDoc.mockReturnValue({ update: mockUpdate, get: mockGet });
mockCollection.mockReturnValue({
  where: mockWhere,
  orderBy: mockOrderBy,
  limit: mockLimit,
  add: mockAdd,
  doc: mockDoc,
});

jest.mock('../../config/firestore', () => ({
  collection: mockCollection,
}));

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

// ── Import after mocks ───────────────────────────────────────────────────────

const communityService = require('../../services/communityService');

// ── Test Data ─────────────────────────────────────────────────────────────────

const SAMPLE_INPUTS = {
  propertyPrice: 2000000,
  loanAmount: 1200000,
  monthlyIncome: 25000,
  additionalIncome: 5000,
  targetRepayment: 7000,
  futureFunds: { timeframe: 'within_5_years', amount: 200000 },
  stabilityPreference: 7,
};

const SAMPLE_RATES = {
  fixed: 4.65,
  cpi: 3.15,
  prime: 6.05,
  variable: 4.95,
};

const SAMPLE_COMMUNITY_PROFILES = [
  {
    id: 'profile1',
    profileHash: 'hash1',
    incomeBin: 30000,
    loanBin: 1200000,
    ltvBin: 60,
    stabilityBin: 8,
    bank: 'בנק לאומי',
    branch: 'הרצליה',
    rates: { fixed: 4.2, cpi: 2.9, prime: 5.8 },
    weightedRate: 4.3,
    consent: true,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'profile2',
    profileHash: 'hash2',
    incomeBin: 30000,
    loanBin: 1250000,
    ltvBin: 60,
    stabilityBin: 6,
    bank: 'בנק לאומי',
    branch: 'הרצליה',
    rates: { fixed: 4.3, cpi: 3.0, prime: 5.7 },
    weightedRate: 4.33,
    consent: true,
    createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'profile3',
    profileHash: 'hash3',
    incomeBin: 30000,
    loanBin: 1150000,
    ltvBin: 55,
    stabilityBin: 8,
    bank: 'בנק הפועלים',
    branch: 'תל אביב',
    rates: { fixed: 4.5, cpi: 3.1, prime: 5.9 },
    weightedRate: 4.5,
    consent: true,
    createdAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'profile4',
    profileHash: 'hash4',
    incomeBin: 30000,
    loanBin: 1300000,
    ltvBin: 65,
    stabilityBin: 8,
    bank: 'בנק דיסקונט',
    branch: 'רמת גן',
    rates: { fixed: 4.6, cpi: 3.2, prime: 6.0 },
    weightedRate: 4.6,
    consent: true,
    createdAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'profile5',
    profileHash: 'hash5',
    incomeBin: 30000,
    loanBin: 1200000,
    ltvBin: 60,
    stabilityBin: 6,
    bank: 'בנק לאומי',
    branch: 'הרצליה',
    rates: { fixed: 4.1, cpi: 2.85, prime: 5.75 },
    weightedRate: 4.23,
    consent: true,
    createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
  },
];

// ── Helper ────────────────────────────────────────────────────────────────────

function createMockSnapshot(profiles) {
  const docs = profiles.map((p) => ({
    id: p.id,
    data: () => ({ ...p }),
  }));
  return {
    empty: profiles.length === 0,
    size: profiles.length,
    docs,
    forEach: (cb) => docs.forEach(cb),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('communityService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    communityService.clearCache();
  });

  // ── binValue ──────────────────────────────────────────────────────────────

  describe('binValue', () => {
    it('should bin income to nearest 5000', () => {
      expect(communityService.binValue(17500, 5000)).toBe(20000);
      expect(communityService.binValue(12499, 5000)).toBe(10000);
      expect(communityService.binValue(12500, 5000)).toBe(15000);
      expect(communityService.binValue(25000, 5000)).toBe(25000);
    });

    it('should bin loan to nearest 50000', () => {
      expect(communityService.binValue(1225000, 50000)).toBe(1250000);
      expect(communityService.binValue(1200000, 50000)).toBe(1200000);
      expect(communityService.binValue(1174999, 50000)).toBe(1150000);
    });

    it('should bin LTV to nearest 5', () => {
      expect(communityService.binValue(62, 5)).toBe(60);
      expect(communityService.binValue(63, 5)).toBe(65);
      expect(communityService.binValue(75, 5)).toBe(75);
    });

    it('should bin stability to nearest 2', () => {
      expect(communityService.binValue(7, 2)).toBe(8);
      expect(communityService.binValue(6, 2)).toBe(6);
      expect(communityService.binValue(3, 2)).toBe(4);
      expect(communityService.binValue(1, 2)).toBe(2);
    });

    it('should handle zero and invalid inputs', () => {
      expect(communityService.binValue(0, 5000)).toBe(0);
      expect(communityService.binValue(null, 5000)).toBe(0);
      expect(communityService.binValue(100, 0)).toBe(0);
    });
  });

  // ── computeBinnedProfile ──────────────────────────────────────────────────

  describe('computeBinnedProfile', () => {
    it('should compute binned profile from wizard inputs', () => {
      const binned = communityService.computeBinnedProfile(SAMPLE_INPUTS);

      expect(binned).toHaveProperty('incomeBin');
      expect(binned).toHaveProperty('loanBin');
      expect(binned).toHaveProperty('ltvBin');
      expect(binned).toHaveProperty('stabilityBin');

      // Total income = 25000 + 5000 = 30000 → bin 30000
      expect(binned.incomeBin).toBe(30000);
      // Loan = 1200000 → bin 1200000
      expect(binned.loanBin).toBe(1200000);
      // LTV = 1200000/2000000 * 100 = 60% → bin 60
      expect(binned.ltvBin).toBe(60);
      // Stability = 7 → bin 8 (nearest 2)
      expect(binned.stabilityBin).toBe(8);
    });

    it('should handle missing additionalIncome', () => {
      const inputs = { ...SAMPLE_INPUTS, additionalIncome: undefined };
      const binned = communityService.computeBinnedProfile(inputs);
      // Total income = 25000 + 0 = 25000 → bin 25000
      expect(binned.incomeBin).toBe(25000);
    });
  });

  // ── hashProfile ───────────────────────────────────────────────────────────

  describe('hashProfile', () => {
    it('should produce a deterministic SHA-256 hash', () => {
      const binned = communityService.computeBinnedProfile(SAMPLE_INPUTS);
      const hash1 = communityService.hashProfile(binned);
      const hash2 = communityService.hashProfile(binned);

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64); // SHA-256 hex = 64 chars
    });

    it('should produce different hashes for different profiles', () => {
      const binned1 = communityService.computeBinnedProfile(SAMPLE_INPUTS);
      const binned2 = communityService.computeBinnedProfile({
        ...SAMPLE_INPUTS,
        loanAmount: 800000,
      });

      const hash1 = communityService.hashProfile(binned1);
      const hash2 = communityService.hashProfile(binned2);

      expect(hash1).not.toBe(hash2);
    });

    it('should be order-independent (sorted keys)', () => {
      const binned = { ltvBin: 60, incomeBin: 30000, stabilityBin: 8, loanBin: 1200000 };
      const binnedReordered = { incomeBin: 30000, loanBin: 1200000, ltvBin: 60, stabilityBin: 8 };

      expect(communityService.hashProfile(binned))
        .toBe(communityService.hashProfile(binnedReordered));
    });
  });

  // ── aggregateWinningOffers ─────────────────────────────────────────────────

  describe('aggregateWinningOffers', () => {
    it('should group profiles by bank+branch and rank by weighted rate', () => {
      const ranked = communityService.aggregateWinningOffers(SAMPLE_COMMUNITY_PROFILES);

      expect(ranked.length).toBeGreaterThan(0);
      // Leumi Herzliya should be first (lowest avg weighted rate)
      expect(ranked[0].bank).toBe('בנק לאומי');
      expect(ranked[0].branch).toBe('הרצליה');
      expect(ranked[0].profileCount).toBe(3);
    });

    it('should compute average rates per track', () => {
      const ranked = communityService.aggregateWinningOffers(SAMPLE_COMMUNITY_PROFILES);
      const leumi = ranked.find((r) => r.bank === 'בנק לאומי');

      expect(leumi.avgRates).toHaveProperty('fixed');
      expect(leumi.avgRates).toHaveProperty('cpi');
      expect(leumi.avgRates).toHaveProperty('prime');
    });

    it('should return empty array for empty input', () => {
      expect(communityService.aggregateWinningOffers([])).toEqual([]);
      expect(communityService.aggregateWinningOffers(null)).toEqual([]);
    });

    it('should skip profiles without bank data', () => {
      const profiles = [
        { bank: null, weightedRate: 4.0, rates: {} },
        { bank: 'בנק לאומי', branch: 'הרצליה', weightedRate: 4.2, rates: { fixed: 4.2 } },
      ];
      const ranked = communityService.aggregateWinningOffers(profiles);
      expect(ranked.length).toBe(1);
      expect(ranked[0].bank).toBe('בנק לאומי');
    });
  });

  // ── computeAverageRates ───────────────────────────────────────────────────

  describe('computeAverageRates', () => {
    it('should compute averages per track type', () => {
      const rates = [
        { fixed: 4.0, cpi: 3.0, prime: 5.5 },
        { fixed: 4.4, cpi: 3.2, prime: 5.9 },
      ];
      const avg = communityService.computeAverageRates(rates);

      expect(avg.fixed).toBe(4.2);
      expect(avg.cpi).toBe(3.1);
      expect(avg.prime).toBe(5.7);
    });

    it('should handle missing track values', () => {
      const rates = [
        { fixed: 4.0 },
        { fixed: 4.4, cpi: 3.2 },
      ];
      const avg = communityService.computeAverageRates(rates);

      expect(avg.fixed).toBe(4.2);
      expect(avg.cpi).toBe(3.2);
      expect(avg.prime).toBeUndefined();
    });

    it('should return empty object for empty input', () => {
      expect(communityService.computeAverageRates([])).toEqual({});
    });
  });

  // ── generateCommunityTips ─────────────────────────────────────────────────

  describe('generateCommunityTips', () => {
    it('should generate winning_offer tip when profiles have bank data', () => {
      const tips = communityService.generateCommunityTips(
        SAMPLE_COMMUNITY_PROFILES,
        SAMPLE_RATES
      );

      expect(tips.length).toBeGreaterThan(0);
      const winningTip = tips.find((t) => t.type === 'winning_offer');
      expect(winningTip).toBeDefined();
      expect(winningTip.bank).toBe('בנק לאומי');
      expect(winningTip.branch).toBe('הרצליה');
      expect(winningTip.messageHe).toContain('בנק לאומי');
      expect(winningTip.messageEn).toContain('Leumi');
    });

    it('should generate rate_comparison tip when community rates beat BOI', () => {
      const tips = communityService.generateCommunityTips(
        SAMPLE_COMMUNITY_PROFILES,
        SAMPLE_RATES
      );

      const rateTip = tips.find((t) => t.type === 'rate_comparison');
      expect(rateTip).toBeDefined();
      expect(rateTip.comparisons).toBeDefined();
      expect(rateTip.comparisons.length).toBeGreaterThan(0);
    });

    it('should generate community_size tip when >= 5 profiles', () => {
      const tips = communityService.generateCommunityTips(
        SAMPLE_COMMUNITY_PROFILES,
        SAMPLE_RATES
      );

      const sizeTip = tips.find((t) => t.type === 'community_size');
      expect(sizeTip).toBeDefined();
      expect(sizeTip.matchCount).toBe(5);
    });

    it('should return empty array when fewer than MIN_PROFILES_FOR_TIP', () => {
      const tips = communityService.generateCommunityTips(
        [SAMPLE_COMMUNITY_PROFILES[0]],
        SAMPLE_RATES
      );
      expect(tips).toEqual([]);
    });

    it('should return max MAX_TIPS tips', () => {
      const tips = communityService.generateCommunityTips(
        SAMPLE_COMMUNITY_PROFILES,
        SAMPLE_RATES
      );
      expect(tips.length).toBeLessThanOrEqual(communityService.MAX_TIPS);
    });

    it('should handle null currentRates gracefully', () => {
      const tips = communityService.generateCommunityTips(
        SAMPLE_COMMUNITY_PROFILES,
        null
      );
      // Should still produce winning_offer and community_size tips
      expect(tips.length).toBeGreaterThan(0);
      // Should NOT produce rate_comparison tip
      const rateTip = tips.find((t) => t.type === 'rate_comparison');
      expect(rateTip).toBeUndefined();
    });
  });

  // ── formatRecency ─────────────────────────────────────────────────────────

  describe('formatRecency', () => {
    it('should return "השבוע" for dates within 7 days', () => {
      const recent = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
      expect(communityService.formatRecency(recent)).toBe('השבוע');
    });

    it('should return "החודש" for dates within 30 days', () => {
      const recent = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();
      expect(communityService.formatRecency(recent)).toBe('החודש');
    });

    it('should return "לאחרונה" for older dates', () => {
      const old = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
      expect(communityService.formatRecency(old)).toBe('לאחרונה');
    });

    it('should handle invalid dates gracefully', () => {
      expect(communityService.formatRecency('invalid')).toBe('לאחרונה');
    });
  });

  // ── findSimilarProfiles ───────────────────────────────────────────────────

  describe('findSimilarProfiles', () => {
    it('should query Firestore with correct range filters', async () => {
      mockGet.mockResolvedValueOnce(createMockSnapshot(SAMPLE_COMMUNITY_PROFILES));

      const results = await communityService.findSimilarProfiles(SAMPLE_INPUTS);

      expect(mockCollection).toHaveBeenCalledWith('community_profiles');
      expect(mockWhere).toHaveBeenCalledWith('incomeBin', '>=', expect.any(Number));
      expect(mockWhere).toHaveBeenCalledWith('incomeBin', '<=', expect.any(Number));
      expect(mockOrderBy).toHaveBeenCalledWith('incomeBin', 'asc');
      expect(mockLimit).toHaveBeenCalledWith(communityService.MAX_MATCH_RESULTS);
      expect(results.length).toBeGreaterThan(0);
    });

    it('should filter out sentinel documents', async () => {
      const profilesWithSentinel = [
        ...SAMPLE_COMMUNITY_PROFILES,
        {
          id: '_sentinel',
          _sentinel: true,
          incomeBin: 30000,
          loanBin: 1200000,
          ltvBin: 60,
          stabilityBin: 8,
        },
      ];
      mockGet.mockResolvedValueOnce(createMockSnapshot(profilesWithSentinel));

      const results = await communityService.findSimilarProfiles(SAMPLE_INPUTS);

      const sentinelResult = results.find((r) => r.id === '_sentinel');
      expect(sentinelResult).toBeUndefined();
    });

    it('should return empty array on Firestore error', async () => {
      mockGet.mockRejectedValueOnce(new Error('Firestore unavailable'));

      const results = await communityService.findSimilarProfiles(SAMPLE_INPUTS);
      expect(results).toEqual([]);
    });

    it('should return empty array when no matches found', async () => {
      mockGet.mockResolvedValueOnce(createMockSnapshot([]));

      const results = await communityService.findSimilarProfiles(SAMPLE_INPUTS);
      expect(results).toEqual([]);
    });

    it('should filter by loan range in-memory', async () => {
      const profiles = [
        {
          id: 'match',
          incomeBin: 30000,
          loanBin: 1200000,
          ltvBin: 60,
          stabilityBin: 8,
          bank: 'Test',
        },
        {
          id: 'no-match-loan',
          incomeBin: 30000,
          loanBin: 5000000, // Way outside range
          ltvBin: 60,
          stabilityBin: 8,
          bank: 'Test',
        },
      ];
      mockGet.mockResolvedValueOnce(createMockSnapshot(profiles));

      const results = await communityService.findSimilarProfiles(SAMPLE_INPUTS);
      expect(results.length).toBe(1);
      expect(results[0].id).toBe('match');
    });
  });

  // ── getCommunityTips ──────────────────────────────────────────────────────

  describe('getCommunityTips', () => {
    it('should return community tips for matching profiles', async () => {
      mockGet.mockResolvedValueOnce(createMockSnapshot(SAMPLE_COMMUNITY_PROFILES));

      const tips = await communityService.getCommunityTips(SAMPLE_INPUTS, SAMPLE_RATES);

      expect(Array.isArray(tips)).toBe(true);
      expect(tips.length).toBeGreaterThan(0);
    });

    it('should return empty array when no community data exists', async () => {
      mockGet.mockResolvedValueOnce(createMockSnapshot([]));

      const tips = await communityService.getCommunityTips(SAMPLE_INPUTS, SAMPLE_RATES);
      expect(tips).toEqual([]);
    });

    it('should use cache on second call with same inputs', async () => {
      mockGet.mockResolvedValueOnce(createMockSnapshot(SAMPLE_COMMUNITY_PROFILES));

      const tips1 = await communityService.getCommunityTips(SAMPLE_INPUTS, SAMPLE_RATES);
      const tips2 = await communityService.getCommunityTips(SAMPLE_INPUTS, SAMPLE_RATES);

      // Firestore should only be called once
      expect(mockGet).toHaveBeenCalledTimes(1);
      expect(tips1).toEqual(tips2);
    });

    it('should degrade gracefully on error', async () => {
      mockGet.mockRejectedValueOnce(new Error('Network error'));

      const tips = await communityService.getCommunityTips(SAMPLE_INPUTS, SAMPLE_RATES);
      expect(tips).toEqual([]);
    });
  });

  // ── storeAnonymousProfile ─────────────────────────────────────────────────

  describe('storeAnonymousProfile', () => {
    it('should store anonymized profile in Firestore', async () => {
      mockAdd.mockResolvedValueOnce({ id: 'new-profile-id' });

      const result = await communityService.storeAnonymousProfile(SAMPLE_INPUTS);

      expect(result).toBe('new-profile-id');
      expect(mockAdd).toHaveBeenCalledTimes(1);

      const storedDoc = mockAdd.mock.calls[0][0];
      expect(storedDoc.profileHash).toBeDefined();
      expect(storedDoc.incomeBin).toBe(30000);
      expect(storedDoc.loanBin).toBe(1200000);
      expect(storedDoc.consent).toBe(true);
      // Should NOT contain PII
      expect(storedDoc.monthlyIncome).toBeUndefined();
      expect(storedDoc.propertyPrice).toBeUndefined();
    });

    it('should store bank offer data when provided', async () => {
      mockAdd.mockResolvedValueOnce({ id: 'new-profile-id' });

      const bankOffer = {
        bank: 'בנק לאומי',
        branch: 'הרצליה',
        rates: { fixed: 4.2, cpi: 2.9, prime: 5.8 },
      };

      await communityService.storeAnonymousProfile(SAMPLE_INPUTS, bankOffer);

      const storedDoc = mockAdd.mock.calls[0][0];
      expect(storedDoc.bank).toBe('בנק לאומי');
      expect(storedDoc.branch).toBe('הרצליה');
      expect(storedDoc.rates).toEqual({ fixed: 4.2, cpi: 2.9, prime: 5.8 });
      expect(storedDoc.weightedRate).toBeDefined();
      expect(typeof storedDoc.weightedRate).toBe('number');
    });

    it('should return null on Firestore error', async () => {
      mockAdd.mockRejectedValueOnce(new Error('Write failed'));

      const result = await communityService.storeAnonymousProfile(SAMPLE_INPUTS);
      expect(result).toBeNull();
    });

    it('should store null bank/rates when no offer provided', async () => {
      mockAdd.mockResolvedValueOnce({ id: 'new-profile-id' });

      await communityService.storeAnonymousProfile(SAMPLE_INPUTS);

      const storedDoc = mockAdd.mock.calls[0][0];
      expect(storedDoc.bank).toBeNull();
      expect(storedDoc.branch).toBeNull();
      expect(storedDoc.rates).toBeNull();
      expect(storedDoc.weightedRate).toBeNull();
    });
  });

  // ── updateProfileWithOffer ────────────────────────────────────────────────

  describe('updateProfileWithOffer', () => {
    it('should update profile with bank offer data', async () => {
      mockUpdate.mockResolvedValueOnce();

      const result = await communityService.updateProfileWithOffer('profile-id', {
        bank: 'בנק לאומי',
        branch: 'הרצליה',
        rates: { fixed: 4.2, cpi: 2.9, prime: 5.8 },
      });

      expect(result).toBe(true);
      expect(mockDoc).toHaveBeenCalledWith('profile-id');
      expect(mockUpdate).toHaveBeenCalledTimes(1);
    });

    it('should return false for missing required fields', async () => {
      const result = await communityService.updateProfileWithOffer(null, { bank: 'Test' });
      expect(result).toBe(false);
    });

    it('should return false for missing bank', async () => {
      const result = await communityService.updateProfileWithOffer('id', { bank: null });
      expect(result).toBe(false);
    });

    it('should return false on Firestore error', async () => {
      mockUpdate.mockRejectedValueOnce(new Error('Update failed'));

      const result = await communityService.updateProfileWithOffer('id', {
        bank: 'Test',
        rates: { fixed: 4.0 },
      });
      expect(result).toBe(false);
    });
  });

  // ── Cache behavior ────────────────────────────────────────────────────────

  describe('cache', () => {
    it('should clear cache on clearCache()', () => {
      // Manually set cache
      communityService.clearCache();
      // No error thrown
    });

    it('should invalidate cache after storeAnonymousProfile', async () => {
      // First, populate cache
      mockGet.mockResolvedValueOnce(createMockSnapshot(SAMPLE_COMMUNITY_PROFILES));
      await communityService.getCommunityTips(SAMPLE_INPUTS, SAMPLE_RATES);

      // Store a new profile (should invalidate cache for this hash)
      mockAdd.mockResolvedValueOnce({ id: 'new-id' });
      await communityService.storeAnonymousProfile(SAMPLE_INPUTS);

      // Next getCommunityTips should query Firestore again
      mockGet.mockResolvedValueOnce(createMockSnapshot(SAMPLE_COMMUNITY_PROFILES));
      await communityService.getCommunityTips(SAMPLE_INPUTS, SAMPLE_RATES);

      // Firestore get should have been called twice
      expect(mockGet).toHaveBeenCalledTimes(2);
    });
  });

  // ── Constants ─────────────────────────────────────────────────────────────

  describe('constants', () => {
    it('should export expected constants', () => {
      expect(communityService.BIN_SIZES).toBeDefined();
      expect(communityService.BIN_SIZES.INCOME).toBe(5000);
      expect(communityService.BIN_SIZES.LOAN).toBe(50000);
      expect(communityService.BIN_SIZES.LTV).toBe(5);
      expect(communityService.BIN_SIZES.STABILITY).toBe(2);

      expect(communityService.MATCH_RANGES).toBeDefined();
      expect(communityService.MATCH_RANGES.INCOME_TOLERANCE).toBe(0.10);
      expect(communityService.MATCH_RANGES.LOAN_TOLERANCE).toBe(0.20);

      expect(communityService.MAX_TIPS).toBe(3);
      expect(communityService.MIN_PROFILES_FOR_TIP).toBe(2);
    });
  });
});
