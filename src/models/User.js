/**
 * User data shape definition.
 *
 * Mongoose has been removed. This module exports a plain-JS schema
 * descriptor that documents the Firestore `users` collection structure.
 * Actual Firestore CRUD is handled by src/services/userService.js.
 *
 * Firestore document shape:
 * {
 *   id:           string  (Firestore document ID)
 *   email:        string  (unique, lowercase)
 *   password:     string|null (bcrypt hash – never returned to client;
 *                              null for Google-only / passwordless users)
 *   phone:        string  (default '')
 *   verified:     boolean (default false)
 *   firebaseUid:  string|null (Firebase Auth UID; set when user signs in
 *                              with Google; null for email/password-only users)
 *   displayName:  string  (optional; populated from Google profile)
 *   refreshToken: string|null
 *   createdAt:    ISO string
 *   updatedAt:    ISO string
 * }
 */

/** Field-level schema descriptor (for documentation / validation reference). */
const UserSchema = {
  collection: 'users',
  fields: {
    id:           { type: 'string',  required: true },
    email:        { type: 'string',  required: true, unique: true },
    password:     { type: 'string',  required: false, default: null,
                    description: 'bcrypt hash; null for Google-only users' },
    phone:        { type: 'string',  default: '' },
    verified:     { type: 'boolean', default: false },
    firebaseUid:  { type: 'string',  default: null,
                    description: 'Firebase Auth UID; null until user links Google account' },
    displayName:  { type: 'string',  default: '',
                    description: 'Display name from Google profile (optional)' },
    refreshToken: { type: 'string',  default: null },
    createdAt:    { type: 'string' },
    updatedAt:    { type: 'string' },
  },
};

module.exports = UserSchema;
