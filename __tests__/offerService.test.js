/**
 * Unit tests for src/services/offerService.js
 *
 * Firestore and Cloudinary are fully mocked so no live connections are needed.
 */

'use strict';

// ── Environment setup ─────────────────────────────────────────────────────────
process.env.NODE_ENV = 'test';
process.env.FIREBASE_PROJECT_ID = 'test-project';
process.env.FIREBASE_CLIENT_EMAIL = 'test@test-project.iam.gserviceaccount.com';
process.env.FIREBASE_PRIVATE_KEY = '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0Z3VS5JJcds3xHn/ygWep4PAtEsHAqKFPmBNAFMBbFBMnMBn\n-----END RSA PRIVATE KEY-----';

// ── Firestore mock ────────────────────────────────────────────────────────────

const mockDocData = {};
const mockDocs = {};

const makeDocRef = (id, data) => ({
  id,
  get: jest.fn().mockResolvedValue({
    exists: !!data,
    id,
    data: () => data || null,
  }),
  set: jest.fn().mockImplementation((d) => {
    mockDocs[id] = d;
    return Promise.resolve();
  }),
  update: jest.fn().mockImplementation((updates) => {
    mockDocs[id] = { ...(mockDocs[id] || {}), ...updates };
    return Promise.resolve();
  }),
  delete: jest.fn().mockResolvedValue(),
});

const mockCollection = {
  doc: jest.fn((id) => {
    if (!id) {
      // Auto-generate ID
      const autoId = `auto-id-${Date.now()}`;
      return makeDocRef(autoId, null);
    }
    return makeDocRef(id, mockDocs[id] || null);
  }),
  where: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  get: jest.fn().mockResolvedValue({
    docs: [],
    size: 0,
    empty: true,
  }),
};

jest.mock('../src/config/firestore', () => ({
  collection: jest.fn(() => mockCollection),
}));

// ── Cloudinary mock ───────────────────────────────────────────────────────────

const mockUploadStream = {
  end: jest.fn(),
};

jest.mock('../src/config/cloudinary', () => ({
  uploader: {
    upload_stream: jest.fn((opts, cb) => {
      // Simulate successful upload
      process.nextTick(() =>
        cb(null, {
          secure_url: 'https://res.cloudinary.com/test/raw/upload/morty/offers/test.pdf',
          public_id: 'morty/offers/test',
        })
      );
      return mockUploadStream;
    }),
    destroy: jest.fn().mockResolvedValue({ result: 'ok' }),
  },
}));

// ── Logger mock ───────────────────────────────────────────────────────────────
jest.mock('../src/utils/logger', () => ({
  info:  jest.fn(),
  warn:  jest.fn(),
  error: jest.fn(),
}));

// ── Load service under test ───────────────────────────────────────────────────
const offerService = require('../src/services/offerService');

// ── Test data ─────────────────────────────────────────────────────────────────

const TEST_USER_ID  = 'user-abc123';
const TEST_OFFER_ID = 'offer-xyz789';

