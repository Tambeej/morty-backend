/**
 * Offers API Tests
 * Integration tests for the mortgage offer upload endpoints.
 */

const request = require('supertest');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');

// Set test environment before requiring app
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-for-testing-only';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-for-testing-only';
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/morty-test';
process.env.CLOUDINARY_CLOUD_NAME = 'test-cloud';
process.env.CLOUDINARY_API_KEY = 'test-key';
process.env.CLOUDINARY_API_SECRET = 'test-secret';

// Mock Cloudinary to avoid real API calls in tests
jest.mock('../src/config/cloudinary', () => ({
  cloudinary: {},
  verifyCloudinaryConfig: jest.fn().mockReturnValue(true),
  uploadToCloudinary: jest.fn().mockResolvedValue({
    secure_url: 'https://res.cloudinary.com/test/raw/upload/morty/offers/test-file.pdf',
    public_id: 'morty/offers/test-file',
  }),
  deleteFromCloudinary: jest.fn().mockResolvedValue({ result: 'ok' }),
  getSignedUrl: jest.fn().mockReturnValue('https://res.cloudinary.com/test/signed-url'),
}));

const app = require('../src/index');
const User = require('../src/models/User');
const Offer = require('../src/models/Offer');
const jwt = require('jsonwebtoken');

// ─── Test Helpers ─────────────────────────────────────────────────────────────

let testUser;
let authToken;

/**
 * Create a test user and generate an auth token.
 */
const setupTestUser = async () => {
  testUser = await User.create({
    email: 'offers-test@example.com',
    password: 'TestPassword123!',
    phone: '+972501234567',
  });
  authToken = jwt.sign(
    { id: testUser._id, email: testUser.email },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
};

/**
 * Create a minimal valid PDF buffer for testing.
 * This is a minimal valid PDF structure.
 */
const createTestPdfBuffer = () => {
  return Buffer.from(
    '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n' +
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n' +
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n' +
    'xref\n0 4\n0000000000 65535 f\n0000000009 00000 n\n' +
    '0000000058 00000 n\n0000000115 00000 n\n' +
    'trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n190\n%%EOF'
  );
};

// ─── Test Suite ───────────────────────────────────────────────────────────────

beforeAll(async () => {
  // Connect to test database
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGODB_URI);
  }
  await setupTestUser();
});

afterAll(async () => {
  // Clean up test data
  await User.deleteMany({ email: /offers-test/ });
  await Offer.deleteMany({ userId: testUser._id });
  await mongoose.connection.close();
});

afterEach(async () => {
  // Clean up offers after each test
  await Offer.deleteMany({ userId: testUser._id });
});

// ─── POST /api/v1/offers ──────────────────────────────────────────────────────

