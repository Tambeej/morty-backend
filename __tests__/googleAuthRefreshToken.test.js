/**
 * Google Auth – Refresh Token Persistence & Auth Payload Tests
 *
 * Verifies that:
 *   1. The refresh token is persisted in Firestore after a successful Google sign-in.
 *   2. The auth payload returned to the frontend is compatible with the existing
 *      AuthContext / authService contract:
 *      { data: { token, refreshToken, user: { id, email, phone, verified } } }
 *   3. Refresh token rotation works for Google-authenticated users.
 *   4. Logout correctly clears the refresh token for Google users.
 *
 * All Firestore and Firebase Admin SDK calls are mocked – no live services required.
 */

'use strict';

const request = require('supertest');
const jwt = require('jsonwebtoken');

// ── Environment setup (must happen before requiring app) ──────────────────────
process.env.JWT_SECRET = 'test-jwt-secret-google-refresh-32chars';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-google-refresh-32chars';
process.env.NODE_ENV = 'test';

// ── Mock Firestore ────────────────────────────────────────────────────────────
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
const mockSetRefreshToken = jest.fn().mockResolvedValue(undefined);
const mockClearRefreshTokenByValue = jest.fn().mockResolvedValue(undefined);
const mockFindOrCreateByFirebaseUser = jest.fn();
const mockFindById = jest.fn();

jest.mock('../src/services/userService', () => ({
  createUser: jest.fn(),
  findByEmail: jest.fn(),
  findById: mockFindById,
  getUserById: jest.fn(),
  findOrCreateByFirebaseUser: mockFindOrCreateByFirebaseUser,
  setRefreshToken: mockSetRefreshToken,
  clearRefreshToken: jest.fn().mockResolvedValue(undefined),
  clearRefreshTokenByValue: mockClearRefreshTokenByValue,
  verifyPassword: jest.fn(),
  toPublicUser: jest.fn((user) => {
    if (!user) return null;
    const { password, refreshToken, ...pub } = user; // eslint-disable-line no-unused-vars
    return pub;
  }),
}));

const app = require('../src/index');

// ── Test fixtures ─────────────────────────────────────────────────────────────

/** Decoded Firebase token claims returned by Admin SDK verifyIdToken */
const decodedFirebaseToken = {
  uid: 'firebase-google-uid-xyz789',
  email: 'googleuser@gmail.com',
  email_verified: true,
  name: 'Google Test User',
};

/** Public user object returned by userService.findOrCreateByFirebaseUser */
const googlePublicUser = {
  id: 'firestore-doc-id-google-abc',
  email: 'googleuser@gmail.com',
  phone: '',
  verified: true,
  firebaseUid: 'firebase-google-uid-xyz789',
  createdAt: '2026-04-03T10:00:00.000Z',
  updatedAt: '2026-04-03T10:00:00.000Z',
};

// ── Helper ────────────────────────────────────────────────────────────────────

/**
 * Perform a successful POST /api/v1/auth/google request.
 * Sets up mocks and returns the supertest response.
 */
async function performGoogleSignIn(idToken = 'valid.firebase.id.token') {
  mockVerifyIdToken.mockResolvedValueOnce(decodedFirebaseToken);
  mockFindOrCreateByFirebaseUser.mockResolvedValueOnce(googlePublicUser);
  mockSetRefreshToken.mockResolvedValueOnce(undefined);

  return request(app)
    .post('/api/v1/auth/google')
    .send({ idToken });
}

// ── Test suites ───────────────────────────────────────────────────────────────

