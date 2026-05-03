/**
 * Firebase Admin SDK configuration
 *
 * Initialises the firebase-admin app once and exports the Firestore client.
 * Supports two credential strategies:
 *
 *   Option A – GOOGLE_APPLICATION_CREDENTIALS env var pointing to a service
 *              account JSON file (recommended for local development).
 *
 *   Option B – Individual credential fields injected via environment variables
 *              (FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY).
 *              Recommended for CI / Render deployments where mounting a file is
 *              not practical.
 *
 * The module is safe to require multiple times; firebase-admin's
 * getApps() guard prevents duplicate initialisation.
 */

'use strict';

const admin = require('firebase-admin');
const logger = require('../utils/logger');

/**
 * Build a firebase-admin credential from environment variables.
 *
 * @returns {admin.credential.Credential}
 */
function buildCredential() {
  // Option A: file-based service account (GOOGLE_APPLICATION_CREDENTIALS)
/*  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    logger.info('Firebase Admin: using GOOGLE_APPLICATION_CREDENTIALS file');
    return admin.credential.applicationDefault();
  }*/

  // Option B: individual env vars (CI / Render)
  const { FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY } = process.env;

  if (!FIREBASE_PROJECT_ID || !FIREBASE_CLIENT_EMAIL || !FIREBASE_PRIVATE_KEY) {
    throw new Error(
      'Firebase Admin SDK: missing credentials. ' +
        'Set GOOGLE_APPLICATION_CREDENTIALS or ' +
        'FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY.'
    );
  }

  // Render stores the private key with literal \n; replace them with real newlines.
  const privateKey = FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');

  logger.info('Firebase Admin: using individual credential env vars');
  return admin.credential.cert({
    projectId: FIREBASE_PROJECT_ID,
    clientEmail: FIREBASE_CLIENT_EMAIL,
    privateKey,
  });
}

/**
 * Initialise (or reuse) the default firebase-admin app.
 *
 * @returns {admin.app.App}
 */
function initFirebaseAdmin() {
  if (admin.apps.length > 0) {
    return admin.apps[0];
  }

  const credential = buildCredential();
  const projectId = process.env.FIREBASE_PROJECT_ID;

  const appConfig = { credential };
  if (projectId) {
    appConfig.projectId = projectId;
  }

  const app = admin.initializeApp(appConfig);
  logger.info('Firebase Admin SDK initialised successfully');
  return app;
}

// Initialise on first require
const firebaseApp = initFirebaseAdmin();

// Export the Firestore client for use across the application
const db = admin.firestore();

// Configure Firestore settings for better performance
db.settings({
  ignoreUndefinedProperties: true,
});

module.exports = {
  admin,
  firebaseApp,
  db,
};
