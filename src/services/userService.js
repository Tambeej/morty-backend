/**
 * User Service – Firestore CRUD & auth-related operations.
 *
 * All interactions with the `users` Firestore collection are centralised here.
 * Controllers and middleware should use this service rather than touching
 * Firestore directly.
 *
 * Document shape (stored in Firestore):
 * {
 *   id:           string  (Firestore document ID, also stored as field)
 *   email:        string  (lowercase, unique enforced at application level)
 *   password:     string|null (bcrypt hash – never returned to client; null for Google-only users)
 *   phone:        string  (default '')
 *   verified:     boolean (default false)
 *   firebaseUid:  string|null (Firebase Auth UID for Google sign-in users)
 *   refreshToken: string|null
 *   createdAt:    ISO string
 *   updatedAt:    ISO string
 * }
 *
 * Public shape (returned to callers / clients) omits password & refreshToken:
 * {
 *   id, email, phone, verified, firebaseUid, createdAt, updatedAt
 * }
 */

'use strict';

const bcrypt = require('bcryptjs');
const db = require('../config/firestore');
const logger = require('../utils/logger');

/** Firestore collection reference */
const COLLECTION = 'users';
const usersRef = () => db.collection(COLLECTION);

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Strip sensitive fields before returning a user to callers.
 *
 * @param {Object} doc - Raw Firestore document data (including id field)
 * @returns {Object} Safe public user object
 */
function toPublicUser(doc) {
  if (!doc) return null;
  const { password, refreshToken, ...publicFields } = doc; // eslint-disable-line no-unused-vars
  return publicFields;
}

/**
 * Convert a Firestore DocumentSnapshot to a plain JS object.
 * Returns null when the document does not exist.
 *
 * @param {FirebaseFirestore.DocumentSnapshot} snap
 * @returns {Object|null}
 */
function snapToDoc(snap) {
  if (!snap.exists) return null;
  return { id: snap.id, ...snap.data() };
}

// ── Read operations ───────────────────────────────────────────────────────────

/**
 * Find a user by their Firestore document ID.
 *
 * @param {string} userId - Firestore document ID
 * @returns {Promise<Object|null>} Full user document (with hashed password) or null
 */
async function findById(userId) {
  if (!userId) return null;
  try {
    const snap = await usersRef().doc(userId).get();
    return snapToDoc(snap);
  } catch (err) {
    logger.error(`userService.findById error (id=${userId}): ${err.message}`);
    throw err;
  }
}

/**
 * Find a user by email address (case-insensitive).
 *
 * @param {string} email
 * @returns {Promise<Object|null>} Full user document or null
 */
async function findByEmail(email) {
  if (!email) return null;
  try {
    const normalised = email.toLowerCase().trim();
    const snap = await usersRef()
      .where('email', '==', normalised)
      .limit(1)
      .get();

    if (snap.empty) return null;
    const docSnap = snap.docs[0];
    return { id: docSnap.id, ...docSnap.data() };
  } catch (err) {
    logger.error(`userService.findByEmail error (email=${email}): ${err.message}`);
    throw err;
  }
}

/**
 * Find a user by their Firebase Auth UID.
 *
 * @param {string} firebaseUid - Firebase Auth UID (from verifyIdToken)
 * @returns {Promise<Object|null>} Full user document or null
 */
async function findByFirebaseUid(firebaseUid) {
  if (!firebaseUid) return null;
  try {
    const snap = await usersRef()
      .where('firebaseUid', '==', firebaseUid)
      .limit(1)
      .get();

    if (snap.empty) return null;
    const docSnap = snap.docs[0];
    return { id: docSnap.id, ...docSnap.data() };
  } catch (err) {
    logger.error(`userService.findByFirebaseUid error (uid=${firebaseUid}): ${err.message}`);
    throw err;
  }
}

/**
 * Find a user by their stored refresh token.
 *
 * @param {string} refreshToken
 * @returns {Promise<Object|null>} Full user document or null
 */
async function findByRefreshToken(refreshToken) {
  if (!refreshToken) return null;
  try {
    const snap = await usersRef()
      .where('refreshToken', '==', refreshToken)
      .limit(1)
      .get();

    if (snap.empty) return null;
    const docSnap = snap.docs[0];
    return { id: docSnap.id, ...docSnap.data() };
  } catch (err) {
    logger.error(`userService.findByRefreshToken error: ${err.message}`);
    throw err;
  }
}

// ── Write operations ──────────────────────────────────────────────────────────

/**
 * Create a new user document in Firestore.
 *
 * The password is hashed with bcrypt (cost factor 12) before storage.
 * Throws a ConflictError-like object if the email is already registered.
 *
 * @param {Object} params
 * @param {string} params.email    - User email (will be lowercased)
 * @param {string} params.password - Plain-text password (will be hashed)
 * @param {string} [params.phone]  - Optional phone number
 * @returns {Promise<Object>} Public user object (no password/refreshToken)
 */
