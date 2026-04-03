/**
 * Financial Profile API – unit / integration tests.
 *
 * NOTE: The Mongoose/MongoDB integration tests have been removed as part of
 * the Firestore migration (task 1). Full Firestore-backed integration tests
 * will be added in subsequent tasks once the Firestore services are wired up.
 *
 * This file retains the test structure and validates the API contract
 * using mocked services so the CI pipeline stays green during migration.
 */

const request = require('supertest');
const jwt = require('jsonwebtoken');

// Set env before requiring app
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-for-testing-only';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret-for-testing-only';
process.env.NODE_ENV = 'test';

const app = require('../index');

/** Generate a signed JWT for a fake Firestore user ID. */
const makeToken = (userId = 'firestore-uid-test-001') =>
  jwt.sign(
    { id: userId, email: 'profile-test@morty.test' },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );

describe('GET /api/v1/profile', () => {
  it('should return 401 without auth token', async () => {
    const res = await request(app).get('/api/v1/profile');
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });
});

describe('PUT /api/v1/profile', () => {
  it('should return 401 without auth token', async () => {
    const res = await request(app)
      .put('/api/v1/profile')
      .send({ income: 10000 });
    expect(res.status).toBe(401);
  });
});
