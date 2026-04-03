/**
 * offerService Unit Tests
 *
 * Tests all CRUD, upload, and analysis operations in offerService.js
 * using fully mocked Firestore and Cloudinary instances.
 * No live database or cloud storage required.
 */

'use strict';

// ── Environment setup ─────────────────────────────────────────────────────────
process.env.NODE_ENV = 'test';

// ── Mock Cloudinary ───────────────────────────────────────────────────────────
jest.mock('../../config/cloudinary', () => ({
  uploader: {
    upload_stream: jest.fn(),
    destroy: jest.fn().mockResolvedValue({ result: 'ok' }),
  },
}));

// ── Mock Firestore ────────────────────────────────────────────────────────────

const mockDocRef = {
  id: 'auto-generated-offer-id',
  get: jest.fn(),
  set: jest.fn().mockResolvedValue({}),
  update: jest.fn().mockResolvedValue({}),
  delete: jest.fn().mockResolvedValue({}),
};

const mockQuerySnap = {
  empty: true,
  docs: [],
  size: 0,
};

const mockCollectionRef = {
  doc: jest.fn().mockReturnValue(mockDocRef),
  where: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  get: jest.fn().mockResolvedValue(mockQuerySnap),
};

jest.mock('../../config/firestore', () => ({
  collection: jest.fn().mockReturnValue(mockCollectionRef),
}));

// ── Import service AFTER mocking ──────────────────────────────────────────────
const offerService = require('../../services/offerService');
const cloudinary = require('../../config/cloudinary');

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a mock Firestore DocumentSnapshot that exists. */
const makeExistingSnap = (data) => ({
  exists: true,
  id: data.id || 'offer-doc-id',
  data: () => data,
});

/** Build a mock Firestore DocumentSnapshot that does NOT exist. */
const makeNotFoundSnap = () => ({
  exists: false,
  id: 'nonexistent',
  data: () => null,
});

/** Sample analyzed offer document. */
const sampleOffer = {
  id: 'offer-id-xyz',
  userId: 'firestore-uid-abc123',
  originalFile: {
    url: 'https://res.cloudinary.com/test/raw/upload/morty/offers/test.pdf',
    mimetype: 'application/pdf',
  },
  extractedData: { bank: 'הפועלים', amount: 1200000, rate: 3.5, term: 240 },
  analysis: { recommendedRate: 3.1, savings: 45000, aiReasoning: 'שיעור טוב יותר זמין.' },
  status: 'analyzed',
  createdAt: '2026-04-03T02:16:00.000Z',
  updatedAt: '2026-04-03T02:20:00.000Z',
};

/** Sample pending offer document. */
const pendingOffer = {
  id: 'offer-pending-001',
  userId: 'firestore-uid-abc123',
  originalFile: {
    url: 'https://res.cloudinary.com/test/raw/upload/morty/offers/pending.pdf',
    mimetype: 'application/pdf',
  },
  extractedData: { bank: '', amount: null, rate: null, term: null },
  analysis: { recommendedRate: null, savings: null, aiReasoning: '' },
  status: 'pending',
  createdAt: '2026-04-03T03:00:00.000Z',
  updatedAt: '2026-04-03T03:00:00.000Z',
};

// ── OFFER_STATUSES constant ───────────────────────────────────────────────────

describe('offerService.OFFER_STATUSES', () => {
  it('should contain pending, analyzed, and error', () => {
    expect(offerService.OFFER_STATUSES).toContain('pending');
    expect(offerService.OFFER_STATUSES).toContain('analyzed');
    expect(offerService.OFFER_STATUSES).toContain('error');
  });

  it('should be frozen (immutable)', () => {
    expect(Object.isFrozen(offerService.OFFER_STATUSES)).toBe(true);
  });
});

// ── toPublicOffer ─────────────────────────────────────────────────────────────

describe('offerService.toPublicOffer', () => {
  it('should return a copy of the offer document', () => {
    const result = offerService.toPublicOffer(sampleOffer);
    expect(result).toEqual(sampleOffer);
    expect(result).not.toBe(sampleOffer); // should be a copy
  });

  it('should return null for null input', () => {
    expect(offerService.toPublicOffer(null)).toBeNull();
  });
});

// ── findById ──────────────────────────────────────────────────────────────────

