/**
 * JWT Utility Unit Tests
 *
 * Tests token generation, verification, and the protect middleware
 * using the Firestore-backed userService mock.
 *
 * NOTE: generateAccessToken / generateRefreshToken / verifyAccessToken /
 * verifyRefreshToken are exported from src/utils/jwt.js (not from
 * src/middleware/auth.js which only exports the `protect` middleware).
 */

'use strict';

const jwt = require('jsonwebtoken');

// ── Environment setup (must happen before requiring modules) ──────────────────
process.env.JWT_SECRET = 'test-jwt-secret-key-for-testing-only';
process.env.JWT_REFRESH_SECRET = 'test-jwt-refresh-secret-key-for-testing-only';
process.env.JWT_EXPIRES_IN = '1h';
process.env.JWT_REFRESH_EXPIRES_IN = '7d';
process.env.NODE_ENV = 'test';

// ── Mock Firestore so firebase-admin is never initialised ─────────────────────
jest.mock('../../config/firestore', () => ({
  collection: jest.fn().mockReturnThis(),
  doc: jest.fn().mockReturnThis(),
  get: jest.fn().mockResolvedValue({ exists: false, data: () => ({}) }),
  set: jest.fn().mockResolvedValue({}),
  update: jest.fn().mockResolvedValue({}),
  delete: jest.fn().mockResolvedValue({}),
  where: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
}));

const {
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
} = require('../../utils/jwt');

// ── Test data ─────────────────────────────────────────────────────────────────

const testUser = {
  id: 'firestore-uid-abc123',
  email: 'test@morty.co.il',
};

// ── generateAccessToken ───────────────────────────────────────────────────────

describe('generateAccessToken', () => {
  it('should generate a valid JWT token', () => {
    const token = generateAccessToken(testUser);
    expect(token).toBeDefined();
    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3); // JWT has 3 parts
  });

  it('should include user id and email in payload', () => {
    const token = generateAccessToken(testUser);
    const decoded = jwt.decode(token);

    expect(decoded.id).toBe(testUser.id);
    expect(decoded.email).toBe(testUser.email);
  });

  it('should use a Firestore string ID (not ObjectId)', () => {
    const token = generateAccessToken(testUser);
    const decoded = jwt.decode(token);

    // Firestore IDs are strings, not 24-char hex ObjectIds
    expect(typeof decoded.id).toBe('string');
    expect(decoded.id).toBe('firestore-uid-abc123');
  });

  it('should set an expiry claim', () => {
    const token = generateAccessToken(testUser);
    const decoded = jwt.decode(token);

    expect(decoded.exp).toBeDefined();
    expect(decoded.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });
});

// ── generateRefreshToken ──────────────────────────────────────────────────────

describe('generateRefreshToken', () => {
  it('should generate a valid refresh token', () => {
    const token = generateRefreshToken(testUser);
    expect(token).toBeDefined();
    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3);
  });

  it('should include user id in payload', () => {
    const token = generateRefreshToken(testUser);
    const decoded = jwt.decode(token);

    expect(decoded.id).toBe(testUser.id);
  });

  it('should set a longer expiry than access token', () => {
    const accessToken = generateAccessToken(testUser);
    const refreshToken = generateRefreshToken(testUser);

    const accessDecoded = jwt.decode(accessToken);
    const refreshDecoded = jwt.decode(refreshToken);

    // Refresh token should expire later than access token
    expect(refreshDecoded.exp).toBeGreaterThan(accessDecoded.exp);
  });
});

// ── verifyAccessToken ─────────────────────────────────────────────────────────

describe('verifyAccessToken', () => {
  it('should verify a valid access token', () => {
    const token = generateAccessToken(testUser);
    const decoded = verifyAccessToken(token);

    expect(decoded.id).toBe(testUser.id);
    expect(decoded.email).toBe(testUser.email);
  });

  it('should throw for an invalid token', () => {
    expect(() => verifyAccessToken('invalid.token.here')).toThrow();
  });

  it('should throw for an expired token', () => {
    const expiredToken = jwt.sign(
      { id: testUser.id },
      process.env.JWT_SECRET,
      { expiresIn: '-1s' } // Already expired
    );

    expect(() => verifyAccessToken(expiredToken)).toThrow();
  });

  it('should throw for a tampered token', () => {
    const token = generateAccessToken(testUser);
    const tampered = token.slice(0, -5) + 'XXXXX';

    expect(() => verifyAccessToken(tampered)).toThrow();
  });

  it('should throw JsonWebTokenError for wrong secret', () => {
    const wrongToken = jwt.sign({ id: testUser.id }, 'wrong-secret', { expiresIn: '1h' });
    expect(() => verifyAccessToken(wrongToken)).toThrow();
  });
});

// ── verifyRefreshToken ────────────────────────────────────────────────────────

describe('verifyRefreshToken', () => {
  it('should verify a valid refresh token', () => {
    const token = generateRefreshToken(testUser);
    const decoded = verifyRefreshToken(token);

    expect(decoded.id).toBe(testUser.id);
  });

  it('should throw for an invalid refresh token', () => {
    expect(() => verifyRefreshToken('invalid-token')).toThrow();
  });

  it('should not verify an access token as a refresh token', () => {
    // Access token is signed with JWT_SECRET; refresh token uses JWT_REFRESH_SECRET
    // They are different secrets, so cross-verification should fail.
    const accessToken = generateAccessToken(testUser);
    expect(() => verifyRefreshToken(accessToken)).toThrow();
  });

  it('should throw for an expired refresh token', () => {
    const expiredToken = jwt.sign(
      { id: testUser.id },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: '-1s' }
    );

    expect(() => verifyRefreshToken(expiredToken)).toThrow();
  });
});

// ── protect middleware ────────────────────────────────────────────────────────

describe('protect middleware (auth.js)', () => {
  const request = require('supertest');
  const express = require('express');

  // Mock userService for the protect middleware
  jest.mock('../../services/userService', () => ({
    getUserById: jest.fn().mockResolvedValue({
      id: 'firestore-uid-abc123',
      email: 'test@morty.co.il',
      phone: '050-0000000',
      verified: true,
    }),
  }));

  const { protect } = require('../../middleware/auth');

  const createApp = () => {
    const app = express();
    app.use(express.json());
    app.get('/protected', protect, (req, res) => {
      res.json({ success: true, userId: req.user.id });
    });
    return app;
  };

  it('should reject requests without Authorization header (401)', async () => {
    const app = createApp();
    const res = await request(app).get('/protected');
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('should reject requests with invalid token (401)', async () => {
    const app = createApp();
    const res = await request(app)
      .get('/protected')
      .set('Authorization', 'Bearer invalid.token.here');
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('should reject requests with expired token (401)', async () => {
    const app = createApp();
    const expiredToken = jwt.sign(
      { id: testUser.id },
      process.env.JWT_SECRET,
      { expiresIn: '-1s' }
    );
    const res = await request(app)
      .get('/protected')
      .set('Authorization', `Bearer ${expiredToken}`);
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('should allow requests with valid token and attach user (200)', async () => {
    const app = createApp();
    const token = generateAccessToken(testUser);
    const res = await request(app)
      .get('/protected')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.userId).toBe('firestore-uid-abc123');
  });

  it('should reject requests with malformed Authorization header (401)', async () => {
    const app = createApp();
    const res = await request(app)
      .get('/protected')
      .set('Authorization', 'Token not-bearer-format');
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });
});
