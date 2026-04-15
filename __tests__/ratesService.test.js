/**
 * Tests for ratesService – Bank of Israel mortgage rates integration.
 *
 * Tests cover:
 *   - SDMX response parsing
 *   - Rate formatting
 *   - Cache behaviour
 *   - Fallback rates
 *   - Error handling
 *   - Document validation
 */

'use strict';

// ── Mocks ─────────────────────────────────────────────────────────────────────

// Mock Firestore before requiring the service
const mockSet = jest.fn().mockResolvedValue(undefined);
const mockGet = jest.fn();
const mockCommit = jest.fn().mockResolvedValue(undefined);
const mockBatch = jest.fn(() => ({
  set: mockSet,
  commit: mockCommit,
}));
const mockWhere = jest.fn().mockReturnThis();
const mockOrderBy = jest.fn().mockReturnThis();
const mockLimit = jest.fn().mockReturnThis();
const mockCollectionGet = jest.fn().mockResolvedValue({ docs: [] });

const mockDoc = jest.fn((id) => ({
  get: mockGet,
  set: mockSet,
  id,
}));

const mockCollection = jest.fn(() => ({
  doc: mockDoc,
  where: mockWhere,
  orderBy: mockOrderBy,
  limit: mockLimit,
  get: mockCollectionGet,
}));

jest.mock('../src/config/firestore', () => {
  const firestoreMock = {
    collection: mockCollection,
    batch: mockBatch,
  };
  firestoreMock.getFirestore = () => firestoreMock;
  return firestoreMock;
});

jest.mock('axios');
jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const axios = require('axios');
const ratesService = require('../src/services/ratesService');
const { validateMortgageRatesDocument, COLLECTIONS } = require('../src/config/collections');

// ── Test Data ─────────────────────────────────────────────────────────────────

/**
 * Sample SDMX-JSON response from the BOI API.
 */
const SAMPLE_SDMX_RESPONSE = {
  data: {
    dataSets: [
      {
        series: {
          '0:0:0:0': {
            observations: {
              '0': [3.85],
              '1': [3.92],
              '2': [3.78],
              '3': [3.95],
              '4': [4.01],
              '5': [3.88],
              '6': [3.82],
              '7': [3.90],
              '8': [3.87],
              '9': [3.93],
              '10': [3.80],
              '11': [3.75],
            },
          },
        },
      },
    ],
    structure: {
      dimensions: {
        observation: [
          {
            id: 'TIME_PERIOD',
            role: 'time',
            values: [
              { id: '2024-01', name: '2024-01' },
              { id: '2024-02', name: '2024-02' },
              { id: '2024-03', name: '2024-03' },
              { id: '2024-04', name: '2024-04' },
              { id: '2024-05', name: '2024-05' },
              { id: '2024-06', name: '2024-06' },
              { id: '2024-07', name: '2024-07' },
              { id: '2024-08', name: '2024-08' },
              { id: '2024-09', name: '2024-09' },
              { id: '2024-10', name: '2024-10' },
              { id: '2024-11', name: '2024-11' },
              { id: '2024-12', name: '2024-12' },
            ],
          },
        ],
      },
    },
  },
};

