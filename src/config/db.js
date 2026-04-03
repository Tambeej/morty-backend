/**
 * Database configuration stub.
 *
 * MongoDB/Mongoose has been removed. This file is kept as a placeholder
 * during the migration to Firestore. It will be replaced by
 * src/config/firestore.js in a subsequent task.
 *
 * The connectDB export is a no-op so that any code still importing it
 * does not crash before the Firestore wiring is complete.
 */

const logger = require('../utils/logger');

/**
 * No-op database initialiser.
 * Will be replaced by Firestore initialisation in task 3.
 */
const connectDB = async () => {
  logger.info('Database: Mongoose/MongoDB removed. Firestore will be configured in the next step.');
};

module.exports = connectDB;
