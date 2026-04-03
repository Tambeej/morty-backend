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
 *   password:     string  (bcrypt hash – never returned to client)
 *   phone:        string  (default '')
 *   verified:     boolean (default false)
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
    password:     { type: 'string',  required: true },
    phone:        { type: 'string',  default: '' },
    verified:     { type: 'boolean', default: false },
    refreshToken: { type: 'string',  default: null },
    createdAt:    { type: 'string' },
    updatedAt:    { type: 'string' },
  },
};

module.exports = UserSchema;
