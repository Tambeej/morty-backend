/**
 * Database configuration – Firestore migration shim.
 *
 * This file previously contained the Mongoose/MongoDB connection.
 * It now re-exports the Firestore `db` instance from `firestore.js`
 * so that any code still importing `db.js` continues to work without
 * modification during the incremental migration.
 *
 * New code should import directly from `./firestore`.
 */

const db = require('./firestore');

module.exports = db;