async function createUser({ email, password, phone = '' }) {
  const normalised = email.toLowerCase().trim();

  // Enforce email uniqueness at the application level
  const existing = await findByEmail(normalised);
  if (existing) {
    const err = new Error('Email already registered');
    err.statusCode = 409;
    err.errorCode = 'CONFLICT_ERROR';
    throw err;
  }

  const hashed = await bcrypt.hash(password, 12);
  const now = new Date().toISOString();

  // Let Firestore auto-generate the document ID
  const docRef = usersRef().doc();
  const userData = {
    id: docRef.id,
    email: normalised,
    password: hashed,
    phone: phone || '',
    verified: false,
    firebaseUid: null,
    refreshToken: null,
    createdAt: now,
    updatedAt: now,
  };

  await docRef.set(userData);
  logger.info(`userService.createUser: created user ${docRef.id} (${normalised})`);

  return toPublicUser(userData);
}

/**
 * Find or create a Firestore user document from a verified Firebase Auth user.
 *
 * This is the primary entry point for Google sign-in. It implements the
 * following idempotent logic:
 *
 *   1. Look up by firebaseUid first (fastest path for returning Google users).
 *   2. If not found, look up by email (handles existing email/password users
 *      signing in with Google for the first time → link accounts).
 *   3. If found by email but firebaseUid is missing, update the document to
 *      store the firebaseUid and mark the email as verified.
 *   4. If no user exists at all, create a new passwordless user document.
 *
 * Email uniqueness is enforced: if two different Firebase UIDs map to the
 * same email (should not happen in practice), a 409 Conflict is thrown.
 *
 * @param {Object} params
 * @param {string} params.email         - Verified email from Firebase token
 * @param {string} params.firebaseUid   - Firebase Auth UID (uid claim)
 * @param {boolean} [params.emailVerified=false] - email_verified claim
 * @param {string}  [params.displayName='']      - display name from Google
 * @returns {Promise<Object>} Public user object (no password/refreshToken)
 */
async function findOrCreateByFirebaseUser({
  email,
  firebaseUid,
  emailVerified = false,
  displayName = '',
}) {
  if (!email || !firebaseUid) {
    const err = new Error('email and firebaseUid are required for findOrCreateByFirebaseUser');
    err.statusCode = 422;
    throw err;
  }

  const normalised = email.toLowerCase().trim();
  const now = new Date().toISOString();

  // ── Path 1: Returning Google user (fastest lookup) ────────────────────────
  const existingByUid = await findByFirebaseUid(firebaseUid);
  if (existingByUid) {
    // Update verified status and updatedAt in case it changed
    const updates = { updatedAt: now };
    if (emailVerified && !existingByUid.verified) {
      updates.verified = true;
    }
    await usersRef().doc(existingByUid.id).update(updates);
    logger.info(
      `userService.findOrCreateByFirebaseUser: returning Google user ${existingByUid.id} (${normalised})`
    );
    return toPublicUser({ ...existingByUid, ...updates });
  }

  // ── Path 2: Existing email/password user linking Google for the first time ─
  const existingByEmail = await findByEmail(normalised);
  if (existingByEmail) {
    // Sanity check: if this email already has a DIFFERENT firebaseUid, conflict
    if (existingByEmail.firebaseUid && existingByEmail.firebaseUid !== firebaseUid) {
      logger.warn(
        `userService.findOrCreateByFirebaseUser: email ${normalised} already linked to a different Firebase UID`
      );
      const err = new Error(
        'This email is already linked to a different Google account.'
      );
      err.statusCode = 409;
      err.errorCode = 'CONFLICT_ERROR';
      throw err;
    }

    // Link the Firebase UID to the existing account
    const linkUpdates = {
      firebaseUid,
      updatedAt: now,
      ...(emailVerified ? { verified: true } : {}),
    };
    await usersRef().doc(existingByEmail.id).update(linkUpdates);
    logger.info(
      `userService.findOrCreateByFirebaseUser: linked Firebase UID to existing user ${existingByEmail.id} (${normalised})`
    );
    return toPublicUser({ ...existingByEmail, ...linkUpdates });
  }

  // ── Path 3: Brand-new Google user – create a passwordless document ─────────
  const docRef = usersRef().doc();
  const userData = {
    id: docRef.id,
    email: normalised,
    password: null,          // Google-only users have no password
    phone: '',
    verified: emailVerified,
    firebaseUid,
    displayName: displayName || '',
    refreshToken: null,
    createdAt: now,
    updatedAt: now,
  };

  await docRef.set(userData);
  logger.info(
    `userService.findOrCreateByFirebaseUser: created new Google user ${docRef.id} (${normalised})`
  );

  return toPublicUser(userData);
}

