'use strict';

/**
 * Unit tests for offerService.updateEnhancedAnalysis
 *
 * Verifies the idempotent "if not exists" guard:
 *   - Stores the report when analysis.enhanced does not exist.
 *   - Skips the write and returns the existing report when already stored.
 *   - Throws when offerId is missing.
 *   - Propagates Firestore transaction errors.
 */

// ── Firestore mock ────────────────────────────────────────────────────────────

const mockTransactionUpdate = jest.fn();
const mockTransactionGet    = jest.fn();

const mockTransaction = {
  get:    mockTransactionGet,
  update: mockTransactionUpdate,
};

// runTransaction calls the callback with the mock transaction object
const mockRunTransaction = jest.fn((callback) => callback(mockTransaction));

const mockDocRef = {
  id: 'offer-test-id',
};

const mockCollectionRef = {
  doc: jest.fn().mockReturnValue(mockDocRef),
};

const mockDb = {
  collection:     jest.fn().mockReturnValue(mockCollectionRef),
  runTransaction: mockRunTransaction,
};

jest.mock('../src/config/firestore', () => mockDb);

// ── Cloudinary mock (required by offerService) ────────────────────────────────
jest.mock('../src/config/cloudinary', () => ({
  uploader: {
    upload_stream: jest.fn(),
    destroy:       jest.fn().mockResolvedValue({ result: 'ok' }),
  },
}));

// ── Logger mock ───────────────────────────────────────────────────────────────
jest.mock('../src/utils/logger', () => ({
  info:  jest.fn(),
  warn:  jest.fn(),
  error: jest.fn(),
}));

// ── Load service under test ───────────────────────────────────────────────────
const { updateEnhancedAnalysis } = require('../src/services/offerService');
const logger = require('../src/utils/logger');

// ── Test fixtures ─────────────────────────────────────────────────────────────

const OFFER_ID = 'offer-abc123';

const mockEnhancedReport = {
  tricks: [
    {
      nameHe: 'מסלול פיתיון',
      nameEn: 'Enticement Track',
      descriptionHe: 'תיאור בעברית',
      descriptionEn: 'Description in English',
      applicability: 'high',
      riskLevel: 'medium',
      potentialSavings: 22000,
    },
  ],
  negotiationScript: 'שלום, שמי [שם]...',
  insights: [
    {
      titleHe: 'ניתוח ריבית',
      titleEn: 'Rate Analysis',
      bodyHe: 'גוף בעברית',
      bodyEn: 'Body in English',
      icon: 'trending-down',
    },
  ],
  comparison: {
    rateDelta: 0.45,
    monthlySaving: 412,
    totalSaving: 123600,
    loanAmount: 1500000,
    termYears: 25,
    bankRate: 5.2,
    portfolioRate: 4.75,
    trackComparison: [],
  },
  generatedAt: '2026-05-07T12:00:00.000Z',
  generatedBy: 'ai',
  processingTimeMs: 1500,
};

