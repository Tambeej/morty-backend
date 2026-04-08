/**
 * Firestore configuration module.
 *
 * Initialises the Firebase Admin SDK and exports a ready-to-use
 * Firestore `db` instance (singleton).
 *
 * Credential resolution order
 * ───────────────────────────
 * 1. GOOGLE_APPLICATION_CREDENTIALS env var pointing to a service-account
 *    JSON file (recommended for local development).
 * 2. Individual env vars FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL +
 *    FIREBASE_PRIVATE_KEY (recommended for CI / Render / production).
 *
 * The module is safe to require multiple times – firebase-admin's
 * `getApps()` guard ensures the SDK is only initialised once.
 */
/**
 * Firestore configuration - Strict singleton
 */
const admin = require('firebase-admin');
const logger = require('../utils/logger');

let dbInstance = null;

/**
 * Build credential
 */
function buildCredential() {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    logger.info('Firestore: using GOOGLE_APPLICATION_CREDENTIALS file');
    return admin.credential.applicationDefault();
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (projectId && clientEmail && privateKey) {
    logger.info(`Firestore: using service-account env vars (project: ${projectId})`);
    return admin.credential.cert({
      projectId,
      clientEmail,
      privateKey: privateKey.replace(/\\n/g, '\n'),
    });
  }

  throw new Error('Firestore credentials not configured.');
}

/**
 * Get or create the Firestore instance (completely safe to call multiple times)
 */
function getFirestore() {
  if (dbInstance) return dbInstance;

  // Initialize Admin SDK only once
  if (admin.apps.length === 0) {
    const credential = buildCredential();
    const projectId = process.env.FIREBASE_PROJECT_ID ||
                      process.env.GCLOUD_PROJECT ||
                      process.env.GOOGLE_CLOUD_PROJECT;

    admin.initializeApp({
      credential,
      ...(projectId ? { projectId } : {}),
    });

    logger.info('Firebase Admin SDK initialised successfully');
  }

  // Create Firestore instance + settings (only once)
  dbInstance = admin.firestore();
  dbInstance.settings({ ignoreUndefinedProperties: true });

  return dbInstance;
}

// Export the getter (recommended) + backward compatibility
module.exports = getFirestore();
module.exports.getFirestore = getFirestore;
module.exports.admin = admin;
