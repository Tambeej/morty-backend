/**
 * Tests for ratesCron – cron job scheduling.
 */

'use strict';

jest.mock('node-cron', () => ({
  schedule: jest.fn(() => ({
    stop: jest.fn(),
  })),
}));

jest.mock('../src/services/ratesService', () => ({
  fetchAndStoreLatestRates: jest.fn().mockResolvedValue({
    source: 'bank_of_israel',
    tracks: { fixed: {}, cpi: {}, prime: {}, variable: {} },
  }),
}));

jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const cron = require('node-cron');
const { startRatesCron, stopRatesCron } = require('../src/cron/ratesCron');

beforeEach(() => {
  jest.clearAllMocks();
  // Reset the module's internal state by stopping any existing cron
  stopRatesCron();
});

describe('ratesCron', () => {
  describe('startRatesCron', () => {
    it('should schedule a cron job at 23:00 UTC', () => {
      startRatesCron();

      expect(cron.schedule).toHaveBeenCalledTimes(1);
      expect(cron.schedule).toHaveBeenCalledWith(
        '0 23 * * *',
        expect.any(Function),
        expect.objectContaining({
          scheduled: true,
          timezone: 'UTC',
        })
      );
    });

    it('should not create duplicate cron jobs', () => {
      startRatesCron();
      startRatesCron(); // second call should be a no-op

      expect(cron.schedule).toHaveBeenCalledTimes(1);
    });
  });

  describe('stopRatesCron', () => {
    it('should stop the cron job', () => {
      const task = startRatesCron();
      stopRatesCron();

      expect(task.stop).toHaveBeenCalled();
    });
  });

  describe('cron callback', () => {
    it('should call fetchAndStoreLatestRates when triggered', async () => {
      const ratesService = require('../src/services/ratesService');

      startRatesCron();

      // Get the callback function passed to cron.schedule
      const cronCallback = cron.schedule.mock.calls[0][1];

      // Execute the callback
      await cronCallback();

      expect(ratesService.fetchAndStoreLatestRates).toHaveBeenCalledTimes(1);
    });

    it('should handle errors gracefully without crashing', async () => {
      const ratesService = require('../src/services/ratesService');
      ratesService.fetchAndStoreLatestRates.mockRejectedValueOnce(
        new Error('Firestore unavailable')
      );

      startRatesCron();

      const cronCallback = cron.schedule.mock.calls[0][1];

      // Should not throw
      await expect(cronCallback()).resolves.not.toThrow();
    });
  });
});