const existingEnhancedReport = {
  ...mockEnhancedReport,
  generatedAt: '2026-05-01T10:00:00.000Z',
  generatedBy: 'rule-based-fallback',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a mock Firestore DocumentSnapshot.
 */
function makeOfferSnap(offerData, exists = true) {
  return {
    exists,
    id: OFFER_ID,
    data: () => offerData,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  // Re-apply collection mock after clearAllMocks
  mockDb.collection.mockReturnValue(mockCollectionRef);
  mockCollectionRef.doc.mockReturnValue(mockDocRef);
  mockRunTransaction.mockImplementation((callback) => callback(mockTransaction));
});

describe('updateEnhancedAnalysis', () => {
  // ── Input validation ────────────────────────────────────────────────────────

  describe('Input validation', () => {
    it('should throw when offerId is missing (null)', async () => {
      await expect(
        updateEnhancedAnalysis(null, mockEnhancedReport)
      ).rejects.toThrow('offerId is required for updateEnhancedAnalysis');
    });

    it('should throw when offerId is an empty string', async () => {
      await expect(
        updateEnhancedAnalysis('', mockEnhancedReport)
      ).rejects.toThrow('offerId is required for updateEnhancedAnalysis');
    });

    it('should throw when offerId is undefined', async () => {
      await expect(
        updateEnhancedAnalysis(undefined, mockEnhancedReport)
      ).rejects.toThrow('offerId is required for updateEnhancedAnalysis');
    });
  });

  // ── Successful storage (first time) ────────────────────────────────────────

  describe('First-time storage (analysis.enhanced does not exist)', () => {
    beforeEach(() => {
      // Offer exists, no enhanced report yet
      const offerWithoutEnhanced = {
        userId: 'user-123',
        status: 'analyzed',
        analysis: {
          recommendedRate: 4.5,
          savings: 50000,
          aiReasoning: 'Good rate.',
          // No 'enhanced' field
        },
      };
      mockTransactionGet.mockResolvedValue(makeOfferSnap(offerWithoutEnhanced));
    });

    it('should call transaction.update with the enhanced report', async () => {
      await updateEnhancedAnalysis(OFFER_ID, mockEnhancedReport);

      expect(mockTransactionUpdate).toHaveBeenCalledTimes(1);
      expect(mockTransactionUpdate).toHaveBeenCalledWith(
        mockDocRef,
        expect.objectContaining({
          'analysis.enhanced': mockEnhancedReport,
          updatedAt: expect.any(String),
        })
      );
    });

    it('should return { stored: true, report: enhancedReport }', async () => {
      const result = await updateEnhancedAnalysis(OFFER_ID, mockEnhancedReport);

      expect(result).toEqual({
        stored: true,
        report: mockEnhancedReport,
      });
    });

    it('should log a success message', async () => {
      await updateEnhancedAnalysis(OFFER_ID, mockEnhancedReport);

      expect(logger.info).toHaveBeenCalledWith(
        'Enhanced analysis stored successfully',
        { offerId: OFFER_ID }
      );
    });

    it('should store when analysis object exists but enhanced field is null', async () => {
      const offerWithNullEnhanced = {
        userId: 'user-123',
        status: 'analyzed',
        analysis: {
          recommendedRate: 4.5,
          savings: 50000,
          aiReasoning: 'Good rate.',
          enhanced: null,
        },
      };
      mockTransactionGet.mockResolvedValue(makeOfferSnap(offerWithNullEnhanced));

      const result = await updateEnhancedAnalysis(OFFER_ID, mockEnhancedReport);

      expect(mockTransactionUpdate).toHaveBeenCalledTimes(1);
      expect(result.stored).toBe(true);
    });

    it('should store when analysis object is missing entirely', async () => {
      const offerWithoutAnalysis = {
        userId: 'user-123',
        status: 'pending',
        // No 'analysis' field at all
      };
      mockTransactionGet.mockResolvedValue(makeOfferSnap(offerWithoutAnalysis));

      const result = await updateEnhancedAnalysis(OFFER_ID, mockEnhancedReport);

      expect(mockTransactionUpdate).toHaveBeenCalledTimes(1);
      expect(result.stored).toBe(true);
    });

    it('should set updatedAt as a valid ISO string', async () => {
      await updateEnhancedAnalysis(OFFER_ID, mockEnhancedReport);

      const updateArg = mockTransactionUpdate.mock.calls[0][1];
      expect(() => new Date(updateArg.updatedAt)).not.toThrow();
      expect(new Date(updateArg.updatedAt).toISOString()).toBe(updateArg.updatedAt);
    });
  });

  // ── Idempotency guard (already exists) ─────────────────────────────────────

  describe('Idempotency guard (analysis.enhanced already exists)', () => {
    beforeEach(() => {
      // Offer already has an enhanced report
      const offerWithEnhanced = {
        userId: 'user-123',
        status: 'analyzed',
        analysis: {
          recommendedRate: 4.5,
          savings: 50000,
          aiReasoning: 'Good rate.',
          enhanced: existingEnhancedReport,
        },
      };
      mockTransactionGet.mockResolvedValue(makeOfferSnap(offerWithEnhanced));
    });

    it('should NOT call transaction.update when enhanced already exists', async () => {
      await updateEnhancedAnalysis(OFFER_ID, mockEnhancedReport);

      expect(mockTransactionUpdate).not.toHaveBeenCalled();
    });

    it('should return { stored: false, report: existingReport }', async () => {
      const result = await updateEnhancedAnalysis(OFFER_ID, mockEnhancedReport);

      expect(result).toEqual({
        stored: false,
        report: existingEnhancedReport,
      });
    });

    it('should log an idempotency skip message', async () => {
      await updateEnhancedAnalysis(OFFER_ID, mockEnhancedReport);

      expect(logger.info).toHaveBeenCalledWith(
        'Enhanced analysis already exists, skipping write (idempotent)',
        { offerId: OFFER_ID }
      );
    });

    it('should return the EXISTING report, not the new one', async () => {
      const result = await updateEnhancedAnalysis(OFFER_ID, mockEnhancedReport);

      // The returned report should be the one already in Firestore
      expect(result.report.generatedAt).toBe(existingEnhancedReport.generatedAt);
      expect(result.report.generatedBy).toBe('rule-based-fallback');
    });
  });

  // ── Offer not found ─────────────────────────────────────────────────────────

  describe('Offer not found', () => {
    it('should throw when the offer document does not exist in Firestore', async () => {
      mockTransactionGet.mockResolvedValue(makeOfferSnap(null, false));

      await expect(
        updateEnhancedAnalysis(OFFER_ID, mockEnhancedReport)
      ).rejects.toThrow(`Offer '${OFFER_ID}' not found during enhanced analysis storage`);
    });

    it('should NOT call transaction.update when offer does not exist', async () => {
      mockTransactionGet.mockResolvedValue(makeOfferSnap(null, false));

      try {
        await updateEnhancedAnalysis(OFFER_ID, mockEnhancedReport);
      } catch (_) {
        // expected
      }

      expect(mockTransactionUpdate).not.toHaveBeenCalled();
    });
  });

  // ── Firestore transaction errors ────────────────────────────────────────────

  describe('Firestore transaction errors', () => {
    it('should propagate Firestore transaction errors', async () => {
      const firestoreError = new Error('FIRESTORE_UNAVAILABLE: Firestore is temporarily unavailable');
      mockRunTransaction.mockRejectedValue(firestoreError);

      await expect(
        updateEnhancedAnalysis(OFFER_ID, mockEnhancedReport)
      ).rejects.toThrow('FIRESTORE_UNAVAILABLE');
    });

    it('should log the error before re-throwing', async () => {
      const firestoreError = new Error('Transaction aborted');
      mockRunTransaction.mockRejectedValue(firestoreError);

      try {
        await updateEnhancedAnalysis(OFFER_ID, mockEnhancedReport);
      } catch (_) {
        // expected
      }

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('offerService.updateEnhancedAnalysis error'),
        expect.any(Object)
      );
    });

    it('should propagate transaction.get errors', async () => {
      mockTransactionGet.mockRejectedValue(new Error('Permission denied'));

      await expect(
        updateEnhancedAnalysis(OFFER_ID, mockEnhancedReport)
      ).rejects.toThrow('Permission denied');
    });
  });

  // ── Concurrent request simulation ──────────────────────────────────────────

  describe('Concurrent request simulation', () => {
    it('should handle two concurrent calls: first stores, second skips', async () => {
      // First call: no enhanced report
      const offerWithoutEnhanced = {
        userId: 'user-123',
        status: 'analyzed',
        analysis: { recommendedRate: 4.5, savings: 50000, aiReasoning: 'Good.' },
      };

      // Second call: enhanced report already exists (simulating race condition)
      const offerWithEnhanced = {
        userId: 'user-123',
        status: 'analyzed',
        analysis: {
          recommendedRate: 4.5,
          savings: 50000,
          aiReasoning: 'Good.',
          enhanced: existingEnhancedReport,
        },
      };

      mockTransactionGet
        .mockResolvedValueOnce(makeOfferSnap(offerWithoutEnhanced)) // first call
        .mockResolvedValueOnce(makeOfferSnap(offerWithEnhanced));   // second call

      const [result1, result2] = await Promise.all([
        updateEnhancedAnalysis(OFFER_ID, mockEnhancedReport),
        updateEnhancedAnalysis(OFFER_ID, mockEnhancedReport),
      ]);

      // First call should store
      expect(result1.stored).toBe(true);
      // Second call should skip (idempotent)
      expect(result2.stored).toBe(false);
      expect(result2.report).toEqual(existingEnhancedReport);

      // transaction.update should only be called once
      expect(mockTransactionUpdate).toHaveBeenCalledTimes(1);
    });
  });
});