// ── Setup / Teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  ratesService.clearCache();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ratesService', () => {
  describe('parseSDMXResponse', () => {
    it('should parse a valid SDMX-JSON response into observations', () => {
      const result = ratesService.parseSDMXResponse(SAMPLE_SDMX_RESPONSE);

      expect(result).toHaveLength(12);
      expect(result[0]).toEqual({ period: '2024-01', value: 3.85 });
      expect(result[11]).toEqual({ period: '2024-12', value: 3.75 });
    });

    it('should sort observations by period ascending', () => {
      const result = ratesService.parseSDMXResponse(SAMPLE_SDMX_RESPONSE);

      for (let i = 1; i < result.length; i++) {
        expect(result[i].period > result[i - 1].period).toBe(true);
      }
    });

    it('should return empty array for null/undefined input', () => {
      expect(ratesService.parseSDMXResponse(null)).toEqual([]);
      expect(ratesService.parseSDMXResponse(undefined)).toEqual([]);
    });

    it('should return empty array for malformed SDMX data', () => {
      expect(ratesService.parseSDMXResponse({})).toEqual([]);
      expect(ratesService.parseSDMXResponse({ data: {} })).toEqual([]);
      expect(ratesService.parseSDMXResponse({ data: { dataSets: [] } })).toEqual([]);
    });

    it('should skip null/NaN observation values', () => {
      const dataWithNulls = {
        data: {
          dataSets: [
            {
              series: {
                '0:0:0:0': {
                  observations: {
                    '0': [3.85],
                    '1': [null],
                    '2': [3.78],
                  },
                },
              },
            },
          ],
          structure: {
            dimensions: {
              observation: [
                {
                  id: 'TIME_PERIOD',
                  role: 'time',
                  values: [
                    { id: '2024-01', name: '2024-01' },
                    { id: '2024-02', name: '2024-02' },
                    { id: '2024-03', name: '2024-03' },
                  ],
                },
              ],
            },
          },
        },
      };

      const result = ratesService.parseSDMXResponse(dataWithNulls);
      expect(result).toHaveLength(2);
      expect(result[0].value).toBe(3.85);
      expect(result[1].value).toBe(3.78);
    });

    it('should round values to 2 decimal places', () => {
      const dataWithLongDecimals = {
        data: {
          dataSets: [
            {
              series: {
                '0:0:0:0': {
                  observations: {
                    '0': [3.856789],
                  },
                },
              },
            },
          ],
          structure: {
            dimensions: {
              observation: [
                {
                  id: 'TIME_PERIOD',
                  role: 'time',
                  values: [{ id: '2024-01', name: '2024-01' }],
                },
              ],
            },
          },
        },
      };

      const result = ratesService.parseSDMXResponse(dataWithLongDecimals);
      expect(result[0].value).toBe(3.86);
    });
  });

  describe('formatRatesResponse', () => {
    it('should format a rates document for API response', () => {
      const doc = {
        date: '2024-12-15T00:00:00.000Z',
        fetchPeriod: { start: '2024-01', end: '2024-12' },
        tracks: { fixed: { average: 4.5 } },
        averages: { fixed: 4.5, cpi: 3.0, prime: 6.0, variable: 5.0 },
        source: 'bank_of_israel',
        sourceUrl: 'https://www.boi.org.il',
        updatedAt: '2024-12-15T00:00:00.000Z',
        _isLatest: true, // internal field should be stripped
      };

      const result = ratesService.formatRatesResponse(doc);

      expect(result).toHaveProperty('date');
      expect(result).toHaveProperty('tracks');
      expect(result).toHaveProperty('averages');
      expect(result).toHaveProperty('source', 'bank_of_israel');
      expect(result).not.toHaveProperty('_isLatest');
    });

    it('should return null for null input', () => {
      expect(ratesService.formatRatesResponse(null)).toBeNull();
    });

    it('should handle missing optional fields gracefully', () => {
      const doc = {
        date: '2024-12-15T00:00:00.000Z',
        source: 'fallback',
      };

      const result = ratesService.formatRatesResponse(doc);
      expect(result.tracks).toEqual({});
      expect(result.averages).toEqual({});
      expect(result.fetchPeriod).toBeNull();
    });
  });

  describe('cache', () => {
    it('should report cache as invalid initially', () => {
      expect(ratesService.isCacheValid()).toBe(false);
    });

    it('should clear cache correctly', () => {
      ratesService.clearCache();
      expect(ratesService.isCacheValid()).toBe(false);
    });
  });

  describe('getLatestRates', () => {
    it('should return data from Firestore when cache is empty', async () => {
      const mockData = {
        date: '2024-12-15T00:00:00.000Z',
        tracks: { fixed: { average: 4.5 } },
        averages: { fixed: 4.5, cpi: 3.0, prime: 6.0, variable: 5.0 },
        source: 'bank_of_israel',
        sourceUrl: 'https://www.boi.org.il',
        updatedAt: '2024-12-15T00:00:00.000Z',
      };

      mockGet.mockResolvedValueOnce({
        exists: true,
        data: () => mockData,
      });

      const result = await ratesService.getLatestRates();

      expect(result).toBeTruthy();
      expect(result.source).toBe('bank_of_israel');
      expect(result.averages.fixed).toBe(4.5);
      expect(mockCollection).toHaveBeenCalledWith('mortgage_rates');
    });

    it('should return cached data on subsequent calls', async () => {
      const mockData = {
        date: '2024-12-15T00:00:00.000Z',
        tracks: { fixed: { average: 4.5 } },
        averages: { fixed: 4.5, cpi: 3.0, prime: 6.0, variable: 5.0 },
        source: 'bank_of_israel',
        sourceUrl: 'https://www.boi.org.il',
        updatedAt: '2024-12-15T00:00:00.000Z',
      };

      mockGet.mockResolvedValueOnce({
        exists: true,
        data: () => mockData,
      });

      // First call – reads from Firestore
      await ratesService.getLatestRates();

      // Second call – should use cache
      const result = await ratesService.getLatestRates();

      expect(result).toBeTruthy();
      // mockGet should only have been called once (for the first call)
      expect(mockGet).toHaveBeenCalledTimes(1);
    });
  });

  describe('getCurrentAverages', () => {
    it('should return averages from latest rates', async () => {
      const mockData = {
        date: '2024-12-15T00:00:00.000Z',
        tracks: {},
        averages: { fixed: 4.5, cpi: 3.0, prime: 6.0, variable: 5.0 },
        source: 'bank_of_israel',
        updatedAt: '2024-12-15T00:00:00.000Z',
      };

      mockGet.mockResolvedValueOnce({
        exists: true,
        data: () => mockData,
      });

      const averages = await ratesService.getCurrentAverages();

      expect(averages).toEqual({
        fixed: 4.5,
        cpi: 3.0,
        prime: 6.0,
        variable: 5.0,
      });
    });

    it('should return fallback averages when no data available', async () => {
      // Mock: no data in Firestore, and BOI API fails
      mockGet.mockResolvedValueOnce({ exists: false });
      axios.get.mockRejectedValue(new Error('Network error'));

      // After fetchAndStoreLatestRates fails to get BOI data,
      // it falls back to storeFallbackRates which writes to Firestore
      // We need to mock the batch commit
      mockCommit.mockResolvedValue(undefined);

      const averages = await ratesService.getCurrentAverages();

      expect(averages).toBeTruthy();
      expect(typeof averages.fixed).toBe('number');
      expect(typeof averages.cpi).toBe('number');
      expect(typeof averages.prime).toBe('number');
      expect(typeof averages.variable).toBe('number');
    });
  });

  describe('fetchAndStoreLatestRates', () => {
    it('should fetch rates from BOI API and store in Firestore', async () => {
      // Mock all 4 track API calls to return valid data
      axios.get.mockResolvedValue({ data: SAMPLE_SDMX_RESPONSE });

      const result = await ratesService.fetchAndStoreLatestRates();

      expect(result).toBeTruthy();
      expect(result.source).toBe('bank_of_israel');
      expect(result.tracks).toHaveProperty('fixed');
      expect(result.tracks).toHaveProperty('cpi');
      expect(result.tracks).toHaveProperty('prime');
      expect(result.tracks).toHaveProperty('variable');
      expect(result.averages).toBeTruthy();

      // Should have called axios.get 4 times (one per track)
      expect(axios.get).toHaveBeenCalledTimes(4);

      // Should have written to Firestore via batch
      expect(mockBatch).toHaveBeenCalled();
      expect(mockCommit).toHaveBeenCalled();
    });

    it('should fall back to hardcoded rates when BOI API fails', async () => {
      axios.get.mockRejectedValue(new Error('Network error'));

      const result = await ratesService.fetchAndStoreLatestRates();

      expect(result).toBeTruthy();
      expect(result.source).toBe('fallback');
      expect(result._isFallback).toBe(true);
      expect(result.averages.fixed).toBe(4.65);
      expect(result.averages.cpi).toBe(3.15);
      expect(result.averages.prime).toBe(6.05);
      expect(result.averages.variable).toBe(4.95);
    });

    it('should handle partial BOI API failures gracefully', async () => {
      // First 2 tracks succeed, last 2 fail
      axios.get
        .mockResolvedValueOnce({ data: SAMPLE_SDMX_RESPONSE })
        .mockResolvedValueOnce({ data: SAMPLE_SDMX_RESPONSE })
        .mockRejectedValueOnce(new Error('timeout'))
        .mockRejectedValueOnce(new Error('timeout'));

      const result = await ratesService.fetchAndStoreLatestRates();

      expect(result).toBeTruthy();
      expect(result.source).toBe('bank_of_israel');
      // At least some tracks should have data
      const tracksWithData = Object.values(result.tracks).filter((t) => t.count > 0);
      expect(tracksWithData.length).toBeGreaterThan(0);
    });
  });

  describe('fetchSeriesFromBOI', () => {
    it('should call BOI API with correct parameters', async () => {
      axios.get.mockResolvedValueOnce({ data: SAMPLE_SDMX_RESPONSE });

      await ratesService.fetchSeriesFromBOI(
        'BOI.STAT.MTRG.I_AVG.FXD_NI',
        '2024-01',
        '2024-12'
      );

      expect(axios.get).toHaveBeenCalledWith(
        expect.stringContaining('BOI.STAT.MTRG.I_AVG.FXD_NI'),
        expect.objectContaining({
          params: expect.objectContaining({
            startperiod: '2024-01',
            endperiod: '2024-12',
            format: 'sdmx-json',
          }),
          timeout: 15000,
        })
      );
    });

    it('should return empty array on API error', async () => {
      axios.get.mockRejectedValueOnce(new Error('Connection refused'));

      const result = await ratesService.fetchSeriesFromBOI(
        'BOI.STAT.MTRG.I_AVG.FXD_NI',
        '2024-01',
        '2024-12'
      );

      expect(result).toEqual([]);
    });

    it('should return empty array on HTTP error response', async () => {
      axios.get.mockRejectedValueOnce({
        response: { status: 404 },
        message: 'Not Found',
      });

      const result = await ratesService.fetchSeriesFromBOI(
        'BOI.STAT.MTRG.I_AVG.FXD_NI',
        '2024-01',
        '2024-12'
      );

      expect(result).toEqual([]);
    });

    it('should return empty array on timeout', async () => {
      const timeoutError = new Error('timeout');
      timeoutError.code = 'ECONNABORTED';
      axios.get.mockRejectedValueOnce(timeoutError);

      const result = await ratesService.fetchSeriesFromBOI(
        'BOI.STAT.MTRG.I_AVG.FXD_NI',
        '2024-01',
        '2024-12'
      );

      expect(result).toEqual([]);
    });
  });

  describe('constants', () => {
    it('should export BOI_RATE_SERIES with all 4 track types', () => {
      expect(ratesService.BOI_RATE_SERIES).toHaveProperty('fixed');
      expect(ratesService.BOI_RATE_SERIES).toHaveProperty('cpi');
      expect(ratesService.BOI_RATE_SERIES).toHaveProperty('prime');
      expect(ratesService.BOI_RATE_SERIES).toHaveProperty('variable');
    });

    it('should export TRACK_LABELS with Hebrew labels', () => {
      expect(ratesService.TRACK_LABELS.fixed).toContain('קל"צ');
      expect(ratesService.TRACK_LABELS.cpi).toContain('צמוד');
      expect(ratesService.TRACK_LABELS.prime).toContain('פריים');
      expect(ratesService.TRACK_LABELS.variable).toContain('משתנה');
    });

    it('should have CACHE_TTL_MS set to 1 hour', () => {
      expect(ratesService.CACHE_TTL_MS).toBe(60 * 60 * 1000);
    });
  });
});