describe('offerService.findById', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should return the offer document when found', async () => {
    mockDocRef.get.mockResolvedValueOnce(makeExistingSnap(sampleOffer));

    const result = await offerService.findById('offer-id-xyz');
    expect(result).toMatchObject({ id: 'offer-id-xyz', userId: 'firestore-uid-abc123' });
  });

  it('should return null when document does not exist', async () => {
    mockDocRef.get.mockResolvedValueOnce(makeNotFoundSnap());

    const result = await offerService.findById('nonexistent-id');
    expect(result).toBeNull();
  });

  it('should return null for falsy offerId', async () => {
    const result = await offerService.findById(null);
    expect(result).toBeNull();
  });
});

// ── findByIdAndUserId ─────────────────────────────────────────────────────────

describe('offerService.findByIdAndUserId', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should return the offer when ID and userId match', async () => {
    mockDocRef.get.mockResolvedValueOnce(makeExistingSnap(sampleOffer));

    const result = await offerService.findByIdAndUserId('offer-id-xyz', 'firestore-uid-abc123');
    expect(result).toMatchObject({ id: 'offer-id-xyz' });
  });

  it('should return null when userId does not match (ownership check)', async () => {
    mockDocRef.get.mockResolvedValueOnce(makeExistingSnap(sampleOffer));

    const result = await offerService.findByIdAndUserId('offer-id-xyz', 'different-user-id');
    expect(result).toBeNull();
  });

  it('should return null when offer does not exist', async () => {
    mockDocRef.get.mockResolvedValueOnce(makeNotFoundSnap());

    const result = await offerService.findByIdAndUserId('nonexistent', 'firestore-uid-abc123');
    expect(result).toBeNull();
  });

  it('should return null for falsy parameters', async () => {
    expect(await offerService.findByIdAndUserId(null, 'user-id')).toBeNull();
    expect(await offerService.findByIdAndUserId('offer-id', null)).toBeNull();
  });
});

// ── listOffersByUser ──────────────────────────────────────────────────────────

describe('offerService.listOffersByUser', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should return paginated offers for a user', async () => {
    const docs = [
      { id: sampleOffer.id, data: () => sampleOffer },
      { id: pendingOffer.id, data: () => pendingOffer },
    ];
    mockCollectionRef.get.mockResolvedValueOnce({ docs, size: 2 });

    const result = await offerService.listOffersByUser('firestore-uid-abc123');

    expect(result).toHaveProperty('offers');
    expect(result).toHaveProperty('total', 2);
    expect(Array.isArray(result.offers)).toBe(true);
  });

  it('should return empty result for user with no offers', async () => {
    mockCollectionRef.get.mockResolvedValueOnce({ docs: [], size: 0 });

    const result = await offerService.listOffersByUser('user-with-no-offers');

    expect(result.offers).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('should return empty result for falsy userId', async () => {
    const result = await offerService.listOffersByUser(null);
    expect(result.offers).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('should respect pagination limit', async () => {
    const docs = Array.from({ length: 10 }, (_, i) => ({
      id: `offer-${i}`,
      data: () => ({ ...sampleOffer, id: `offer-${i}` }),
    }));
    mockCollectionRef.get.mockResolvedValueOnce({ docs, size: 10 });

    const result = await offerService.listOffersByUser('user-id', { limit: 3, page: 1 });

    expect(result.offers).toHaveLength(3);
    expect(result.total).toBe(10);
  });
});

// ── getOfferStats ─────────────────────────────────────────────────────────────

describe('offerService.getOfferStats', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should return correct stats for a user with offers', async () => {
    const docs = [
      { data: () => ({ status: 'analyzed', analysis: { savings: 45000 } }) },
      { data: () => ({ status: 'analyzed', analysis: { savings: 30000 } }) },
      { data: () => ({ status: 'pending', analysis: { savings: null } }) },
      { data: () => ({ status: 'error', analysis: {} }) },
    ];
    mockCollectionRef.get.mockResolvedValueOnce({ docs, size: 4 });

    const result = await offerService.getOfferStats('firestore-uid-abc123');

    expect(result.total).toBe(4);
    expect(result.analyzed).toBe(2);
    expect(result.pending).toBe(1);
    expect(result.error).toBe(1);
    expect(result.savingsTotal).toBe(75000);
  });

  it('should return zero stats for user with no offers', async () => {
    mockCollectionRef.get.mockResolvedValueOnce({ docs: [], size: 0 });

    const result = await offerService.getOfferStats('user-with-no-offers');

    expect(result).toEqual({ total: 0, pending: 0, analyzed: 0, error: 0, savingsTotal: 0 });
  });

  it('should return zero stats for falsy userId', async () => {
    const result = await offerService.getOfferStats(null);
    expect(result).toEqual({ total: 0, pending: 0, analyzed: 0, error: 0, savingsTotal: 0 });
  });
});

// ── createOffer ───────────────────────────────────────────────────────────────

