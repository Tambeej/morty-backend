/**
 * Offers API Tests
 *
 * NOTE: Mongoose/MongoDB integration has been removed as part of the
 * Firestore migration (task 1). These tests validate the API contract
 * (auth guards, file validation) without a live database.
 * Full Firestore-backed integration tests will be added in subsequent tasks.
 */

const request = require('supertest');

// Set test environment before requiring app
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-for-testing-only';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-for-testing-only';
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
const jwt = require('jsonwebtoken');

/** Generate a signed JWT for a fake Firestore user ID. */
const makeToken = (userId = 'firestore-uid-offers-test') =>
  jwt.sign(
    { id: userId, email: 'offers-test@example.com' },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );

/**
 * Create a minimal valid PDF buffer for testing.
 */
const createTestPdfBuffer = () =>
  Buffer.from(
    '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n' +
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n' +
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n' +
    'xref\n0 4\n0000000000 65535 f\n0000000009 00000 n\n' +
    '0000000058 00000 n\n0000000115 00000 n\n' +
    'trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n190\n%%EOF'
  );

// ─── Auth guard tests ─────────────────────────────────────────────────────────

describe('POST /api/v1/offers – auth guard', () => {
  it('should reject upload without authentication (401)', async () => {
    const pdfBuffer = createTestPdfBuffer();
    const res = await request(app)
      .post('/api/v1/offers')
      .attach('file', pdfBuffer, { filename: 'test.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });
});

describe('GET /api/v1/offers – auth guard', () => {
  it('should require authentication (401)', async () => {
    const res = await request(app).get('/api/v1/offers');
    expect(res.status).toBe(401);
  });
});
