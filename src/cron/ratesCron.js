/**
 * Rates Cron Job
 *
 * Schedules a daily fetch of Bank of Israel mortgage rates.
 * Runs at 02:00 Israel Standard Time (IST = UTC+2 / IDT = UTC+3).
 *
 * The cron expression uses UTC time. Israel is UTC+2 (winter) or
 * UTC+3 (summer/DST). We schedule at 23:00 UTC which is:
 *   - 01:00 IST (winter) or 02:00 IDT (summer)
 * This ensures the job runs in the early morning hours in Israel.
 *
 * Usage:
 *   const { startRatesCron } = require('./cron/ratesCron');
 *   startRatesCron(); // Call once at server startup
 */

'use strict';

const cron = require('node-cron');
const logger = require('../utils/logger');
const ratesService = require('../services/ratesService');

let cronTask = null;

/**
 * Start the daily rates fetch cron job.
 *
 * Schedule: Every day at 23:00 UTC (≈ 01:00-02:00 Israel time)
 * This timing ensures:
 *   1. BOI has published the previous day's data
 *   2. Minimal server load (off-peak hours)
 *   3. Fresh data available for morning users in Israel
 *
 * @returns {import('node-cron').ScheduledTask} The cron task instance
 */
function startRatesCron() {
  if (cronTask) {
    logger.warn('ratesCron: cron job already running, skipping duplicate start');
    return cronTask;
  }

  // Cron expression: minute hour day month weekday
  // '0 23 * * *' = every day at 23:00 UTC
  cronTask = cron.schedule('0 23 * * *', async () => {
    logger.info('ratesCron: daily rates fetch triggered');

    try {
      const rates = await ratesService.fetchAndStoreLatestRates();
      if (rates) {
        const source = rates.source || 'unknown';
        const trackCount = Object.keys(rates.tracks || {}).length;
        logger.info(
          `ratesCron: rates updated successfully (source=${source}, tracks=${trackCount})`
        );
      } else {
        logger.warn('ratesCron: fetchAndStoreLatestRates returned null');
      }
    } catch (err) {
      logger.error(`ratesCron: failed to fetch/store rates: ${err.message}`);
      // Do not rethrow – cron should not crash the process
    }
  }, {
    scheduled: true,
    timezone: 'UTC',
  });

  logger.info('ratesCron: daily rates fetch scheduled (23:00 UTC / ~01:00-02:00 IST)');
  return cronTask;
}

/**
 * Stop the cron job (useful for testing and graceful shutdown).
 */
function stopRatesCron() {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
    logger.info('ratesCron: cron job stopped');
  }
}

module.exports = {
  startRatesCron,
  stopRatesCron,
};
