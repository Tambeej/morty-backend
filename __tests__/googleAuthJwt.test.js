/**
 * Google Auth – JWT Token Generation Integration Tests
 *
 * Verifies that POST /api/v1/auth/google generates valid, correctly-structured
 * access and refresh JWT tokens upon successful Firebase ID token verification.
 *
 * This test suite focuses exclusively on the token generation step (Task 3):
 *   - Both tokens are present in the response
 *   - Tokens are valid JWTs (3-part structure)
 *   - Access token payload contains the Firestore user ID
 *   - Access token expiry is shorter than refresh token expiry
 *   - Refresh token is persisted via userService.setRefreshToken
 *   - Tokens can be independently verified with the correct secrets
 *   - Access token cannot be verified as a refresh token (secret separation)
 *   - Refresh token cannot be verified as an access token (secret separation)
 *
 * All external dependencies (Firebase Admin, Firestore, userService) are mocked
 * so no live infrastructure is required.
 */

'use strict';

const request = require('supertest');
const jwt = require('jsonwebtoken');

// ── Environment setup (must happen before requiring app) ──────────────────────
process.env.JWT_SECRET = 'test-access-secret-for-google-jwt-tests-32ch';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-for-google-jwt-tests-32ch';
process.env.JWT_EXPIRES_IN = '15m';
process.env.JWT_REFRESH_EXPIRES_IN = '7d';
process.env.NODE_ENV = 'test';

// ── Mock Firestore (prevent firebase-admin initialisation) ────────────────────
jest.mock('../src/config/firestore', () => ({
  collection: jest.fn(),
}));

// ── Mock Firebase Admin SDK ───────────────────────────────────────────────────
const mockVerifyIdToken = jest.fn();
jest.mock('../src/config/firebase', () => ({
  admin: {
    auth: () => ({
      verifyIdToken: mockVerifyIdToken,
    }),
  },
  db: { collection: jest.fn() },
  firebaseApp: {},
}));

// ── Mock userService ──────────────────────────────────────────────────────────
const FIRESTORE_USER_ID = 'firestore-doc-id-google-jwt-test';

const mockGooglePublicUser = {
  id: FIRESTORE_USER_ID,
  email: 'googleuser@gmail.com',
  phone: '',
  verified: true,
  firebaseUid: 'firebase-google-uid-jwt-test',
  createdAt: '2026-04-03T10:00:00.000Z',
  updatedAt: '2026-04-03T10:00:00.000Z',
};

const mockSetRefreshToken = jest.fn().mockResolvedValue(undefined);
const mockFindOrCreate = jest.fn().mockResolvedValue(mockGooglePublicUser);

jest.mock('../src/services/userService', () => ({
  createUser: jest.fn(),
  findByEmail: jest.fn(),
  findById: jest.fn(),
  getUserById: jest.fn(),
  findOrCreateByFirebaseUser: mockFindOrCreate,
  setRefreshToken: mockSetRefreshToken,
  clearRefreshToken: jest.fn().mockResolvedValue(undefined),
  clearRefreshTokenByValue: jest.fn().mockResolvedValue(undefined),
  verifyPassword: jest.fn(),
  toPublicUser: jest.fn((user) => {
    const { password, refreshToken, ...pub } = user; // eslint-disable-line no-unused-vars
    return pub;
  }),
}));

const app = require('../src/index');

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Decoded JWT payload (without verification). */
const decode = (token) => jwt.decode(token);

/** Verify token with the access secret. */
const verifyAccess = (token) =>
  jwt.verify(token, process.env.JWT_SECRET);

/** Verify token with the refresh secret. */
const verifyRefresh = (token) =>
  jwt.verify(token, process.env.JWT_REFRESH_SECRET);

/** POST /api/v1/auth/google with a valid-looking idToken. */
const googleSignIn = (idToken = 'valid.firebase.id.token') =>
  request(app).post('/api/v1/auth/google').send({ idToken });

// ── Setup: configure Firebase mock to return valid decoded claims ──────────────