describe('offerService.createOffer', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should create an offer and return it with pending status', async () => {
    mockDocRef.set.mockResolvedValueOnce({});

    const result = await offerService.createOffer(
      'firestore-uid-abc123',
      { url: 'https://cdn.example.com/file.pdf', mimetype: 'application/pdf' }
    );

    expect(mockDocRef.set).toHaveBeenCalled();
    expect(result).toHaveProperty('userId', 'firestore-uid-abc123');
    expect(result).toHaveProperty('status', 'pending');
    expect(result).toHaveProperty('id');
  });

  it('should initialise extractedData with null values', async () => {
    mockDocRef.set.mockResolvedValueOnce({});

    const result = await offerService.createOffer(
      'user-id',
      { url: 'https://cdn.example.com/file.pdf', mimetype: 'application/pdf' }
    );

    expect(result.extractedData.amount).toBeNull();
    expect(result.extractedData.rate).toBeNull();
    expect(result.extractedData.term).toBeNull();
  });

  it('should initialise analysis with null values', async () => {
    mockDocRef.set.mockResolvedValueOnce({});

    const result = await offerService.createOffer(
      'user-id',
      { url: 'https://cdn.example.com/file.pdf', mimetype: 'application/pdf' }
    );

    expect(result.analysis.recommendedRate).toBeNull();
    expect(result.analysis.savings).toBeNull();
  });

  it('should set createdAt and updatedAt as ISO strings', async () => {
    mockDocRef.set.mockResolvedValueOnce({});

    const result = await offerService.createOffer(
      'user-id',
      { url: 'https://cdn.example.com/file.pdf', mimetype: 'application/pdf' }
    );

    expect(() => new Date(result.createdAt)).not.toThrow();
    expect(new Date(result.createdAt).toISOString()).toBe(result.createdAt);
  });

  it('should throw when userId is falsy', async () => {
    await expect(
      offerService.createOffer(null, { url: 'https://cdn.example.com/file.pdf', mimetype: 'application/pdf' })
    ).rejects.toThrow();
  });

  it('should throw when originalFile.url is missing', async () => {
    await expect(
      offerService.createOffer('user-id', { mimetype: 'application/pdf' })
    ).rejects.toThrow();
  });
});

// ── updateOffer ───────────────────────────────────────────────────────────────

describe('offerService.updateOffer', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should call update() and return the updated offer', async () => {
    mockDocRef.update.mockResolvedValueOnce({});
    mockDocRef.get.mockResolvedValueOnce(makeExistingSnap({ ...sampleOffer, status: 'analyzed' }));

    const result = await offerService.updateOffer('offer-id-xyz', { status: 'analyzed' });

    expect(mockDocRef.update).toHaveBeenCalled();
    expect(result).toHaveProperty('status', 'analyzed');
  });

  it('should throw when offerId is falsy', async () => {
    await expect(offerService.updateOffer(null, { status: 'analyzed' })).rejects.toThrow();
  });

  it('should not overwrite id, userId, or createdAt', async () => {
    mockDocRef.update.mockResolvedValueOnce({});
    mockDocRef.get.mockResolvedValueOnce(makeExistingSnap(sampleOffer));

    await offerService.updateOffer('offer-id-xyz', {
      id: 'should-be-ignored',
      userId: 'should-be-ignored',
      createdAt: 'should-be-ignored',
      status: 'analyzed',
    });

    const updateCall = mockDocRef.update.mock.calls[0][0];
    expect(updateCall.id).toBeUndefined();
    expect(updateCall.userId).toBeUndefined();
    expect(updateCall.createdAt).toBeUndefined();
  });
});

// ── saveAnalysisResults ───────────────────────────────────────────────────────

describe('offerService.saveAnalysisResults', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should save analysis results and set status to analyzed', async () => {
    mockDocRef.update.mockResolvedValueOnce({});
    mockDocRef.get.mockResolvedValueOnce(makeExistingSnap({
      ...sampleOffer,
      status: 'analyzed',
      extractedData: { bank: 'הפועלים', amount: 1200000, rate: 3.5, term: 240 },
      analysis: { recommendedRate: 3.1, savings: 45000, aiReasoning: 'שיעור טוב יותר זמין.' },
    }));

    const result = await offerService.saveAnalysisResults(
      'offer-id-xyz',
      { bank: 'הפועלים', amount: 1200000, rate: 3.5, term: 240 },
      { recommendedRate: 3.1, savings: 45000, aiReasoning: 'שיעור טוב יותר זמין.' }
    );

    expect(result).toHaveProperty('status', 'analyzed');
    expect(result.analysis).toHaveProperty('recommendedRate', 3.1);
    expect(result.analysis).toHaveProperty('savings', 45000);
  });

  it('should throw when offerId is falsy', async () => {
    await expect(
      offerService.saveAnalysisResults(null, {}, {})
    ).rejects.toThrow();
  });
});

