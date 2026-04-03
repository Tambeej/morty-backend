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

const admin = require('firebase-admin');
const logger = require('../utils/logger');

/**
 * Build the firebase-admin credential from environment variables.
 *
 * @returns {admin.credential.Base} A firebase-admin credential object.
 * @throws {Error} When neither credential strategy is configured.
 */
function buildCredential() {
  // Strategy 1 – service account JSON file
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    logger.info('Firestore: using GOOGLE_APPLICATION_CREDENTIALS file');
    return admin.credential.applicationDefault();
  }

  // Strategy 2 – individual env vars (CI / Render)
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (projectId && clientEmail && privateKey) {
    logger.info(`Firestore: using service-account env vars (project: ${projectId})`);
    return admin.credential.cert({
      projectId,
      clientEmail,
      // Render / most CI systems store the key with literal \n sequences
      privateKey: privateKey.replace(/\\n/g, '\n'),
    });
  }

  throw new Error(
    'Firestore credentials not configured. ' +
      'Set GOOGLE_APPLICATION_CREDENTIALS or ' +
      'FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY.'
  );
}

/**
 * Initialise the Firebase Admin SDK (idempotent).
 *
 * @returns {admin.firestore.Firestore} The Firestore database instance.
 */
function initFirestore() {
  if (admin.apps.length === 0) {
    const credential = buildCredential();
    const projectId =
      process.env.FIREBASE_PROJECT_ID ||
      process.env.GCLOUD_PROJECT ||
      process.env.GOOGLE_CLOUD_PROJECT;

    admin.initializeApp({
      credential,
      ...(projectId ? { projectId } : {}),
    });

    logger.info('Firebase Admin SDK initialised successfully');
  }

  const db = admin.firestore();

  // Use ISO-8601 timestamps (Timestamp → Date) for consistent serialisation
  db.settings({ ignoreUndefinedProperties: true });

  return db;
}

/** Singleton Firestore instance shared across the application. */
const db = initFirestore();

module.exports = db;
module.exports.admin = admin;
module.exports.initFirestore = initFirestore;