const mockOfferDoc = {
  id:           TEST_OFFER_ID,
  userId:       TEST_USER_ID,
  originalFile: { url: 'https://res.cloudinary.com/test/raw/upload/morty/offers/test.pdf', mimetype: 'application/pdf' },
  extractedData: { bank: 'הפועלים', amount: 1200000, rate: 3.5, term: 240 },
  analysis:      { recommendedRate: 3.1, savings: 45000, aiReasoning: 'Better rate available.' },
  status:        'analyzed',
  createdAt:     '2026-04-03T02:16:00.000Z',
  updatedAt:     '2026-04-03T02:20:00.000Z',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Reset all mocks between tests */
beforeEach(() => {
  jest.clearAllMocks();
  // Reset mockDocs store
  Object.keys(mockDocs).forEach((k) => delete mockDocs[k]);
});

// ── snapToDoc ─────────────────────────────────────────────────────────────────

describe('snapToDoc', () => {
  it('returns null for non-existent document', () => {
    const snap = { exists: false, id: 'x', data: () => null };
    expect(offerService.snapToDoc(snap)).toBeNull();
  });

  it('returns merged object for existing document', () => {
    const snap = { exists: true, id: 'abc', data: () => ({ foo: 'bar' }) };
    expect(offerService.snapToDoc(snap)).toEqual({ id: 'abc', foo: 'bar' });
  });
});

// ── toPublicOffer ─────────────────────────────────────────────────────────────

describe('toPublicOffer', () => {
  it('returns null for null input', () => {
    expect(offerService.toPublicOffer(null)).toBeNull();
  });

  it('returns a copy of the offer document', () => {
    const result = offerService.toPublicOffer(mockOfferDoc);
    expect(result).toEqual(mockOfferDoc);
    expect(result).not.toBe(mockOfferDoc); // should be a copy
  });
});

// ── buildOfferData ────────────────────────────────────────────────────────────

describe('buildOfferData', () => {
  it('builds a normalised offer with defaults', () => {
    const data = offerService.buildOfferData(
      TEST_USER_ID,
      { url: 'https://example.com/file.pdf', mimetype: 'application/pdf' }
    );

    expect(data.userId).toBe(TEST_USER_ID);
    expect(data.originalFile.url).toBe('https://example.com/file.pdf');
    expect(data.originalFile.mimetype).toBe('application/pdf');
    expect(data.extractedData.bank).toBe('');
    expect(data.extractedData.amount).toBeNull();
    expect(data.extractedData.rate).toBeNull();
    expect(data.extractedData.term).toBeNull();
    expect(data.analysis.recommendedRate).toBeNull();
    expect(data.analysis.savings).toBeNull();
    expect(data.analysis.aiReasoning).toBe('');
    expect(data.status).toBe('pending');
    expect(data.createdAt).toBeDefined();
    expect(data.updatedAt).toBeDefined();
  });

  it('includes bankName when provided', () => {
    const data = offerService.buildOfferData(
      TEST_USER_ID,
      { url: 'https://example.com/file.pdf', mimetype: 'application/pdf' },
      'הפועלים'
    );
    expect(data.extractedData.bank).toBe('הפועלים');
  });
});

// ── OFFER_STATUSES ────────────────────────────────────────────────────────────

describe('OFFER_STATUSES', () => {
  it('contains the three valid statuses', () => {
    expect(offerService.OFFER_STATUSES).toContain('pending');
    expect(offerService.OFFER_STATUSES).toContain('analyzed');
    expect(offerService.OFFER_STATUSES).toContain('error');
    expect(offerService.OFFER_STATUSES).toHaveLength(3);
  });

  it('is frozen (immutable)', () => {
    expect(Object.isFrozen(offerService.OFFER_STATUSES)).toBe(true);
  });
});

// ── findById ──────────────────────────────────────────────────────────────────

describe('findById', () => {
  it('returns null for falsy offerId', async () => {
    const result = await offerService.findById(null);
    expect(result).toBeNull();
  });

  it('returns null when document does not exist', async () => {
    mockCollection.doc.mockReturnValueOnce({
      get: jest.fn().mockResolvedValue({ exists: false, id: TEST_OFFER_ID, data: () => null }),
    });
    const result = await offerService.findById(TEST_OFFER_ID);
    expect(result).toBeNull();
  });

  it('returns the offer document when it exists', async () => {
    const { id, ...rest } = mockOfferDoc;
    mockCollection.doc.mockReturnValueOnce({
      get: jest.fn().mockResolvedValue({ exists: true, id, data: () => rest }),
    });
    const result = await offerService.findById(TEST_OFFER_ID);
    expect(result).toEqual(mockOfferDoc);
  });
});

// ── findByIdAndUserId ─────────────────────────────────────────────────────────

describe('findByIdAndUserId', () => {
  it('returns null for falsy inputs', async () => {
    expect(await offerService.findByIdAndUserId(null, TEST_USER_ID)).toBeNull();
    expect(await offerService.findByIdAndUserId(TEST_OFFER_ID, null)).toBeNull();
  });

  it('returns null when offer belongs to a different user', async () => {
    const { id, ...rest } = mockOfferDoc;
    mockCollection.doc.mockReturnValueOnce({
      get: jest.fn().mockResolvedValue({ exists: true, id, data: () => rest }),
    });
    const result = await offerService.findByIdAndUserId(TEST_OFFER_ID, 'different-user');
    expect(result).toBeNull();
  });

  it('returns the offer when userId matches', async () => {
    const { id, ...rest } = mockOfferDoc;
    mockCollection.doc.mockReturnValueOnce({
      get: jest.fn().mockResolvedValue({ exists: true, id, data: () => rest }),
    });
    const result = await offerService.findByIdAndUserId(TEST_OFFER_ID, TEST_USER_ID);
    expect(result).toEqual(mockOfferDoc);
  });
});

// ── listOffersByUser ──────────────────────────────────────────────────────────

describe('listOffersByUser', () => {
  it('returns empty result for falsy userId', async () => {
    const result = await offerService.listOffersByUser(null);
    expect(result).toEqual({ offers: [], total: 0 });
  });

  it('returns paginated offers', async () => {
    const { id, ...rest } = mockOfferDoc;
    mockCollection.get.mockResolvedValueOnce({
      docs: [{ id, data: () => rest }],
      size: 1,
    });
    const result = await offerService.listOffersByUser(TEST_USER_ID, { limit: 10, page: 1 });
    expect(result.total).toBe(1);
    expect(result.offers).toHaveLength(1);
    expect(result.offers[0]).toEqual(mockOfferDoc);
  });

  it('caps limit at 50', async () => {
    mockCollection.get.mockResolvedValueOnce({ docs: [], size: 0 });
    await offerService.listOffersByUser(TEST_USER_ID, { limit: 999 });
    // Should not throw; limit is capped internally
    expect(mockCollection.orderBy).toHaveBeenCalledWith('createdAt', 'desc');
  });
});

// ── getRecentOffers ───────────────────────────────────────────────────────────

describe('getRecentOffers', () => {
  it('returns empty array for falsy userId', async () => {
    const result = await offerService.getRecentOffers(null);
    expect(result).toEqual([]);
  });

  it('returns recent offers', async () => {
    const { id, ...rest } = mockOfferDoc;
    mockCollection.get.mockResolvedValueOnce({
      docs: [{ id, data: () => rest }],
    });
    const result = await offerService.getRecentOffers(TEST_USER_ID, 5);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(mockOfferDoc);
  });
});

// ── countOffersByUser ─────────────────────────────────────────────────────────

describe('countOffersByUser', () => {
  it('returns 0 for falsy userId', async () => {
    expect(await offerService.countOffersByUser(null)).toBe(0);
  });

  it('returns the count of offers', async () => {
    mockCollection.get.mockResolvedValueOnce({ size: 3 });
    const count = await offerService.countOffersByUser(TEST_USER_ID);
    expect(count).toBe(3);
  });

  it('filters by status when provided', async () => {
    mockCollection.get.mockResolvedValueOnce({ size: 1 });
    const count = await offerService.countOffersByUser(TEST_USER_ID, 'analyzed');
    expect(count).toBe(1);
    expect(mockCollection.where).toHaveBeenCalledWith('status', '==', 'analyzed');
  });

  it('ignores invalid status values', async () => {
    mockCollection.get.mockResolvedValueOnce({ size: 2 });
    await offerService.countOffersByUser(TEST_USER_ID, 'invalid-status');
    // Should not add a status filter for invalid values
    const whereCalls = mockCollection.where.mock.calls;
    const statusFilter = whereCalls.find((c) => c[0] === 'status');
    expect(statusFilter).toBeUndefined();
  });
});

// ── getOfferStats ─────────────────────────────────────────────────────────────

describe('getOfferStats', () => {
  it('returns zero stats for falsy userId', async () => {
    const stats = await offerService.getOfferStats(null);
    expect(stats).toEqual({ total: 0, pending: 0, analyzed: 0, error: 0, savingsTotal: 0 });
  });

  it('aggregates stats correctly', async () => {
    mockCollection.get.mockResolvedValueOnce({
      size: 3,
      docs: [
        { data: () => ({ status: 'analyzed', analysis: { savings: 45000 } }) },
        { data: () => ({ status: 'pending',  analysis: { savings: null } }) },
        { data: () => ({ status: 'error',    analysis: {} }) },
      ],
    });
    const stats = await offerService.getOfferStats(TEST_USER_ID);
    expect(stats.total).toBe(3);
    expect(stats.analyzed).toBe(1);
    expect(stats.pending).toBe(1);
    expect(stats.error).toBe(1);
    expect(stats.savingsTotal).toBe(45000);
  });
});

// ── createOffer ───────────────────────────────────────────────────────────────

describe('createOffer', () => {
  it('throws when userId is missing', async () => {
    await expect(
      offerService.createOffer(null, { url: 'https://example.com/f.pdf', mimetype: 'application/pdf' })
    ).rejects.toThrow('userId is required');
  });

  it('throws when originalFile.url is missing', async () => {
    await expect(
      offerService.createOffer(TEST_USER_ID, { mimetype: 'application/pdf' })
    ).rejects.toThrow('originalFile.url is required');
  });

  it('creates and returns a new offer document', async () => {
    const autoId = `auto-id-${Date.now()}`;
    const setMock = jest.fn().mockResolvedValue();
    mockCollection.doc.mockReturnValueOnce({ id: autoId, set: setMock });

    const result = await offerService.createOffer(
      TEST_USER_ID,
      { url: 'https://res.cloudinary.com/test/raw/upload/morty/offers/test.pdf', mimetype: 'application/pdf' },
      'הפועלים'
    );

    expect(setMock).toHaveBeenCalledTimes(1);
    expect(result.id).toBe(autoId);
    expect(result.userId).toBe(TEST_USER_ID);
    expect(result.status).toBe('pending');
    expect(result.extractedData.bank).toBe('הפועלים');
  });
});

// ── updateOffer ───────────────────────────────────────────────────────────────

describe('updateOffer', () => {
  it('throws when offerId is missing', async () => {
    await expect(offerService.updateOffer(null, {})).rejects.toThrow('offerId is required');
  });

  it('updates the offer and returns the updated document', async () => {
    const updatedDoc = { ...mockOfferDoc, status: 'analyzed' };
    const { id, ...rest } = updatedDoc;
    const updateMock = jest.fn().mockResolvedValue();
    const getMock    = jest.fn().mockResolvedValue({ exists: true, id, data: () => rest });

    mockCollection.doc
      .mockReturnValueOnce({ update: updateMock }) // first call: update
      .mockReturnValueOnce({ get: getMock });       // second call: findById

    const result = await offerService.updateOffer(TEST_OFFER_ID, { status: 'analyzed' });
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('analyzed');
  });
});

// ── updateOfferStatus ─────────────────────────────────────────────────────────

describe('updateOfferStatus', () => {
  it('throws for invalid status', async () => {
    await expect(
      offerService.updateOfferStatus(TEST_OFFER_ID, 'invalid')
    ).rejects.toThrow('Invalid offer status');
  });

  it('accepts valid statuses', async () => {
    const { id, ...rest } = mockOfferDoc;
    const updateMock = jest.fn().mockResolvedValue();
    const getMock    = jest.fn().mockResolvedValue({ exists: true, id, data: () => rest });

    mockCollection.doc
      .mockReturnValueOnce({ update: updateMock })
      .mockReturnValueOnce({ get: getMock });

    await expect(
      offerService.updateOfferStatus(TEST_OFFER_ID, 'analyzed')
    ).resolves.toBeDefined();
  });
});

// ── saveAnalysisResults ───────────────────────────────────────────────────────

describe('saveAnalysisResults', () => {
  it('throws when offerId is missing', async () => {
    await expect(
      offerService.saveAnalysisResults(null, {}, {})
    ).rejects.toThrow('offerId is required');
  });

  it('saves extracted data and analysis, sets status to analyzed', async () => {
    const { id, ...rest } = { ...mockOfferDoc, status: 'analyzed' };
    const updateMock = jest.fn().mockResolvedValue();
    const getMock    = jest.fn().mockResolvedValue({ exists: true, id, data: () => rest });

    mockCollection.doc
      .mockReturnValueOnce({ update: updateMock })
      .mockReturnValueOnce({ get: getMock });

    const result = await offerService.saveAnalysisResults(
      TEST_OFFER_ID,
      { bank: 'הפועלים', amount: 1200000, rate: 3.5, term: 240 },
      { recommendedRate: 3.1, savings: 45000, aiReasoning: 'Better rate available.' }
    );

    expect(updateMock).toHaveBeenCalledTimes(1);
    const updateArg = updateMock.mock.calls[0][0];
    expect(updateArg.status).toBe('analyzed');
    expect(updateArg.extractedData.bank).toBe('הפועלים');
    expect(updateArg.analysis.savings).toBe(45000);
    expect(result).toBeDefined();
  });

  it('handles null values in extractedData and analysis gracefully', async () => {
    const { id, ...rest } = mockOfferDoc;
    const updateMock = jest.fn().mockResolvedValue();
    const getMock    = jest.fn().mockResolvedValue({ exists: true, id, data: () => rest });

    mockCollection.doc
      .mockReturnValueOnce({ update: updateMock })
      .mockReturnValueOnce({ get: getMock });

    await offerService.saveAnalysisResults(
      TEST_OFFER_ID,
      { bank: null, amount: null, rate: null, term: null },
      { recommendedRate: null, savings: null, aiReasoning: null }
    );

    const updateArg = updateMock.mock.calls[0][0];
    expect(updateArg.extractedData.bank).toBe('');
    expect(updateArg.extractedData.amount).toBeNull();
    expect(updateArg.analysis.aiReasoning).toBe('');
  });
});

// ── markOfferError ────────────────────────────────────────────────────────────

describe('markOfferError', () => {
  it('sets offer status to error', async () => {
    const { id, ...rest } = { ...mockOfferDoc, status: 'error' };
    const updateMock = jest.fn().mockResolvedValue();
    const getMock    = jest.fn().mockResolvedValue({ exists: true, id, data: () => rest });

    mockCollection.doc
      .mockReturnValueOnce({ update: updateMock })
      .mockReturnValueOnce({ get: getMock });

    const result = await offerService.markOfferError(TEST_OFFER_ID);
    const updateArg = updateMock.mock.calls[0][0];
    expect(updateArg.status).toBe('error');
    expect(result).toBeDefined();
  });
});

// ── deleteOffer ───────────────────────────────────────────────────────────────

describe('deleteOffer', () => {
  it('throws when offerId is missing', async () => {
    await expect(offerService.deleteOffer(null, TEST_USER_ID)).rejects.toThrow('offerId is required');
  });

  it('throws when userId is missing', async () => {
    await expect(offerService.deleteOffer(TEST_OFFER_ID, null)).rejects.toThrow('userId is required');
  });

  it('throws 404 when offer not found or not owned', async () => {
    // findByIdAndUserId → findById returns null
    mockCollection.doc.mockReturnValueOnce({
      get: jest.fn().mockResolvedValue({ exists: false, id: TEST_OFFER_ID, data: () => null }),
    });
    await expect(
      offerService.deleteOffer(TEST_OFFER_ID, TEST_USER_ID)
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('deletes the offer document', async () => {
    const { id, ...rest } = mockOfferDoc;
    const deleteMock = jest.fn().mockResolvedValue();

    // findByIdAndUserId → findById
    mockCollection.doc
      .mockReturnValueOnce({
        get: jest.fn().mockResolvedValue({ exists: true, id, data: () => rest }),
      })
      // delete call
      .mockReturnValueOnce({ delete: deleteMock });

    await offerService.deleteOffer(TEST_OFFER_ID, TEST_USER_ID, false);
    expect(deleteMock).toHaveBeenCalledTimes(1);
  });
});

// ── uploadFileToCloudinary ────────────────────────────────────────────────────

describe('uploadFileToCloudinary', () => {
  it('throws when buffer is missing', async () => {
    await expect(offerService.uploadFileToCloudinary(null, 'application/pdf')).rejects.toThrow(
      'buffer is required'
    );
  });

  it('uploads a PDF buffer and returns url and publicId', async () => {
    const buffer = Buffer.from('fake-pdf-content');
    const result = await offerService.uploadFileToCloudinary(buffer, 'application/pdf');
    expect(result.url).toBe('https://res.cloudinary.com/test/raw/upload/morty/offers/test.pdf');
    expect(result.publicId).toBe('morty/offers/test');
  });

  it('uses image resource_type for non-PDF files', async () => {
    const cloudinary = require('../src/config/cloudinary');
    const buffer = Buffer.from('fake-image-content');
    await offerService.uploadFileToCloudinary(buffer, 'image/jpeg');
    expect(cloudinary.uploader.upload_stream).toHaveBeenCalledWith(
      expect.objectContaining({ resource_type: 'image' }),
      expect.any(Function)
    );
  });
});