// ── markOfferError ────────────────────────────────────────────────────────────

describe('offerService.markOfferError', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should set offer status to error', async () => {
    mockDocRef.update.mockResolvedValueOnce({});
    mockDocRef.get.mockResolvedValueOnce(makeExistingSnap({ ...sampleOffer, status: 'error' }));

    const result = await offerService.markOfferError('offer-id-xyz');

    expect(result).toHaveProperty('status', 'error');
  });
});

// ── deleteOffer ───────────────────────────────────────────────────────────────

describe('offerService.deleteOffer', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should delete the offer when ownership is verified', async () => {
    // findByIdAndUserId → findById → get
    mockDocRef.get.mockResolvedValueOnce(makeExistingSnap(sampleOffer));
    mockDocRef.delete.mockResolvedValueOnce({});

    await offerService.deleteOffer('offer-id-xyz', 'firestore-uid-abc123', false);

    expect(mockDocRef.delete).toHaveBeenCalled();
  });

  it('should throw 404 when offer is not found or not owned', async () => {
    mockDocRef.get.mockResolvedValueOnce(makeNotFoundSnap());

    await expect(
      offerService.deleteOffer('nonexistent', 'firestore-uid-abc123')
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('should throw when offerId is falsy', async () => {
    await expect(offerService.deleteOffer(null, 'user-id')).rejects.toThrow();
  });

  it('should throw when userId is falsy', async () => {
    await expect(offerService.deleteOffer('offer-id', null)).rejects.toThrow();
  });
});

// ── uploadFileToCloudinary ────────────────────────────────────────────────────

describe('offerService.uploadFileToCloudinary', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should resolve with url and publicId on successful upload', async () => {
    const mockStream = {
      end: jest.fn(),
    };

    cloudinary.uploader.upload_stream.mockImplementationOnce((options, callback) => {
      // Simulate async Cloudinary success
      process.nextTick(() =>
        callback(null, {
          secure_url: 'https://res.cloudinary.com/test/raw/upload/morty/offers/file.pdf',
          public_id: 'morty/offers/file',
        })
      );
      return mockStream;
    });

    const result = await offerService.uploadFileToCloudinary(
      Buffer.from('fake-pdf-content'),
      'application/pdf'
    );

    expect(result).toHaveProperty('url', 'https://res.cloudinary.com/test/raw/upload/morty/offers/file.pdf');
    expect(result).toHaveProperty('publicId', 'morty/offers/file');
  });

  it('should reject when Cloudinary returns an error', async () => {
    const mockStream = { end: jest.fn() };

    cloudinary.uploader.upload_stream.mockImplementationOnce((options, callback) => {
      process.nextTick(() => callback(new Error('Cloudinary upload failed'), null));
      return mockStream;
    });

    await expect(
      offerService.uploadFileToCloudinary(Buffer.from('fake-content'), 'application/pdf')
    ).rejects.toThrow('Cloudinary upload failed');
  });

  it('should throw when buffer is falsy', async () => {
    await expect(
      offerService.uploadFileToCloudinary(null, 'application/pdf')
    ).rejects.toThrow();
  });

  it('should use raw resource_type for PDF files', async () => {
    const mockStream = { end: jest.fn() };

    cloudinary.uploader.upload_stream.mockImplementationOnce((options, callback) => {
      process.nextTick(() =>
        callback(null, { secure_url: 'https://cdn.example.com/file.pdf', public_id: 'morty/offers/file' })
      );
      return mockStream;
    });

    await offerService.uploadFileToCloudinary(Buffer.from('pdf'), 'application/pdf');

    const callOptions = cloudinary.uploader.upload_stream.mock.calls[0][0];
    expect(callOptions.resource_type).toBe('raw');
  });

  it('should use image resource_type for image files', async () => {
    const mockStream = { end: jest.fn() };

    cloudinary.uploader.upload_stream.mockImplementationOnce((options, callback) => {
      process.nextTick(() =>
        callback(null, { secure_url: 'https://cdn.example.com/img.png', public_id: 'morty/offers/img' })
      );
      return mockStream;
    });

    await offerService.uploadFileToCloudinary(Buffer.from('img'), 'image/png');

    const callOptions = cloudinary.uploader.upload_stream.mock.calls[0][0];
    expect(callOptions.resource_type).toBe('image');
  });
});
