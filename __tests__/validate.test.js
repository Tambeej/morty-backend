/**
 * Validation middleware unit tests
 */
const { validate, registerSchema, loginSchema, financialSchema } = require('../src/middleware/validate');
const httpMocks = require('node-mocks-http');

describe('validate middleware', () => {
  it('calls next() on valid register payload', () => {
    const req = httpMocks.createRequest({ body: { email: 'a@b.com', password: 'Password1' } });
    const res = httpMocks.createResponse();
    const next = jest.fn();
    validate(registerSchema)(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('returns 422 on invalid register payload', () => {
    const req = httpMocks.createRequest({ body: { email: 'bad', password: 'x' } });
    const res = httpMocks.createResponse();
    const next = jest.fn();
    validate(registerSchema)(req, res, next);
    expect(res.statusCode).toBe(422);
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next() on valid login payload', () => {
    const req = httpMocks.createRequest({ body: { email: 'a@b.com', password: 'anypass' } });
    const res = httpMocks.createResponse();
    const next = jest.fn();
    validate(loginSchema)(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('calls next() on valid financial payload', () => {
    const req = httpMocks.createRequest({
      body: {
        income: 15000,
        expenses: { housing: 3000, loans: 1000, other: 500 },
        assets: { savings: 50000, investments: 20000 },
      },
    });
    const res = httpMocks.createResponse();
    const next = jest.fn();
    validate(financialSchema)(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});
