/**
 * Integration tests for authentication endpoints.
 * Uses supertest to make HTTP requests against the Express app.
 *
 * NOTE: Requires a running MongoDB instance (set TEST_MONGODB_URI or MONGODB_URI).
 * In CI, use mongodb-memory-server or a dedicated test Atlas cluster.
 */

const request = require('supertest');
const mongoose = require('mongoose');

// Set test environment variables before requiring the app
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test_jwt_secret_for_unit_tests_only';
process.env.JWT_REFRESH_SECRET = 'test_refresh_secret_for_unit_tests_only';
process.env.MONGODB_URI =
  process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/morty_test';

const app = require('../src/index');
const User = require('../src/models/User');

const TEST_USER = {
  email: 'test@example.com',
  password: 'Test@1234!',
  phone: '+972501234567',
};

beforeAll(async () => {
  // Wait for mongoose to connect (app connects on startup)
  await new Promise((resolve) => {
    if (mongoose.connection.readyState === 1) return resolve();
    mongoose.connection.once('connected', resolve);
  });
});

afterEach(async () => {
  // Clean up test users between tests
  await User.deleteMany({ email: TEST_USER.email });
});

afterAll(async () => {
  await mongoose.connection.close();
});

// ─── Register ────────────────────────────────────────────────────────────────

describe('POST /api/v1/auth/register', () => {
  it('should register a new user and return tokens', async () => {
    const res = await request(app).post('/api/v1/auth/register').send(TEST_USER);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.token).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();
    expect(res.body.user.email).toBe(TEST_USER.email);
    expect(res.body.user.password).toBeUndefined();
  });

  it('should return 409 if email is already registered', async () => {
    await request(app).post('/api/v1/auth/register').send(TEST_USER);
    const res = await request(app).post('/api/v1/auth/register').send(TEST_USER);

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
  });

  it('should return 422 for invalid email', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ ...TEST_USER, email: 'not-an-email' });

    expect(res.status).toBe(422);
  });

  it('should return 422 for weak password', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ ...TEST_USER, password: 'weakpass' });

    expect(res.status).toBe(422);
  });

  it('should return 422 for invalid Israeli phone number', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ ...TEST_USER, phone: '123456789' });

    expect(res.status).toBe(422);
  });
});

// ─── Login ───────────────────────────────────────────────────────────────────

describe('POST /api/v1/auth/login', () => {
  beforeEach(async () => {
    await request(app).post('/api/v1/auth/register').send(TEST_USER);
  });

  it('should login with valid credentials and return tokens', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: TEST_USER.email, password: TEST_USER.password });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.token).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();
    expect(res.body.user.email).toBe(TEST_USER.email);
  });

  it('should return 401 for wrong password', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: TEST_USER.email, password: 'WrongPass@1' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('should return 401 for non-existent email', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@example.com', password: TEST_USER.password });

    expect(res.status).toBe(401);
  });

  it('should return 422 for missing fields', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ email: TEST_USER.email });

    expect(res.status).toBe(422);
  });
});

// ─── Refresh ─────────────────────────────────────────────────────────────────

describe('POST /api/v1/auth/refresh', () => {
  let refreshToken;

  beforeEach(async () => {
    const res = await request(app).post('/api/v1/auth/register').send(TEST_USER);
    refreshToken = res.body.refreshToken;
  });

  it('should issue new tokens for a valid refresh token', async () => {
    const res = await request(app).post('/api/v1/auth/refresh').send({ refreshToken });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();
    // Rotated — new refresh token should differ from the old one
    expect(res.body.refreshToken).not.toBe(refreshToken);
  });

  it('should return 401 for an invalid refresh token', async () => {
    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: 'invalid.token.here' });

    expect(res.status).toBe(401);
  });

  it('should return 400 when refresh token is missing', async () => {
    const res = await request(app).post('/api/v1/auth/refresh').send({});

    expect(res.status).toBe(422); // Joi validation
  });
});

// ─── Logout ──────────────────────────────────────────────────────────────────

describe('POST /api/v1/auth/logout', () => {
  let accessToken;
  let refreshToken;

  beforeEach(async () => {
    const res = await request(app).post('/api/v1/auth/register').send(TEST_USER);
    accessToken = res.body.token;
    refreshToken = res.body.refreshToken;
  });

  it('should logout successfully with a valid access token', async () => {
    const res = await request(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('should invalidate the refresh token after logout', async () => {
    await request(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`);

    // Attempting to use the old refresh token should now fail
    const res = await request(app).post('/api/v1/auth/refresh').send({ refreshToken });
    expect(res.status).toBe(401);
  });

  it('should return 401 without an access token', async () => {
    const res = await request(app).post('/api/v1/auth/logout');
    expect(res.status).toBe(401);
  });
});

// ─── Me ──────────────────────────────────────────────────────────────────────

describe('GET /api/v1/auth/me', () => {
  let accessToken;

  beforeEach(async () => {
    const res = await request(app).post('/api/v1/auth/register').send(TEST_USER);
    accessToken = res.body.token;
  });

  it('should return the current user profile', async () => {
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(TEST_USER.email);
    expect(res.body.user.password).toBeUndefined();
  });

  it('should return 401 without a token', async () => {
    const res = await request(app).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
  });
});
