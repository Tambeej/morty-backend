/**
 * Auth API integration tests
 *
 * Tests the auth endpoints using supertest against the Express app.
 * The Firestore userService is mocked so no live database is required.
 */

'use strict';

const request = require('supertest');

// ── Environment setup (must happen before requiring app) ──────────────────────
process.env.JWT_SECRET = 'test-jwt-secret-for-testing-only-32chars';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-for-testing-only-32chars';
process.env.NODE_ENV = 'test';

// ── Mock Firestore config so firebase-admin is never initialised ──────────────
jest.mock('../src/config/firestore', () => ({
  collection: jest.fn(),
}));

// ── Mock userService ──────────────────────────────────────────────────────────
const mockUser = {
  id: 'firestore-uid-abc123',
  email: 'test@morty.co.il',
  phone: '0501234567',
  verified: false,
  password: '$2a$12$hashedpassword',
  refreshToken: null,
  createdAt: '2026-04-03T02:16:00.000Z',
  updatedAt: '2026-04-03T02:16:00.000Z',
};

const mockPublicUser = {
  id: mockUser.id,
  email: mockUser.email,
  phone: mockUser.phone,
  verified: mockUser.verified,
  createdAt: mockUser.createdAt,
  updatedAt: mockUser.updatedAt,
};

jest.mock('../src/services/userService', () => ({
  createUser: jest.fn(),
  findByEmail: jest.fn(),
  findById: jest.fn(),
  getUserById: jest.fn(),
  setRefreshToken: jest.fn().mockResolvedValue(undefined),
  clearRefreshToken: jest.fn().mockResolvedValue(undefined),
  clearRefreshTokenByValue: jest.fn().mockResolvedValue(undefined),
  verifyPassword: jest.fn(),
  toPublicUser: jest.fn((user) => {
    const { password, refreshToken, ...pub } = user; // eslint-disable-line no-unused-vars
    return pub;
  }),
}));

const userService = require('../src/services/userService');
const app = require('../src/index');

// ── Health check ──────────────────────────────────────────────────────────────

describe('GET /health', () => {
  it('should return 200 ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

// ── Register ──────────────────────────────────────────────────────────────────

describe('POST /api/v1/auth/register', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should reject invalid email (422)', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({
      email: 'not-an-email',
      password: 'Password123',
    });
    expect(res.status).toBe(422);
  });

  it('should reject short password (422)', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({
      email: 'new@example.com',
      password: 'short',
    });
    expect(res.status).toBe(422);
  });

  it('should register a new user and return tokens (201)', async () => {
    userService.createUser.mockResolvedValue(mockPublicUser);

    const res = await request(app).post('/api/v1/auth/register').send({
      email: 'test@morty.co.il',
      password: 'Password123!',
      phone: '0501234567',
    });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('token');
    expect(res.body.data).toHaveProperty('refreshToken');
    expect(res.body.data.user).toMatchObject({
      id: mockPublicUser.id,
      email: mockPublicUser.email,
    });
    expect(userService.createUser).toHaveBeenCalledWith({
      email: 'test@morty.co.il',
      password: 'Password123!',
      phone: '0501234567',
    });
    expect(userService.setRefreshToken).toHaveBeenCalledWith(
      mockPublicUser.id,
      expect.any(String)
    );
  });

  it('should return 409 when email is already registered', async () => {
    const conflictErr = new Error('Email already registered');
    conflictErr.statusCode = 409;
    userService.createUser.mockRejectedValue(conflictErr);

    const res = await request(app).post('/api/v1/auth/register').send({
      email: 'existing@morty.co.il',
      password: 'Password123!',
    });

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
  });
});

// ── Login ─────────────────────────────────────────────────────────────────────

describe('POST /api/v1/auth/login', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should reject missing credentials (422)', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({});
    expect(res.status).toBe(422);
  });

  it('should return 401 for unknown email', async () => {
    userService.findByEmail.mockResolvedValue(null);

    const res = await request(app).post('/api/v1/auth/login').send({
      email: 'unknown@morty.co.il',
      password: 'Password123!',
    });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('should return 401 for wrong password', async () => {
    userService.findByEmail.mockResolvedValue(mockUser);
    userService.verifyPassword.mockResolvedValue(false);

    const res = await request(app).post('/api/v1/auth/login').send({
      email: 'test@morty.co.il',
      password: 'WrongPassword!',
    });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('should login successfully and return tokens (200)', async () => {
    userService.findByEmail.mockResolvedValue(mockUser);
    userService.verifyPassword.mockResolvedValue(true);

    const res = await request(app).post('/api/v1/auth/login').send({
      email: 'test@morty.co.il',
      password: 'Password123!',
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('token');
    expect(res.body.data).toHaveProperty('refreshToken');
    expect(res.body.data.user).toMatchObject({
      id: mockUser.id,
      email: mockUser.email,
    });
    expect(userService.setRefreshToken).toHaveBeenCalledWith(
      mockUser.id,
      expect.any(String)
    );
  });
});

// ── Refresh ───────────────────────────────────────────────────────────────────

describe('POST /api/v1/auth/refresh', () => {
  const jwt = require('jsonwebtoken');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should reject missing refreshToken (422)', async () => {
    const res = await request(app).post('/api/v1/auth/refresh').send({});
    expect(res.status).toBe(422);
  });

  it('should return 401 for an invalid refresh token', async () => {
    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: 'invalid.token.here' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('should rotate tokens successfully (200)', async () => {
    // Generate a valid refresh token signed with the test secret
    const validRefreshToken = jwt.sign(
      { id: mockUser.id },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: '7d' }
    );

    userService.findById.mockResolvedValue({ ...mockUser, refreshToken: validRefreshToken });

    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: validRefreshToken });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('token');
    expect(res.body.data).toHaveProperty('refreshToken');
    expect(userService.setRefreshToken).toHaveBeenCalledWith(
      mockUser.id,
      expect.any(String)
    );
  });

  it('should return 401 when stored token does not match', async () => {
    const validRefreshToken = jwt.sign(
      { id: mockUser.id },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: '7d' }
    );

    // Stored token is different
    userService.findById.mockResolvedValue({ ...mockUser, refreshToken: 'different-token' });

    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: validRefreshToken });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });
});

// ── Logout ────────────────────────────────────────────────────────────────────

describe('POST /api/v1/auth/logout', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should logout successfully with a refresh token (200)', async () => {
    const res = await request(app)
      .post('/api/v1/auth/logout')
      .send({ refreshToken: 'some-refresh-token' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(userService.clearRefreshTokenByValue).toHaveBeenCalledWith('some-refresh-token');
  });

  it('should logout successfully without a refresh token (200)', async () => {
    const res = await request(app).post('/api/v1/auth/logout').send({});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
