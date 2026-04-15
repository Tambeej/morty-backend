#!/usr/bin/env node
/**
 * Firestore Collection Initialisation Script
 *
 * Run this script ONCE after deploying to a new environment to:
 *  1. Verify Firestore connectivity
 *  2. Create sentinel/placeholder documents so each collection appears
 *     in the Firebase Console immediately (Firestore creates collections
 *     lazily – they only appear after the first document write)
 *  3. Print index creation instructions
 *
 * Usage:
 *   node scripts/initCollections.js
 *
 * Required environment variables (same as the main app):
 *   FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY
 *   OR GOOGLE_APPLICATION_CREDENTIALS
 */

'use strict';

require('dotenv').config();

const db = require('../src/config/firestore');
const {
  COLLECTIONS,
  OFFER_STATUS,
  RATES_SOURCE,
  INDEX_DEFINITIONS,
} = require('../src/config/collections');

// ─── Sentinel Documents ───────────────────────────────────────────────────────

/**
 * Sentinel documents are written to each collection so they appear in the
 * Firebase Console. They are tagged with `_sentinel: true` so application
 * code can safely ignore them.
 */
const SENTINEL_DOCS = [
  {
    collection: COLLECTIONS.USERS,
    id: '_sentinel',
    data: {
      id: '_sentinel',
      email: 'sentinel@morty.internal',
      password: '__sentinel__',
      phone: '',
      verified: false,
      refreshToken: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      _sentinel: true,
    },
  },
  {
    collection: COLLECTIONS.FINANCIALS,
    id: '_sentinel',
    data: {
      id: '_sentinel',
      userId: '_sentinel',
      income: 0,
      additionalIncome: 0,
      expenses: { housing: 0, loans: 0, other: 0 },
      assets: { savings: 0, investments: 0 },
      debts: [],
      updatedAt: new Date().toISOString(),
      _sentinel: true,
    },
  },
  {
    collection: COLLECTIONS.OFFERS,
    id: '_sentinel',
    data: {
      id: '_sentinel',
      userId: '_sentinel',
      originalFile: { url: '', mimetype: '' },
      extractedData: { bank: '', amount: null, rate: null, term: null },
      analysis: { recommendedRate: null, savings: null, aiReasoning: '' },
      status: OFFER_STATUS.PENDING,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      _sentinel: true,
    },
  },
  {
    collection: COLLECTIONS.MORTGAGE_RATES,
    id: '_sentinel',
    data: {
      date: new Date().toISOString(),
      fetchPeriod: { start: '2024-01', end: '2025-03' },
      tracks: {
        fixed: { label: 'קבועה לא צמודה (קל"צ)', average: null, latest: null, monthlyData: [], count: 0 },
        cpi: { label: 'צמוד מדד', average: null, latest: null, monthlyData: [], count: 0 },
        prime: { label: 'פריים', average: null, latest: null, monthlyData: [], count: 0 },
        variable: { label: 'משתנה לא צמודה', average: null, latest: null, monthlyData: [], count: 0 },
      },
      averages: { fixed: null, cpi: null, prime: null, variable: null },
      source: RATES_SOURCE.FALLBACK,
      sourceUrl: 'https://www.boi.org.il/en/economic-roles/statistics/',
      updatedAt: new Date().toISOString(),
      _sentinel: true,
    },
  },
];

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🔥 Morty – Firestore Collection Initialisation\n');
  console.log('Project:', process.env.FIREBASE_PROJECT_ID || '(from GOOGLE_APPLICATION_CREDENTIALS)');
  console.log('─'.repeat(60));

  // 1. Verify connectivity
  console.log('\n[1/3] Verifying Firestore connectivity...');
  try {
    // A lightweight read to confirm the SDK is initialised and credentials work
    await db.listCollections();
    console.log('      ✅ Connected to Firestore successfully');
  } catch (err) {
    console.error('      ❌ Failed to connect to Firestore:', err.message);
    console.error('\n      Check your credentials and try again.');
    process.exit(1);
  }

  // 2. Create sentinel documents
  console.log('\n[2/3] Creating sentinel documents...');
  for (const { collection, id, data } of SENTINEL_DOCS) {
    try {
      const ref = db.collection(collection).doc(id);
      const snap = await ref.get();
      if (snap.exists) {
        console.log(`      ⏭  ${collection}/_sentinel already exists – skipping`);
      } else {
        await ref.set(data);
        console.log(`      ✅ Created ${collection}/_sentinel`);
      }
    } catch (err) {
      console.error(`      ❌ Failed to create ${collection}/_sentinel:`, err.message);
    }
  }

  // 3. Print index instructions
  console.log('\n[3/3] Required Firestore indexes:');
  INDEX_DEFINITIONS.forEach(({ collection, description, fields, type }) => {
    console.log(`\n      Collection : ${collection}`);
    console.log(`      Type       : ${type}`);
    console.log(`      Description: ${description}`);
    console.log('      Fields     :');
    fields.forEach(({ fieldPath, order }) => {
      console.log(`                   ${fieldPath} (${order})`);
    });
  });

  console.log('\n      ℹ️  Composite indexes must be created via:');
  console.log('         firebase deploy --only firestore:indexes');
  console.log('         (uses firestore.indexes.json in the project root)');
  console.log('\n      ℹ️  Single-field indexes are created automatically by Firestore.');

  console.log('\n' + '─'.repeat(60));
  console.log('✅ Initialisation complete.\n');
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
