/**
 * Integration tests for the financial profile API endpoints.
 * Tests GET and PUT /api/v1/profile/financials.
 */

const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../index');
const User = require('../models/User');
const Financial = require('../models/Financial');
const jwt = require('jsonwebtoken');

// Use in-memory or test DB
beforeAll(async () => {
  const uri = process.env.MONGODB_URI_TEST || process.env.MONGODB_URI;
  if (uri && mongoose.connection.readyState === 0) {
    await mongoose.connect(uri);
  }
});

afterAll(async () => {
  await mongoose.connection.close();
});

// Helper: create a test user and return a valid JWT
const createTestUser = async () => {
  const email = `test_${Date.now()}@morty.test`;
  const user = await User.create({
    email,
    password: 'TestPass123!',
  });
  const token = jwt.sign(
    { id: user._id, email: user.email },
    process.env.JWT_SECRET || 'test_secret',
    { expiresIn: '1h' }
  );
  return { user, token };
};

describe('GET /api/v1/profile/financials', () => {
  it('should return 401 without auth token', async () => {
    const res = await request(app).get('/api/v1/profile/financials');
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('should return empty profile for new user', async () => {
    const { token } = await createTestUser();
    const res = await request(app)
      .get('/api/v1/profile/financials')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.income).toBe(0);
    expect(res.body.data.debts).toEqual([]);
    expect(res.body.data.metrics).toBeDefined();
  });

  it('should return existing financial profile', async () => {
    const { user, token } = await createTestUser();
    await Financial.create({
      userId: user._id,
      income: 15000,
      expenses: { housing: 3000, loans: 1000, other: 500 },
      assets: { savings: 50000, investments: 20000 },
      debts: [{ type: 'Car loan', amount: 30000 }],
    });

    const res = await request(app)
      .get('/api/v1/profile/financials')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.income).toBe(15000);
    expect(res.body.data.metrics.totalIncome).toBe(15000);
    expect(res.body.data.metrics.totalExpenses).toBe(4500);
    expect(res.body.data.metrics.disposableIncome).toBe(10500);
  });
});

describe('PUT /api/v1/profile/financials', () => {
  it('should return 401 without auth token', async () => {
    const res = await request(app)
      .put('/api/v1/profile/financials')
      .send({ income: 10000 });
    expect(res.status).toBe(401);
  });

  it('should return 422 for invalid data', async () => {
    const { token } = await createTestUser();
    const res = await request(app)
      .put('/api/v1/profile/financials')
      .set('Authorization', `Bearer ${token}`)
      .send({ income: -500 }); // negative income

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(res.body.errors).toBeDefined();
  });

  it('should return 422 when body is empty', async () => {
    const { token } = await createTestUser();
    const res = await request(app)
      .put('/api/v1/profile/financials')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(422);
  });

  it('should create financial profile for new user', async () => {
    const { token } = await createTestUser();
    const payload = {
      income: 20000,
      additionalIncome: 3000,
      expenses: { housing: 4000, loans: 1500, other: 800 },
      assets: { savings: 100000, investments: 50000 },
      debts: [{ type: 'Student loan', amount: 25000 }],
    };

    const res = await request(app)
      .put('/api/v1/profile/financials')
      .set('Authorization', `Bearer ${token}`)
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.income).toBe(20000);
    expect(res.body.data.additionalIncome).toBe(3000);
    expect(res.body.data.debts).toHaveLength(1);
    expect(res.body.data.metrics.totalIncome).toBe(23000);
    expect(res.body.data.metrics.totalExpenses).toBe(6300);
  });

  it('should support partial updates', async () => {
    const { user, token } = await createTestUser();
    await Financial.create({
      userId: user._id,
      income: 15000,
      expenses: { housing: 3000, loans: 1000, other: 500 },
    });

    // Only update income
    const res = await request(app)
      .put('/api/v1/profile/financials')
      .set('Authorization', `Bearer ${token}`)
      .send({ income: 18000 });

    expect(res.status).toBe(200);
    expect(res.body.data.income).toBe(18000);
    // Expenses should remain unchanged
    expect(res.body.data.expenses.housing).toBe(3000);
  });

  it('should validate debt entries', async () => {
    const { token } = await createTestUser();
    const res = await request(app)
      .put('/api/v1/profile/financials')
      .set('Authorization', `Bearer ${token}`)
      .send({
        income: 10000,
        debts: [{ type: 'Car', amount: -1000 }], // negative amount
      });

    expect(res.status).toBe(422);
    expect(res.body.errors).toBeDefined();
  });
});