/**
 * Update arbitrary fields on a user document.
 *
 * Always sets `updatedAt` to the current ISO timestamp.
 * Returns the updated public user object.
 *
 * @param {string} userId  - Firestore document ID
 * @param {Object} updates - Fields to update (must not include `id`)
 * @returns {Promise<Object>} Updated public user object
 */
async function updateUser(userId, updates) {
  if (!userId) throw new Error('userId is required for updateUser');

  const now = new Date().toISOString();
  const safeUpdates = { ...updates, updatedAt: now };

  // Prevent overwriting the immutable id field
  delete safeUpdates.id;

  try {
    await usersRef().doc(userId).update(safeUpdates);
    const updated = await findById(userId);
    return toPublicUser(updated);
  } catch (err) {
    logger.error(`userService.updateUser error (id=${userId}): ${err.message}`);
    throw err;
  }
}

/**
 * Store a new refresh token for a user (replaces any existing one).
 *
 * @param {string}      userId       - Firestore document ID
 * @param {string|null} refreshToken - New refresh token, or null to clear it
 * @returns {Promise<void>}
 */
async function setRefreshToken(userId, refreshToken) {
  if (!userId) throw new Error('userId is required for setRefreshToken');
  try {
    await usersRef().doc(userId).update({
      refreshToken: refreshToken ?? null,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    logger.error(`userService.setRefreshToken error (id=${userId}): ${err.message}`);
    throw err;
  }
}

/**
 * Clear the refresh token for a user (logout).
 *
 * @param {string} userId - Firestore document ID
 * @returns {Promise<void>}
 */
async function clearRefreshToken(userId) {
  return setRefreshToken(userId, null);
}

/**
 * Clear the refresh token by its value (used during logout when only the
 * token string is available, not the userId).
 *
 * @param {string} refreshToken
 * @returns {Promise<void>}
 */
async function clearRefreshTokenByValue(refreshToken) {
  if (!refreshToken) return;
  const user = await findByRefreshToken(refreshToken);
  if (user) {
    await clearRefreshToken(user.id);
  }
}

/**
 * Verify a plain-text password against the stored bcrypt hash.
 *
 * @param {string} plainPassword  - Password provided by the user
 * @param {string} hashedPassword - Stored bcrypt hash
 * @returns {Promise<boolean>}
 */
async function verifyPassword(plainPassword, hashedPassword) {
  return bcrypt.compare(plainPassword, hashedPassword);
}

/**
 * Update a user's password (hashes the new password before storing).
 *
 * @param {string} userId        - Firestore document ID
 * @param {string} newPassword   - New plain-text password
 * @returns {Promise<void>}
 */
async function updatePassword(userId, newPassword) {
  if (!userId) throw new Error('userId is required for updatePassword');
  const hashed = await bcrypt.hash(newPassword, 12);
  try {
    await usersRef().doc(userId).update({
      password: hashed,
      updatedAt: new Date().toISOString(),
    });
    logger.info(`userService.updatePassword: password updated for user ${userId}`);
  } catch (err) {
    logger.error(`userService.updatePassword error (id=${userId}): ${err.message}`);
    throw err;
  }
}

/**
 * Mark a user's email as verified.
 *
 * @param {string} userId - Firestore document ID
 * @returns {Promise<Object>} Updated public user object
 */
async function verifyUser(userId) {
  return updateUser(userId, { verified: true });
}

/**
 * Delete a user document from Firestore.
 *
 * @param {string} userId - Firestore document ID
 * @returns {Promise<void>}
 */
async function deleteUser(userId) {
  if (!userId) throw new Error('userId is required for deleteUser');
  try {
    await usersRef().doc(userId).delete();
    logger.info(`userService.deleteUser: deleted user ${userId}`);
  } catch (err) {
    logger.error(`userService.deleteUser error (id=${userId}): ${err.message}`);
    throw err;
  }
}

/**
 * Get the public profile of a user by ID (no password/refreshToken).
 *
 * @param {string} userId - Firestore document ID
 * @returns {Promise<Object|null>} Public user object or null
 */
async function getUserById(userId) {
  const user = await findById(userId);
  return toPublicUser(user);
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  // Read
  findById,
  findByEmail,
  findByFirebaseUid,
  findByRefreshToken,
  getUserById,
  // Write
  createUser,
  updateUser,
  deleteUser,
  // Firebase / Google Auth
  findOrCreateByFirebaseUser,
  // Auth helpers
  setRefreshToken,
  clearRefreshToken,
  clearRefreshTokenByValue,
  verifyPassword,
  updatePassword,
  verifyUser,
  // Internal helpers (exported for testing)
  toPublicUser,
};
