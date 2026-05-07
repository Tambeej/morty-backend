'use strict';

/**
 * Unit tests for the paidAccess middleware.
 */

const { paidAccess } = require('../src/middleware/paidAccess');
const { ForbiddenError } = require('../src/utils/errors');

describe('paidAccess middleware', () => {
  let req, res, next;

  beforeEach(() => {
    req = {};
    res = {};
    next = jest.fn();
  });

  it('should call next() when user has paidAnalyses = true', () => {
    req.user = { uid: 'user123', paidAnalyses: true };
    paidAccess(req, res, next);
    expect(next).toHaveBeenCalledWith();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('should call next(ForbiddenError) when user has paidAnalyses = false', () => {
    req.user = { uid: 'user123', paidAnalyses: false };
    paidAccess(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    const error = next.mock.calls[0][0];
    expect(error).toBeInstanceOf(ForbiddenError);
    expect(error.statusCode).toBe(403);
    expect(error.code).toBe('FORBIDDEN');
  });

  it('should call next(ForbiddenError) when user has no paidAnalyses field', () => {
    req.user = { uid: 'user123', email: 'test@example.com' };
    paidAccess(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    const error = next.mock.calls[0][0];
    expect(error).toBeInstanceOf(ForbiddenError);
    expect(error.statusCode).toBe(403);
  });

  it('should call next(ForbiddenError) when user has paidAnalyses = null', () => {
    req.user = { uid: 'user123', paidAnalyses: null };
    paidAccess(req, res, next);
    const error = next.mock.calls[0][0];
    expect(error).toBeInstanceOf(ForbiddenError);
  });

  it('should call next(ForbiddenError) when req.user is undefined', () => {
    req.user = undefined;
    paidAccess(req, res, next);
    const error = next.mock.calls[0][0];
    expect(error).toBeInstanceOf(ForbiddenError);
  });

  it('should include a descriptive error message', () => {
    req.user = { uid: 'user123', paidAnalyses: false };
    paidAccess(req, res, next);
    const error = next.mock.calls[0][0];
    expect(error.message).toContain('paid');
  });
});
