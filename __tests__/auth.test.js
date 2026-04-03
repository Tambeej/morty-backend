/**
 * Auth API integration tests
 *
 * NOTE: Mongoose/MongoDB setup has been removed as part of the Firestore
 * migration (task 1). These tests now validate the API contract without a
 * live database. Full Firestore-backed integration tests will be added in
 * subsequent tasks.
 */
const request = require('supertest');

// Set env before requiring app
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-for-testing-only';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret-for-testing-only';
process.env.NODE_ENV = 'test';

const app = require('../src/index');

describe('GET /health', () => {
  it('should return 200 ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

describe('POST /api/v1/auth/register – validation', () => {
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
});

describe('POST /api/v1/auth/login – validation', () => {
  it('should reject missing credentials (422)', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({});
    expect(res.status).toBe(422);
  });
});
