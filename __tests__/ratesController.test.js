/**
 * Tests for ratesController – HTTP endpoint tests.
 */

'use strict';

// Mock dependencies before requiring the controller
jest.mock('../src/services/ratesService');
jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const httpMocks = require('node-mocks-http');
const ratesController = require('../src/controllers/ratesController');
const ratesService = require('../src/services/ratesService');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('ratesController', () => {
  describe('getLatestRates', () => {
    it('should return 200 with rates data on success', async () => {
      const mockRates = {
        date: '2024-12-15T00:00:00.000Z',
        tracks: { fixed: { average: 4.5 } },
        averages: { fixed: 4.5, cpi: 3.0, prime: 6.0, variable: 5.0 },
        source: 'bank_of_israel',
        sourceUrl: 'https://www.boi.org.il',
        updatedAt: '2024-12-15T00:00:00.000Z',
      };

      ratesService.getLatestRates.mockResolvedValue(mockRates);

      const req = httpMocks.createRequest({ method: 'GET' });
      const res = httpMocks.createResponse();

      await ratesController.getLatestRates(req, res);

      expect(res.statusCode).toBe(200);
      const body = res._getJSONData();
      expect(body.success).toBe(true);
      expect(body.data).toBeTruthy();
      expect(body.data.averages.fixed).toBe(4.5);
    });

    it('should set Cache-Control header for 1 hour', async () => {
      ratesService.getLatestRates.mockResolvedValue({
        date: '2024-12-15T00:00:00.000Z',
        tracks: {},
        averages: {},
        source: 'bank_of_israel',
        updatedAt: '2024-12-15T00:00:00.000Z',
      });

      const req = httpMocks.createRequest({ method: 'GET' });
      const res = httpMocks.createResponse();

      await ratesController.getLatestRates(req, res);

      expect(res.getHeader('Cache-Control')).toBe('public, max-age=3600, s-maxage=3600');
    });

    it('should return 503 when rates are unavailable', async () => {
      ratesService.getLatestRates.mockResolvedValue(null);

      const req = httpMocks.createRequest({ method: 'GET' });
      const res = httpMocks.createResponse();

      await ratesController.getLatestRates(req, res);

      expect(res.statusCode).toBe(503);
      const body = res._getJSONData();
      expect(body.success).toBe(false);
    });

    it('should return 500 on service error', async () => {
      ratesService.getLatestRates.mockRejectedValue(new Error('Firestore error'));

      const req = httpMocks.createRequest({ method: 'GET' });
      const res = httpMocks.createResponse();

      await ratesController.getLatestRates(req, res);

      expect(res.statusCode).toBe(500);
      const body = res._getJSONData();
      expect(body.success).toBe(false);
    });
  });

  describe('refreshRates', () => {
    it('should return 200 with refreshed rates on success', async () => {
      const mockRates = {
        date: '2024-12-15T00:00:00.000Z',
        tracks: { fixed: { average: 4.5 } },
        averages: { fixed: 4.5 },
        source: 'bank_of_israel',
      };

      ratesService.fetchAndStoreLatestRates.mockResolvedValue(mockRates);

      const req = httpMocks.createRequest({ method: 'POST' });
      const res = httpMocks.createResponse();

      await ratesController.refreshRates(req, res);

      expect(res.statusCode).toBe(200);
      const body = res._getJSONData();
      expect(body.success).toBe(true);
    });

    it('should return 502 when BOI fetch fails', async () => {
      ratesService.fetchAndStoreLatestRates.mockResolvedValue(null);

      const req = httpMocks.createRequest({ method: 'POST' });
      const res = httpMocks.createResponse();

      await ratesController.refreshRates(req, res);

      expect(res.statusCode).toBe(502);
    });

    it('should return 500 on unexpected error', async () => {
      ratesService.fetchAndStoreLatestRates.mockRejectedValue(new Error('Unexpected'));

      const req = httpMocks.createRequest({ method: 'POST' });
      const res = httpMocks.createResponse();

      await ratesController.refreshRates(req, res);

      expect(res.statusCode).toBe(500);
    });
  });
});
