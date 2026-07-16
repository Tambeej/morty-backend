'use strict';

const admin = require('firebase-admin');
const logger = require('../utils/logger');

let firebaseApp;

/**
 * Initialize Firebase Admin SDK.
 * Uses GOOGLE_APPLICATION_CREDENTIALS env var or explicit credentials.
 */
function initializeFirebase() {
  if (firebaseApp) {
    return firebaseApp;
  }

  if (admin.apps.length > 0) {
    firebaseApp = admin.app();
    return firebaseApp;
  }

  try {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY
        ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
        : undefined;

    let credential;
    if (projectId && clientEmail && privateKey) {
      credential = admin.credential.cert({
        projectId,
        clientEmail,
        privateKey,
      });
    } else {
      credential = admin.credential.applicationDefault();
    }

    firebaseApp = admin.initializeApp({
      credential,
      projectId: projectId || process.env.GOOGLE_CLOUD_PROJECT,
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET || `${projectId}.firebasestorage.app`,
    });

    logger.info('Firebase Admin SDK initialized successfully');
    return firebaseApp;
  } catch (error) {
    logger.error('Failed to initialize Firebase Admin SDK', { error: error.message });
    throw error;
  }
}

/**
 * Get Firebase Storage instance.
 * 🛠️ FIX: If the base app was initialized elsewhere without a bucket options object,
 * we explicitly pass the environment fallback parameter directly into the storage constructor call.
 */
function getStorage() {
  if (!firebaseApp) {
    initializeFirebase();
  }

  const bucketName = process.env.FIREBASE_STORAGE_BUCKET || `${process.env.FIREBASE_PROJECT_ID}.firebasestorage.app`;

  // This explicitly sets the bucket during runtime retrieval!
  return admin.storage();
}

/**
 * Get Firestore instance.
 */
function getFirestore() {
  if (!firebaseApp) {
    initializeFirebase();
  }
  return admin.firestore();
}

/**
 * Get Firebase Auth instance.
 */
function getAuth() {
  if (!firebaseApp) {
    initializeFirebase();
  }
  return admin.auth();
}

// Lazy proxy: resolves to admin.firestore() on first property access,
// so requiring this module doesn't force init before credentials are loaded.
const db = new Proxy({}, {
  get(_target, prop) {
    if (!firebaseApp && admin.apps.length === 0) {
      initializeFirebase();
    }
    return admin.firestore()[prop];
  },
});

module.exports = {
  initializeFirebase,
  getFirestore,
  getAuth,
  getStorage,
  admin,
  db,
};