describe('POST /api/v1/offers', () => {
  it('should upload a PDF file successfully', async () => {
    const pdfBuffer = createTestPdfBuffer();

    const res = await request(app)
      .post('/api/v1/offers')
      .set('Authorization', `Bearer ${authToken}`)
      .attach('file', pdfBuffer, { filename: 'test-offer.pdf', contentType: 'application/pdf' })
      .field('bankName', 'Bank Hapoalim');

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.offer).toBeDefined();
    expect(res.body.data.offer.status).toBe('pending');
    expect(res.body.data.offer.originalFile.mimetype).toBe('application/pdf');
    expect(res.body.data.offer.extractedData.bank).toBe('Bank Hapoalim');
  });

  it('should upload a PNG image successfully', async () => {
    // Minimal 1x1 PNG
    const pngBuffer = Buffer.from(
      '89504e470d0a1a0a0000000d49484452000000010000000108020000009001' +
      '2e00000000c4944415478016360f8cfc00000000200016e21bc330000000049454e44ae426082',
      'hex'
    );

    const res = await request(app)
      .post('/api/v1/offers')
      .set('Authorization', `Bearer ${authToken}`)
      .attach('file', pngBuffer, { filename: 'test-offer.png', contentType: 'image/png' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.offer.originalFile.mimetype).toBe('image/png');
  });

  it('should reject upload without authentication', async () => {
    const pdfBuffer = createTestPdfBuffer();

    const res = await request(app)
      .post('/api/v1/offers')
      .attach('file', pdfBuffer, { filename: 'test.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('should reject upload without a file', async () => {
    const res = await request(app)
      .post('/api/v1/offers')
      .set('Authorization', `Bearer ${authToken}`)
      .field('bankName', 'Test Bank');

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.message).toMatch(/No file provided/i);
  });

  it('should reject invalid file types', async () => {
    const txtBuffer = Buffer.from('This is a text file, not a PDF or image.');

    const res = await request(app)
      .post('/api/v1/offers')
      .set('Authorization', `Bearer ${authToken}`)
      .attach('file', txtBuffer, { filename: 'test.txt', contentType: 'text/plain' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.message).toMatch(/Invalid file type/i);
  });

  it('should reject files exceeding 5MB', async () => {
    // Create a buffer slightly over 5MB
    const largeBuffer = Buffer.alloc(5 * 1024 * 1024 + 1, 'a');

    const res = await request(app)
      .post('/api/v1/offers')
      .set('Authorization', `Bearer ${authToken}`)
      .attach('file', largeBuffer, { filename: 'large.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.message).toMatch(/too large/i);
  });
});

// ─── GET /api/v1/offers ───────────────────────────────────────────────────────

describe('GET /api/v1/offers', () => {
  beforeEach(async () => {
    // Create test offers
    await Offer.create([
      {
        userId: testUser._id,
        originalFile: {
          url: 'https://cloudinary.com/test1.pdf',
          publicId: 'morty/offers/test1',
          mimetype: 'application/pdf',
          originalName: 'offer1.pdf',
          size: 102400,
        },
        status: 'pending',
      },
      {
        userId: testUser._id,
        originalFile: {
          url: 'https://cloudinary.com/test2.pdf',
          publicId: 'morty/offers/test2',
          mimetype: 'application/pdf',
          originalName: 'offer2.pdf',
          size: 204800,
        },
        status: 'analyzed',
        extractedData: { bank: 'Bank Leumi', amount: 1200000, rate: 3.8, term: 300 },
      },
    ]);
  });

  it('should list all offers for the authenticated user', async () => {
    const res = await request(app)
      .get('/api/v1/offers')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.offers).toHaveLength(2);
    expect(res.body.data.pagination.total).toBe(2);
  });

  it('should filter offers by status', async () => {
    const res = await request(app)
      .get('/api/v1/offers?status=analyzed')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.offers).toHaveLength(1);
    expect(res.body.data.offers[0].status).toBe('analyzed');
  });

  it('should support pagination', async () => {
    const res = await request(app)
      .get('/api/v1/offers?page=1&limit=1')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.offers).toHaveLength(1);
    expect(res.body.data.pagination.pages).toBe(2);
    expect(res.body.data.pagination.hasNext).toBe(true);
  });

  it('should require authentication', async () => {
    const res = await request(app).get('/api/v1/offers');
    expect(res.status).toBe(401);
  });
});

// ─── GET /api/v1/offers/:id ───────────────────────────────────────────────────

describe('GET /api/v1/offers/:id', () => {
  let testOffer;

  beforeEach(async () => {
    testOffer = await Offer.create({
      userId: testUser._id,
      originalFile: {
        url: 'https://cloudinary.com/test.pdf',
        publicId: 'morty/offers/test',
        mimetype: 'application/pdf',
        originalName: 'offer.pdf',
        size: 102400,
      },
      status: 'pending',
    });
  });

  it('should return a single offer by ID', async () => {
    const res = await request(app)
      .get(`/api/v1/offers/${testOffer._id}`)
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.offer._id).toBe(testOffer._id.toString());
  });

  it('should return 404 for non-existent offer', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const res = await request(app)
      .get(`/api/v1/offers/${fakeId}`)
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(404);
  });

  it('should return 400 for invalid offer ID', async () => {
    const res = await request(app)
      .get('/api/v1/offers/invalid-id')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(400);
  });

  it('should not return offers belonging to other users', async () => {
    // Create another user
    const otherUser = await User.create({
      email: 'other-offers-test@example.com',
      password: 'OtherPassword123!',
    });
    const otherToken = jwt.sign(
      { id: otherUser._id, email: otherUser.email },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    const res = await request(app)
      .get(`/api/v1/offers/${testOffer._id}`)
      .set('Authorization', `Bearer ${otherToken}`);

    expect(res.status).toBe(404);

    // Cleanup
    await User.deleteOne({ _id: otherUser._id });
  });
});

// ─── DELETE /api/v1/offers/:id ────────────────────────────────────────────────

describe('DELETE /api/v1/offers/:id', () => {
  let testOffer;

  beforeEach(async () => {
    testOffer = await Offer.create({
      userId: testUser._id,
      originalFile: {
        url: 'https://cloudinary.com/test.pdf',
        publicId: 'morty/offers/test-delete',
        mimetype: 'application/pdf',
        originalName: 'offer-to-delete.pdf',
        size: 102400,
      },
      status: 'pending',
    });
  });

  it('should delete an offer successfully', async () => {
    const res = await request(app)
      .delete(`/api/v1/offers/${testOffer._id}`)
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toMatch(/deleted/i);

    // Verify it's gone from DB
    const deleted = await Offer.findById(testOffer._id);
    expect(deleted).toBeNull();
  });

  it('should return 404 when deleting non-existent offer', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const res = await request(app)
      .delete(`/api/v1/offers/${fakeId}`)
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(404);
  });
});

// ─── GET /api/v1/offers/stats ─────────────────────────────────────────────────

describe('GET /api/v1/offers/stats', () => {
  beforeEach(async () => {
    await Offer.create([
      {
        userId: testUser._id,
        originalFile: { url: 'https://test.com/1.pdf', publicId: 'test1', mimetype: 'application/pdf', originalName: '1.pdf', size: 1000 },
        status: 'pending',
      },
      {
        userId: testUser._id,
        originalFile: { url: 'https://test.com/2.pdf', publicId: 'test2', mimetype: 'application/pdf', originalName: '2.pdf', size: 1000 },
        status: 'analyzed',
      },
      {
        userId: testUser._id,
        originalFile: { url: 'https://test.com/3.pdf', publicId: 'test3', mimetype: 'application/pdf', originalName: '3.pdf', size: 1000 },
        status: 'analyzed',
      },
    ]);
  });

  it('should return offer statistics', async () => {
    const res = await request(app)
      .get('/api/v1/offers/stats')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.stats.total).toBe(3);
    expect(res.body.data.stats.pending).toBe(1);
    expect(res.body.data.stats.analyzed).toBe(2);
  });
});
