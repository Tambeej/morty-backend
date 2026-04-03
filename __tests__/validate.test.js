/**
 * Validation middleware unit tests
 *
 * Tests the validate() middleware factory and all Joi schemas using
 * supertest against a minimal Express app (no node-mocks-http dependency).
 */

'use strict';

const request = require('supertest');
const express = require('express');

// ── Mock Firestore so firebase-admin is never initialised ─────────────────────
jest.mock('../src/config/firestore', () => ({
  collection: jest.fn(),
}));

const {
  validate,
  registerSchema,
  loginSchema,
  financialSchema,
  financialDataSchema,
  patchFinancialSchema,
} = require('../src/middleware/validate');

// ── Helper: create a minimal Express app for a given schema ──────────────────

/**
 * Build a minimal Express app that validates req.body with the given schema
 * and returns 200 + the validated body on success.
 *
 * @param {import('joi').Schema} schema
 * @param {string} [method='post']
 * @returns {import('express').Application}
 */
const createApp = (schema, method = 'post') => {
  const app = express();
  app.use(express.json());
  app[method]('/test', validate(schema), (req, res) => {
    res.json({ success: true, data: req.body });
  });
  return app;
};

// ── registerSchema ────────────────────────────────────────────────────────────

describe('validate middleware – registerSchema', () => {
  let app;

  beforeEach(() => {
    app = createApp(registerSchema);
  });

  it('calls next() on valid register payload (200)', async () => {
    const res = await request(app)
      .post('/test')
      .send({ email: 'a@b.com', password: 'Password1' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns 422 on invalid email', async () => {
    const res = await request(app)
      .post('/test')
      .send({ email: 'bad', password: 'Password1' });
    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 422 on short password', async () => {
    const res = await request(app)
      .post('/test')
      .send({ email: 'a@b.com', password: 'x' });
    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
  });

  it('returns 422 on missing required fields', async () => {
    const res = await request(app).post('/test').send({});
    expect(res.status).toBe(422);
    expect(res.body.error.details.length).toBeGreaterThan(0);
  });

  it('normalises email to lowercase', async () => {
    const res = await request(app)
      .post('/test')
      .send({ email: 'TEST@EXAMPLE.COM', password: 'Password1' });
    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe('test@example.com');
  });

  it('strips unknown fields', async () => {
    const res = await request(app)
      .post('/test')
      .send({ email: 'a@b.com', password: 'Password1', unknownField: 'should be removed' });
    expect(res.status).toBe(200);
    expect(res.body.data.unknownField).toBeUndefined();
  });

  it('accepts optional phone field', async () => {
    const res = await request(app)
      .post('/test')
      .send({ email: 'a@b.com', password: 'Password1', phone: '0501234567' });
    expect(res.status).toBe(200);
    expect(res.body.data.phone).toBe('0501234567');
  });
});

// ── loginSchema ───────────────────────────────────────────────────────────────

describe('validate middleware – loginSchema', () => {
  let app;

  beforeEach(() => {
    app = createApp(loginSchema);
  });

  it('calls next() on valid login payload (200)', async () => {
    const res = await request(app)
      .post('/test')
      .send({ email: 'a@b.com', password: 'anypass' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns 422 on missing email', async () => {
    const res = await request(app)
      .post('/test')
      .send({ password: 'anypass' });
    expect(res.status).toBe(422);
  });

  it('returns 422 on missing password', async () => {
    const res = await request(app)
      .post('/test')
      .send({ email: 'a@b.com' });
    expect(res.status).toBe(422);
  });

  it('returns 422 on empty body', async () => {
    const res = await request(app).post('/test').send({});
    expect(res.status).toBe(422);
  });
});

// ── financialSchema (PUT – full upsert) ───────────────────────────────────────

describe('validate middleware – financialSchema (PUT)', () => {
  let app;

  beforeEach(() => {
    app = createApp(financialSchema, 'put');
  });

  it('calls next() on valid financial payload (200)', async () => {
    const res = await request(app)
      .put('/test')
      .send({
        income: 15000,
        expenses: { housing: 3000, loans: 1000, other: 500 },
        assets: { savings: 50000, investments: 20000 },
      });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('calls next() on empty body (all defaults applied)', async () => {
    const res = await request(app).put('/test').send({});
    expect(res.status).toBe(200);
    expect(res.body.data.income).toBe(0);
    expect(res.body.data.debts).toEqual([]);
  });

  it('returns 422 when income is negative', async () => {
    const res = await request(app)
      .put('/test')
      .send({ income: -100 });
    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
  });

  it('returns 422 when debt item is missing required fields', async () => {
    const res = await request(app)
      .put('/test')
      .send({
        income: 10000,
        debts: [{ amount: 5000 }], // missing 'type'
      });
    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
  });

  it('returns 422 when too many debt entries (max 20)', async () => {
    const debts = Array.from({ length: 21 }, (_, i) => ({
      type: `debt ${i}`,
      amount: 1000,
    }));
    const res = await request(app).put('/test').send({ debts });
    expect(res.status).toBe(422);
  });

  it('applies defaults for missing optional nested fields', async () => {
    const res = await request(app)
      .put('/test')
      .send({ income: 10000 });
    expect(res.status).toBe(200);
    expect(res.body.data.expenses).toBeDefined();
    expect(res.body.data.assets).toBeDefined();
    expect(res.body.data.debts).toEqual([]);
  });
});

// ── financialDataSchema (alias) ───────────────────────────────────────────────

describe('financialDataSchema', () => {
  it('should be the same schema object as financialSchema', () => {
    expect(financialDataSchema).toBe(financialSchema);
  });
});

// ── patchFinancialSchema (PATCH – partial update) ─────────────────────────────

describe('validate middleware – patchFinancialSchema (PATCH)', () => {
  let app;

  beforeEach(() => {
    app = createApp(patchFinancialSchema, 'patch');
  });

  it('calls next() on valid partial payload (200)', async () => {
    const res = await request(app)
      .patch('/test')
      .send({ income: 20000 });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.income).toBe(20000);
  });

  it('returns 422 on empty body (at least one field required)', async () => {
    const res = await request(app).patch('/test').send({});
    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
  });

  it('returns 422 when income is negative', async () => {
    const res = await request(app)
      .patch('/test')
      .send({ income: -500 });
    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
  });

  it('accepts partial nested objects', async () => {
    const res = await request(app)
      .patch('/test')
      .send({ expenses: { housing: 3000 } });
    expect(res.status).toBe(200);
    expect(res.body.data.expenses.housing).toBe(3000);
  });

  it('does not apply defaults (only provided fields are returned)', async () => {
    const res = await request(app)
      .patch('/test')
      .send({ additionalIncome: 500 });
    expect(res.status).toBe(200);
    // Only additionalIncome should be in the validated body
    expect(res.body.data.additionalIncome).toBe(500);
    // income should NOT be defaulted to 0 in patch schema
    expect(res.body.data.income).toBeUndefined();
  });
});

// ── Error response format ─────────────────────────────────────────────────────

describe('validate middleware – error response format', () => {
  it('returns consistent error envelope on validation failure', async () => {
    const app = createApp(registerSchema);
    const res = await request(app)
      .post('/test')
      .send({ email: 'bad-email', password: 'x' });

    expect(res.status).toBe(422);
    expect(res.body).toHaveProperty('success', false);
    expect(res.body).toHaveProperty('error');
    expect(res.body.error).toHaveProperty('code', 'VALIDATION_ERROR');
    expect(res.body.error).toHaveProperty('message', 'Validation failed');
    expect(res.body.error).toHaveProperty('details');
    expect(Array.isArray(res.body.error.details)).toBe(true);
    expect(res.body.error).toHaveProperty('timestamp');
  });

  it('includes field-level details in error response', async () => {
    const app = createApp(registerSchema);
    const res = await request(app)
      .post('/test')
      .send({ email: 'bad-email', password: 'x' });

    expect(res.body.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: expect.any(String), message: expect.any(String) }),
      ])
    );
  });
});
