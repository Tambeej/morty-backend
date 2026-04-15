#!/usr/bin/env node
/**
 * Manual Bank of Israel Rates Fetch Script
 *
 * Triggers a one-time fetch of the latest mortgage rates from the
 * Bank of Israel API and stores them in Firestore.
 *
 * Usage:
 *   node scripts/fetchRates.js
 *
 * This script is useful for:
 *   - Initial data population after deployment
 *   - Manual refresh when the cron job hasn't run yet
 *   - Testing the BOI API integration
 *
 * Required environment variables (same as the main app):
 *   FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY
 *   OR GOOGLE_APPLICATION_CREDENTIALS
 */

'use strict';

require('dotenv').config();

const ratesService = require('../src/services/ratesService');
const logger = require('../src/utils/logger');

async function main() {
  console.log('\n🏦 Morty – Bank of Israel Rates Fetch\n');
  console.log('─'.repeat(60));

  try {
    console.log('\nFetching latest mortgage rates from Bank of Israel...');
    const rates = await ratesService.fetchAndStoreLatestRates();

    if (!rates) {
      console.error('\n❌ Failed to fetch rates (null result)');
      process.exit(1);
    }

    console.log('\n✅ Rates fetched and stored successfully!\n');
    console.log(`Source:     ${rates.source}`);
    console.log(`Date:       ${rates.date}`);
    console.log(`Period:     ${rates.fetchPeriod?.start} → ${rates.fetchPeriod?.end}`);
    console.log('\nAverages:');
    console.log(`  Fixed (קל"צ):     ${rates.averages?.fixed ?? 'N/A'}%`);
    console.log(`  CPI (צמוד מדד):   ${rates.averages?.cpi ?? 'N/A'}%`);
    console.log(`  Prime (פריים):    ${rates.averages?.prime ?? 'N/A'}%`);
    console.log(`  Variable (משתנה): ${rates.averages?.variable ?? 'N/A'}%`);

    console.log('\nTrack details:');
    for (const [track, data] of Object.entries(rates.tracks || {})) {
      console.log(`\n  ${track} (${data.label}):`);
      console.log(`    Average:      ${data.average ?? 'N/A'}%`);
      console.log(`    Latest:       ${data.latest?.value ?? 'N/A'}% (${data.latest?.period ?? 'N/A'})`);
      console.log(`    Data points:  ${data.count}`);
    }

    console.log('\n' + '─'.repeat(60));
    console.log('Done.\n');
  } catch (err) {
    console.error(`\n❌ Error: ${err.message}`);
    logger.error(`fetchRates script error: ${err.message}`);
    process.exit(1);
  }
}

main();