describe('Google Auth – Refresh Token Persistence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSetRefreshToken.mockResolvedValue(undefined);
    mockClearRefreshTokenByValue.mockResolvedValue(undefined);
  });

  // ── 1. Refresh token is persisted after successful Google sign-in ──────────

  describe('POST /api/v1/auth/google – refresh token persistence', () => {
    it('should call userService.setRefreshToken with the user ID and a JWT string', async () => {
      const res = await performGoogleSignIn();

      expect(res.status).toBe(200);

      // setRefreshToken must be called exactly once
      expect(mockSetRefreshToken).toHaveBeenCalledTimes(1);

      // First argument must be the Firestore user ID
      expect(mockSetRefreshToken).toHaveBeenCalledWith(
        googlePublicUser.id,
        expect.any(String)
      );
    });

    it('should persist a valid JWT as the refresh token', async () => {
      const res = await performGoogleSignIn();

      expect(res.status).toBe(200);

      // Extract the persisted refresh token from the mock call
      const persistedToken = mockSetRefreshToken.mock.calls[0][1];

      // It must be a valid JWT signed with JWT_REFRESH_SECRET
      const decoded = jwt.verify(persistedToken, process.env.JWT_REFRESH_SECRET);
      expect(decoded).toHaveProperty('id', googlePublicUser.id);
    });

    it('should persist the SAME refresh token that is returned in the response', async () => {
      const res = await performGoogleSignIn();

      expect(res.status).toBe(200);

      const returnedRefreshToken = res.body.data.refreshToken;
      const persistedRefreshToken = mockSetRefreshToken.mock.calls[0][1];

      // The token stored in Firestore must match the one sent to the client
      expect(persistedRefreshToken).toBe(returnedRefreshToken);
    });

    it('should persist the refresh token AFTER finding/creating the user', async () => {
      const callOrder = [];

      mockVerifyIdToken.mockResolvedValueOnce(decodedFirebaseToken);
      mockFindOrCreateByFirebaseUser.mockImplementationOnce(async () => {
        callOrder.push('findOrCreate');
        return googlePublicUser;
      });
      mockSetRefreshToken.mockImplementationOnce(async () => {
        callOrder.push('setRefreshToken');
      });

      const res = await request(app)
        .post('/api/v1/auth/google')
        .send({ idToken: 'valid.firebase.id.token' });

      expect(res.status).toBe(200);
      expect(callOrder).toEqual(['findOrCreate', 'setRefreshToken']);
    });
  });

  // ── 2. Auth payload is frontend-compatible ────────────────────────────────

  describe('POST /api/v1/auth/google – frontend-compatible auth payload', () => {
    it('should return HTTP 200 with success=true', async () => {
      const res = await performGoogleSignIn();

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should return payload wrapped in data envelope: { data: { token, refreshToken, user } }', async () => {
      const res = await performGoogleSignIn();

      // Top-level envelope
      expect(res.body).toHaveProperty('data');
      const { data } = res.body;

      // Required fields consumed by frontend authService.googleLogin()
      expect(data).toHaveProperty('token');
      expect(data).toHaveProperty('refreshToken');
      expect(data).toHaveProperty('user');
    });

    it('should return a valid JWT access token', async () => {
      const res = await performGoogleSignIn();

      const { token } = res.body.data;
      expect(typeof token).toBe('string');

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      expect(decoded).toHaveProperty('id', googlePublicUser.id);
    });

    it('should return a valid JWT refresh token', async () => {
      const res = await performGoogleSignIn();

      const { refreshToken } = res.body.data;
      expect(typeof refreshToken).toBe('string');

      const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
      expect(decoded).toHaveProperty('id', googlePublicUser.id);
    });

    it('should return user object with id, email, phone, and verified fields', async () => {
      const res = await performGoogleSignIn();

      const { user } = res.body.data;

      // These are the exact fields consumed by frontend normalizeUser()
      expect(user).toHaveProperty('id', googlePublicUser.id);
      expect(user).toHaveProperty('email', googlePublicUser.email);
      expect(user).toHaveProperty('phone', '');
      expect(user).toHaveProperty('verified', true);
    });

    it('should NOT expose password or refreshToken in the user object', async () => {
      const res = await performGoogleSignIn();

      const { user } = res.body.data;

      expect(user).not.toHaveProperty('password');
      expect(user).not.toHaveProperty('refreshToken');
    });

    it('should return access token with shorter expiry than refresh token', async () => {
      const res = await performGoogleSignIn();

      const { token, refreshToken } = res.body.data;

      const accessDecoded = jwt.decode(token);
      const refreshDecoded = jwt.decode(refreshToken);

      // Refresh token must expire later than access token
      expect(refreshDecoded.exp).toBeGreaterThan(accessDecoded.exp);
    });

    it('should include a timestamp in the response envelope', async () => {
      const res = await performGoogleSignIn();

      expect(res.body).toHaveProperty('timestamp');
      expect(() => new Date(res.body.timestamp)).not.toThrow();
    });
  });

  // ── 3. Refresh token rotation for Google-authenticated users ──────────────

  describe('POST /api/v1/auth/refresh – token rotation for Google users', () => {
    it('should rotate tokens for a Google-authenticated user', async () => {
      // First, simulate a Google sign-in to get a valid refresh token
      const signInRes = await performGoogleSignIn();
      expect(signInRes.status).toBe(200);

      const { refreshToken: originalRefreshToken } = signInRes.body.data;

      // Mock findById to return the Google user with the stored refresh token
      mockFindById.mockResolvedValueOnce({
        ...googlePublicUser,
        password: null,
        refreshToken: originalRefreshToken,
      });
      mockSetRefreshToken.mockResolvedValueOnce(undefined);

      const refreshRes = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: originalRefreshToken });

      expect(refreshRes.status).toBe(200);
      expect(refreshRes.body.success).toBe(true);
      expect(refreshRes.body.data).toHaveProperty('token');
      expect(refreshRes.body.data).toHaveProperty('refreshToken');

      // New refresh token must be different from the original (rotation)
      expect(refreshRes.body.data.refreshToken).not.toBe(originalRefreshToken);

      // setRefreshToken must be called with the new token
      expect(mockSetRefreshToken).toHaveBeenCalledWith(
        googlePublicUser.id,
        refreshRes.body.data.refreshToken
      );
    });

    it('should reject a refresh token that does not match the stored one', async () => {
      // Generate a valid-looking refresh token
      const validToken = jwt.sign(
        { id: googlePublicUser.id },
        process.env.JWT_REFRESH_SECRET,
        { expiresIn: '7d' }
      );

      // But the stored token is different (simulates token reuse attack)
      mockFindById.mockResolvedValueOnce({
        ...googlePublicUser,
        password: null,
        refreshToken: 'different-stored-token',
      });

      const res = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: validToken });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('REFRESH_TOKEN_MISMATCH');
    });
  });

  // ── 4. Logout clears refresh token for Google users ───────────────────────

  describe('POST /api/v1/auth/logout – clears refresh token for Google users', () => {
    it('should clear the refresh token when provided in the request body', async () => {
      // Simulate a Google sign-in to get a refresh token
      const signInRes = await performGoogleSignIn();
      const { refreshToken } = signInRes.body.data;

      const logoutRes = await request(app)
        .post('/api/v1/auth/logout')
        .send({ refreshToken });

      expect(logoutRes.status).toBe(200);
      expect(logoutRes.body.success).toBe(true);

      // clearRefreshTokenByValue must be called with the Google user's token
      expect(mockClearRefreshTokenByValue).toHaveBeenCalledWith(refreshToken);
    });

    it('should return 200 even when no refresh token is provided (graceful logout)', async () => {
      const res = await request(app)
        .post('/api/v1/auth/logout')
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  // ── 5. Error handling ─────────────────────────────────────────────────────

  describe('POST /api/v1/auth/google – error handling', () => {
    it('should NOT call setRefreshToken when Firebase token verification fails', async () => {
      mockVerifyIdToken.mockRejectedValueOnce(new Error('Firebase: ID token has expired.'));

      const res = await request(app)
        .post('/api/v1/auth/google')
        .send({ idToken: 'expired.firebase.token' });

      expect(res.status).toBe(401);
      expect(mockSetRefreshToken).not.toHaveBeenCalled();
    });

    it('should NOT call setRefreshToken when findOrCreateByFirebaseUser throws', async () => {
      mockVerifyIdToken.mockResolvedValueOnce(decodedFirebaseToken);
      const err = new Error('Firestore write failed');
      mockFindOrCreateByFirebaseUser.mockRejectedValueOnce(err);

      const res = await request(app)
        .post('/api/v1/auth/google')
        .send({ idToken: 'valid.firebase.id.token' });

      expect(res.status).toBe(500);
      expect(mockSetRefreshToken).not.toHaveBeenCalled();
    });

    it('should return 409 and NOT call setRefreshToken on email conflict', async () => {
      mockVerifyIdToken.mockResolvedValueOnce(decodedFirebaseToken);
      const conflictErr = new Error('Email already linked to a different Google account.');
      conflictErr.statusCode = 409;
      conflictErr.errorCode = 'CONFLICT_ERROR';
      mockFindOrCreateByFirebaseUser.mockRejectedValueOnce(conflictErr);

      const res = await request(app)
        .post('/api/v1/auth/google')
        .send({ idToken: 'valid.firebase.id.token' });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CONFLICT_ERROR');
      expect(mockSetRefreshToken).not.toHaveBeenCalled();
    });

    it('should return 422 when idToken is missing', async () => {
      const res = await request(app)
        .post('/api/v1/auth/google')
        .send({});

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(mockSetRefreshToken).not.toHaveBeenCalled();
      expect(mockVerifyIdToken).not.toHaveBeenCalled();
    });
  });
});
