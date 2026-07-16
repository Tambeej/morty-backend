/**
 * User Service – Firestore CRUD for the `users` collection.
 *
 * Auth itself is handled by Firebase Auth (client SDK signs in, backend
 * verifies ID tokens via Admin SDK). This service only manages the
 * corresponding Firestore user document — profile fields, linking, lookup.
 *
 * Document shape (stored in Firestore):
 * {
 *   id:           string  (Firestore document ID, also stored as field)
 *   email:        string  (lowercase)
 *   phone:        string  (default '')
 *   verified:     boolean (default false)
 *   firebaseUid:  string  (Firebase Auth UID — used for lookup from `protect`)
 *   displayName:  string  (default '')
 *   createdAt:    ISO string
 *   updatedAt:    ISO string
 * }
 */

'use strict';

const db = require('../config/firestore');
const logger = require('../utils/logger');

const COLLECTION = 'users';
const usersRef = () => db.collection(COLLECTION);

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Return a safe copy of the user doc for callers/clients. Currently a
 * passthrough since we no longer store password/refreshToken on new docs,
 * but this indirection is kept so legacy docs that still have those fields
 * don't leak them.
 */
function toPublicUser(doc) {
  if (!doc) return null;
  const { password, refreshToken, ...publicFields } = doc; // eslint-disable-line no-unused-vars
  return publicFields;
}

function snapToDoc(snap) {
  if (!snap.exists) return null;
  return { id: snap.id, ...snap.data() };
}

// ── Read operations ───────────────────────────────────────────────────────────

/**
 * Find a user by their Firestore document ID.
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
 * Find a user by their Firebase Auth UID.
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

// The Firestore doc for a new user is looked up by email during account
// linking only; keep an internal helper (not exported) for that path.
async function findByEmailInternal(email) {
  if (!email) return null;
  const normalised = email.toLowerCase().trim();
  const snap = await usersRef()
    .where('email', '==', normalised)
    .limit(1)
    .get();

  if (snap.empty) return null;
  const docSnap = snap.docs[0];
  return { id: docSnap.id, ...docSnap.data() };
}

// ── Write operations ──────────────────────────────────────────────────────────

/**
 * Find or create a Firestore user document from a verified Firebase Auth user.
 *
 * Logic:
 *   1. Look up by firebaseUid (fastest path for returning users).
 *   2. Otherwise look up by email — if found, link the firebaseUid.
 *   3. Otherwise create a new document.
 *
 * @param {Object} params
 * @param {string} params.email         - Verified email from Firebase token
 * @param {string} params.firebaseUid   - Firebase Auth UID (uid claim)
 * @param {boolean} [params.emailVerified=false] - email_verified claim
 * @param {string}  [params.displayName='']      - display name from Firebase user
 * @param {string}  [params.phone='']            - optional phone for new users
 * @returns {Promise<Object>} Public user object
 */
async function findOrCreateByFirebaseUser({
  email,
  firebaseUid,
  emailVerified = false,
  displayName = '',
  phone = '',
}) {
  if (!email || !firebaseUid) {
    const err = new Error('email and firebaseUid are required for findOrCreateByFirebaseUser');
    err.statusCode = 422;
    throw err;
  }

  const normalised = email.toLowerCase().trim();
  const now = new Date().toISOString();

  // ── Path 1: Returning user (fastest lookup) ───────────────────────────────
  const existingByUid = await findByFirebaseUid(firebaseUid);
  if (existingByUid) {
    const updates = { updatedAt: now };
    if (emailVerified && !existingByUid.verified) {
      updates.verified = true;
    }
    await usersRef().doc(existingByUid.id).update(updates);
    logger.info(
      `userService.findOrCreateByFirebaseUser: returning user ${existingByUid.id} (${normalised})`
    );
    return toPublicUser({ ...existingByUid, ...updates });
  }

  // ── Path 2: Existing account linking Firebase for the first time ──────────
  const existingByEmail = await findByEmailInternal(normalised);
  if (existingByEmail) {
    if (existingByEmail.firebaseUid && existingByEmail.firebaseUid !== firebaseUid) {
      logger.warn(
        `userService.findOrCreateByFirebaseUser: email ${normalised} already linked to a different Firebase UID`
      );
      const err = new Error(
        'This email is already linked to a different account.'
      );
      err.statusCode = 409;
      err.errorCode = 'CONFLICT_ERROR';
      throw err;
    }

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

  // ── Path 3: Brand-new user – create a Firestore document ──────────────────
  const docRef = usersRef().doc();
  const userData = {
    id: docRef.id,
    email: normalised,
    phone: phone || '',
    verified: emailVerified,
    firebaseUid,
    displayName: displayName || '',
    createdAt: now,
    updatedAt: now,
  };

  await docRef.set(userData);
  logger.info(
    `userService.findOrCreateByFirebaseUser: created new user ${docRef.id} (${normalised})`
  );

  return toPublicUser(userData);
}

/**
 * Update arbitrary fields on a user document.
 */
async function updateUser(userId, updates) {
  if (!userId) throw new Error('userId is required for updateUser');

  const now = new Date().toISOString();
  const safeUpdates = { ...updates, updatedAt: now };
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
 * Mark a user's email as verified.
 */
async function verifyUser(userId) {
  return updateUser(userId, { verified: true });
}

/**
 * Delete a user document from Firestore.
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
 * Get the public profile of a user by ID.
 */
async function getUserById(userId) {
  const user = await findById(userId);
  return toPublicUser(user);
}

module.exports = {
  findById,
  findByFirebaseUid,
  getUserById,
  findOrCreateByFirebaseUser,
  updateUser,
  verifyUser,
  deleteUser,
  toPublicUser,
};