describe('collections – mortgage_rates', () => {
  describe('COLLECTIONS constant', () => {
    it('should include MORTGAGE_RATES', () => {
      expect(COLLECTIONS.MORTGAGE_RATES).toBe('mortgage_rates');
    });
  });

  describe('validateMortgageRatesDocument', () => {
    it('should validate a correct document', () => {
      const doc = {
        date: '2024-12-15T00:00:00.000Z',
        tracks: { fixed: { average: 4.5 } },
        averages: { fixed: 4.5 },
        source: 'bank_of_israel',
      };

      const result = validateMortgageRatesDocument(doc);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject document without date', () => {
      const doc = {
        tracks: {},
        averages: {},
        source: 'bank_of_israel',
      };

      const result = validateMortgageRatesDocument(doc);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('date must be a non-empty string');
    });

    it('should reject document without tracks', () => {
      const doc = {
        date: '2024-12-15T00:00:00.000Z',
        averages: {},
        source: 'bank_of_israel',
      };

      const result = validateMortgageRatesDocument(doc);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('tracks must be an object');
    });

    it('should reject document without source', () => {
      const doc = {
        date: '2024-12-15T00:00:00.000Z',
        tracks: {},
        averages: {},
      };

      const result = validateMortgageRatesDocument(doc);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('source must be a non-empty string');
    });

    it('should flag unknown track types', () => {
      const doc = {
        date: '2024-12-15T00:00:00.000Z',
        tracks: { fixed: {}, unknownTrack: {} },
        averages: {},
        source: 'bank_of_israel',
      };

      const result = validateMortgageRatesDocument(doc);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('unknownTrack'))).toBe(true);
    });
  });
});
