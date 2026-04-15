/**
 * Rates Controller
 *
 * Handles HTTP requests for Bank of Israel mortgage rate data.
 *
 * Routes:
 *   GET /api/v1/public/rates/latest  – Get latest average mortgage rates
 *
 * Response shape (per architecture contract):
 * {
 *   success: true,
 *   data: {
 *     date:        ISO string,
 *     fetchPeriod: { start: string, end: string },
 *     tracks: {
 *       fixed:    { label, average, latest, monthlyData, count },
 *       cpi:      { ... },
 *       prime:    { ... },
 *       variable: { ... }
 *     },
 *     averages: { fixed: number, cpi: number, prime: number, variable: number },
 *     source:    'bank_of_israel' | 'fallback',
 *     sourceUrl: string,
 *     updatedAt: ISO string
 *   }
 * }
 */

'use strict';

const ratesService = require('../services/ratesService');
const logger = require('../utils/logger');
const { sendSuccess, sendError } = require('../utils/response');

/**
 * GET /api/v1/public/rates/latest
 *
 * Returns the latest Bank of Israel average mortgage rates.
 * This is a public endpoint (no authentication required).
 * Data is cached for 1 hour in-memory.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 */
exports.getLatestRates = async (req, res) => {
  try {
    const rates = await ratesService.getLatestRates();

    if (!rates) {
      return sendError(
        res,
        'Mortgage rates data is currently unavailable. Please try again later.',
        503,
        'RATES_UNAVAILABLE'
      );
    }

    // Set Cache-Control header for CDN/browser caching (1 hour)
    res.set('Cache-Control', 'public, max-age=3600, s-maxage=3600');

    return sendSuccess(res, rates, 'Latest mortgage rates retrieved successfully');
  } catch (err) {
    logger.error(`ratesController.getLatestRates error: ${err.message}`);
    return sendError(
      res,
      'Failed to retrieve mortgage rates',
      500,
      'RATES_FETCH_ERROR'
    );
  }
};

/**
 * POST /api/v1/admin/rates/refresh (future: admin-only endpoint)
 *
 * Manually triggers a fresh fetch of BOI rates.
 * Intended for admin use or internal cron triggers.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 */
exports.refreshRates = async (req, res) => {
  try {
    logger.info('ratesController.refreshRates: manual refresh triggered');
    const rates = await ratesService.fetchAndStoreLatestRates();

    if (!rates) {
      return sendError(
        res,
        'Failed to fetch rates from Bank of Israel',
        502,
        'BOI_FETCH_FAILED'
      );
    }

    return sendSuccess(res, rates, 'Mortgage rates refreshed successfully');
  } catch (err) {
    logger.error(`ratesController.refreshRates error: ${err.message}`);
    return sendError(
      res,
      'Failed to refresh mortgage rates',
      500,
      'RATES_REFRESH_ERROR'
    );
  }
};
