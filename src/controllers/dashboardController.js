/**
 * Dashboard Controller
 *
 * Handles GET /api/v1/dashboard – returns an aggregated summary of the
 * authenticated user's financial profile and mortgage offer data.
 *
 * Response shape (architecture contract):
 * {
 *   data: {
 *     financials:   FinancialShape | null,
 *     recentOffers: OfferShape[5],
 *     stats: {
 *       totalOffers:  number,
 *       savingsTotal: number,
 *     }
 *   }
 * }
 *
 * All Firestore access is delegated to the service layer; this controller
 * only orchestrates calls and formats the HTTP response.
 */

'use strict';

const financialService = require('../services/financialService');
const offerService     = require('../services/offerService');
const { sendSuccess, sendError } = require('../utils/response');
const logger           = require('../utils/logger');

/**
 * GET /api/v1/dashboard
 *
 * Returns a dashboard summary for the authenticated user:
 *  - `financials`   – the user's financial profile (or null if not set up yet)
 *  - `recentOffers` – up to 5 most recent offers, sorted by createdAt desc
 *  - `stats`        – aggregate offer statistics (total count, total savings)
 *
 * All three queries run in parallel via Promise.all for minimal latency.
 *
 * @param {import('express').Request}  req - Must have req.user.id set by auth middleware
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
exports.getSummary = async (req, res) => {
  // req.user is populated by the `protect` middleware using Firestore userService.
  // The user object uses `id` (string) – not the legacy Mongoose `_id`.
  const userId = req.user.id;

  try {
    // Run all three Firestore queries concurrently to minimise response time.
    const [financials, recentOffers, stats] = await Promise.all([
      financialService.getFinancials(userId),
      offerService.getRecentOffers(userId, 5),
      offerService.getOfferStats(userId),
    ]);

    /**
     * Build the response payload matching the architecture contract:
     *
     * stats shape from offerService.getOfferStats:
     *   { total, pending, analyzed, error, savingsTotal }
     *
     * We expose only `totalOffers` and `savingsTotal` to the frontend
     * (the architecture contract), but include the full breakdown for
     * potential future use without a breaking change.
     */
    const responseData = {
      financials,
      recentOffers,
      stats: {
        totalOffers:  stats.total,
        savingsTotal: stats.savingsTotal,
        // Breakdown by status (bonus data – frontend may ignore)
        pending:  stats.pending,
        analyzed: stats.analyzed,
        error:    stats.error,
      },
    };

    logger.info(
      `dashboardController.getSummary: userId=${userId} ` +
      `totalOffers=${stats.total} savingsTotal=${stats.savingsTotal}`
    );

    return sendSuccess(res, responseData, 'Dashboard data retrieved successfully');
  } catch (err) {
    logger.error(`dashboardController.getSummary error (userId=${userId}): ${err.message}`);
    return sendError(res, 'Failed to retrieve dashboard data', 500, 'DASHBOARD_ERROR');
  }
};
