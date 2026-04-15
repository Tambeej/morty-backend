/**
 * Paid Access Middleware Tests
 *
 * Tests for the requirePaidAccess middleware that checks
 * whether a user has paid for enhanced analysis features.
 */

'use strict';

jest.mock('../src/config/firestore', () => {
  const mockDoc = {
    get: jest.fn(),
  };
  const mockCollection = jest.fn(() => ({
    doc: jest.fn(() => mockDoc),
  }));
  const mock = {
    collection: mockCollection,
    _mockDoc: mockDoc,
  };
  return mock;
});

jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const httpMocks = require('node-mocks-http');
const { requirePaidAccess } = require('../src/middleware/paidAccess');
const db = require('../src/config/firestore');

describe('requirePaidAccess middleware', () => {
  let req;
  let res;
  let next;

  beforeEach(() => {
    jest.clearAllMocks();
    req = httpMocks.createRequest();
    res = httpMocks.createResponse();
    // Attach json method that supertest/express would provide
    res.json = jest.fn().mockReturnValue(res);
    res.status = jest.fn().mockReturnValue(res);
    next = jest.fn();
  });

  it('should return 401 when req.user is missing', async () => {
    await requirePaidAccess(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: 'Authentication required' })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('should return 401 when user document does not exist', async () => {
    req.user = { id: 'user-123' };
    db._mockDoc.get.mockResolvedValue({ exists: false });

    await requirePaidAccess(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('should return 403 when user has not paid', async () => {
    req.user = { id: 'user-123' };
    db._mockDoc.get.mockResolvedValue({
      exists: true,
      data: () => ({ paidAnalyses: false }),
    });

    await requirePaidAccess(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        errorCode: 'PAYMENT_REQUIRED',
      })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('should return 403 when paidAnalyses is undefined', async () => {
    req.user = { id: 'user-123' };
    db._mockDoc.get.mockResolvedValue({
      exists: true,
      data: () => ({}),
    });

    await requirePaidAccess(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('should call next() when user has paid', async () => {
    req.user = { id: 'user-123' };
    db._mockDoc.get.mockResolvedValue({
      exists: true,
      data: () => ({ paidAnalyses: true }),
    });

    await requirePaidAccess(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('should return 500 on Firestore error', async () => {
    req.user = { id: 'user-123' };
    db._mockDoc.get.mockRejectedValue(new Error('Firestore unavailable'));

    await requirePaidAccess(req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(next).not.toHaveBeenCalled();
  });
});