beforeEach(() => {
  jest.clearAllMocks();

  // Default: Firebase verifyIdToken succeeds
  mockVerifyIdToken.mockResolvedValue({
    uid: 'firebase-google-uid-jwt-test',
    email: 'googleuser@gmail.com',
    email_verified: true,
    name: 'Google User',
  });

  // Default: findOrCreateByFirebaseUser returns the mock public user
  mockFindOrCreate.mockResolvedValue(mockGooglePublicUser);

  // Default: setRefreshToken succeeds
  mockSetRefreshToken.mockResolvedValue(undefined);
});

// ── Token presence ────────────────────────────────────────────────────────────

describe('POST /api/v1/auth/google – JWT token presence', () => {
  it('should return HTTP 200 on successful Google sign-in', async () => {
    const res = await googleSignIn();
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('should include an access token (token) in the response data', async () => {
    const res = await googleSignIn();
    expect(res.body.data).toHaveProperty('token');
    expect(typeof res.body.data.token).toBe('string');
    expect(res.body.data.token.length).toBeGreaterThan(0);
  });

  it('should include a refresh token in the response data', async () => {
    const res = await googleSignIn();
    expect(res.body.data).toHaveProperty('refreshToken');
    expect(typeof res.body.data.refreshToken).toBe('string');
    expect(res.body.data.refreshToken.length).toBeGreaterThan(0);
  });

  it('should include the user object in the response data', async () => {
    const res = await googleSignIn();
    expect(res.body.data).toHaveProperty('user');
    expect(res.body.data.user).toMatchObject({
      id: FIRESTORE_USER_ID,
      email: 'googleuser@gmail.com',
      verified: true,
    });
  });
});

// ── Token structure ───────────────────────────────────────────────────────────

describe('POST /api/v1/auth/google – JWT token structure', () => {
  it('access token should be a valid 3-part JWT', async () => {
    const res = await googleSignIn();
    const parts = res.body.data.token.split('.');
    expect(parts).toHaveLength(3);
  });

  it('refresh token should be a valid 3-part JWT', async () => {
    const res = await googleSignIn();
    const parts = res.body.data.refreshToken.split('.');
    expect(parts).toHaveLength(3);
  });

  it('access token payload should contain the Firestore user ID', async () => {
    const res = await googleSignIn();
    const decoded = decode(res.body.data.token);
    expect(decoded).toHaveProperty('id', FIRESTORE_USER_ID);
  });

  it('refresh token payload should contain the Firestore user ID', async () => {
    const res = await googleSignIn();
    const decoded = decode(res.body.data.refreshToken);
    expect(decoded).toHaveProperty('id', FIRESTORE_USER_ID);
  });

  it('access token should have an expiry claim (exp)', async () => {
    const res = await googleSignIn();
    const decoded = decode(res.body.data.token);
    expect(decoded).toHaveProperty('exp');
    expect(decoded.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('refresh token should have an expiry claim (exp)', async () => {
    const res = await googleSignIn();
    const decoded = decode(res.body.data.refreshToken);
    expect(decoded).toHaveProperty('exp');
    expect(decoded.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });
});

// ── Token expiry ──────────────────────────────────────────────────────────────

describe('POST /api/v1/auth/google – JWT token expiry', () => {
  it('refresh token should expire later than access token', async () => {
    const res = await googleSignIn();
    const accessDecoded = decode(res.body.data.token);
    const refreshDecoded = decode(res.body.data.refreshToken);

    expect(refreshDecoded.exp).toBeGreaterThan(accessDecoded.exp);
  });

  it('access token expiry should be approximately 15 minutes from now', async () => {
    const res = await googleSignIn();
    const decoded = decode(res.body.data.token);
    const now = Math.floor(Date.now() / 1000);

    // 15 minutes = 900 seconds; allow ±5 seconds for test execution time
    const expectedExpiry = now + 900;
    expect(decoded.exp).toBeGreaterThanOrEqual(expectedExpiry - 5);
    expect(decoded.exp).toBeLessThanOrEqual(expectedExpiry + 5);
  });

  it('refresh token expiry should be approximately 7 days from now', async () => {
    const res = await googleSignIn();
    const decoded = decode(res.body.data.refreshToken);
    const now = Math.floor(Date.now() / 1000);

    // 7 days = 604800 seconds; allow ±5 seconds for test execution time
    const expectedExpiry = now + 604800;
    expect(decoded.exp).toBeGreaterThanOrEqual(expectedExpiry - 5);
    expect(decoded.exp).toBeLessThanOrEqual(expectedExpiry + 5);
  });
});

// ── Token verification ────────────────────────────────────────────────────────

describe('POST /api/v1/auth/google – JWT token verification', () => {
  it('access token should be verifiable with JWT_SECRET', async () => {
    const res = await googleSignIn();
    expect(() => verifyAccess(res.body.data.token)).not.toThrow();
  });

  it('refresh token should be verifiable with JWT_REFRESH_SECRET', async () => {
    const res = await googleSignIn();
    expect(() => verifyRefresh(res.body.data.refreshToken)).not.toThrow();
  });

  it('access token should NOT be verifiable with JWT_REFRESH_SECRET (secret separation)', async () => {
    const res = await googleSignIn();
    expect(() => verifyRefresh(res.body.data.token)).toThrow();
  });

  it('refresh token should NOT be verifiable with JWT_SECRET (secret separation)', async () => {
    const res = await googleSignIn();
    expect(() => verifyAccess(res.body.data.refreshToken)).toThrow();
  });

  it('verified access token payload should contain the correct user ID', async () => {
    const res = await googleSignIn();
    const decoded = verifyAccess(res.body.data.token);
    expect(decoded.id).toBe(FIRESTORE_USER_ID);
  });

  it('verified refresh token payload should contain the correct user ID', async () => {
    const res = await googleSignIn();
    const decoded = verifyRefresh(res.body.data.refreshToken);
    expect(decoded.id).toBe(FIRESTORE_USER_ID);
  });
});

// ── Refresh token persistence ─────────────────────────────────────────────────

describe('POST /api/v1/auth/google – refresh token persistence', () => {
  it('should call userService.setRefreshToken with the user ID and generated token', async () => {
    const res = await googleSignIn();

    expect(mockSetRefreshToken).toHaveBeenCalledTimes(1);
    expect(mockSetRefreshToken).toHaveBeenCalledWith(
      FIRESTORE_USER_ID,
      res.body.data.refreshToken
    );
  });

  it('should persist the exact refresh token returned in the response', async () => {
    const res = await googleSignIn();
    const persistedToken = mockSetRefreshToken.mock.calls[0][1];

    expect(persistedToken).toBe(res.body.data.refreshToken);
  });

  it('should generate unique tokens on each sign-in', async () => {
    // Two separate sign-in calls should produce different tokens
    // (JWT iat claim differs between calls)
    const res1 = await googleSignIn('token-call-1');
    // Small delay to ensure different iat
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const res2 = await googleSignIn('token-call-2');

    // Tokens should be different strings (different iat)
    expect(res1.body.data.token).not.toBe(res2.body.data.token);
    expect(res1.body.data.refreshToken).not.toBe(res2.body.data.refreshToken);
  });
});

// ── Error cases (token generation should NOT occur) ───────────────────────────

describe('POST /api/v1/auth/google – no tokens on error', () => {
  it('should NOT return tokens when Firebase verification fails', async () => {
    mockVerifyIdToken.mockRejectedValue(new Error('Firebase: ID token has expired.'));

    const res = await googleSignIn('expired.token');

    expect(res.status).toBe(401);
    expect(res.body.data).toBeUndefined();
    expect(mockSetRefreshToken).not.toHaveBeenCalled();
  });

  it('should NOT return tokens when userService throws a conflict error', async () => {
    const conflictErr = new Error('Email conflict');
    conflictErr.statusCode = 409;
    mockFindOrCreate.mockRejectedValue(conflictErr);

    const res = await googleSignIn('valid.token.conflict');

    expect(res.status).toBe(409);
    expect(res.body.data).toBeUndefined();
    expect(mockSetRefreshToken).not.toHaveBeenCalled();
  });

  it('should NOT return tokens when idToken is missing', async () => {
    const res = await request(app).post('/api/v1/auth/google').send({});

    expect(res.status).toBe(422);
    expect(res.body.data).toBeUndefined();
    expect(mockSetRefreshToken).not.toHaveBeenCalled();
  });
});
