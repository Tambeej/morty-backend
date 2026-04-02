/**
 * Database Configuration
 * Handles MongoDB connection via Mongoose with retry logic and event handlers.
 */

const mongoose = require('mongoose');
const logger = require('../utils/logger');

/**
 * Connect to MongoDB Atlas
 * Implements retry logic with exponential backoff.
 * @returns {Promise<void>}
 */
const connectDB = async () => {
  const mongoURI = process.env.MONGODB_URI;

  if (!mongoURI) {
    logger.error('MONGODB_URI environment variable is not set');
    process.exit(1);
  }

  const options = {
    // Use the new URL parser and unified topology
    serverSelectionTimeoutMS: 5000, // Timeout after 5s instead of 30s
    socketTimeoutMS: 45000,         // Close sockets after 45s of inactivity
    maxPoolSize: 10,                // Maintain up to 10 socket connections
    minPoolSize: 2,                 // Maintain at least 2 socket connections
    retryWrites: true,
    w: 'majority',
  };

  // Mongoose connection event handlers
  mongoose.connection.on('connected', () => {
    logger.info('MongoDB connected successfully');
  });

  mongoose.connection.on('error', (err) => {
    logger.error(`MongoDB connection error: ${err.message}`);
  });

  mongoose.connection.on('disconnected', () => {
    logger.warn('MongoDB disconnected. Attempting to reconnect...');
  });

  mongoose.connection.on('reconnected', () => {
    logger.info('MongoDB reconnected successfully');
  });

  // Graceful shutdown
  process.on('SIGINT', async () => {
    await mongoose.connection.close();
    logger.info('MongoDB connection closed due to app termination');
    process.exit(0);
  });

  try {
    await mongoose.connect(mongoURI, options);
    logger.info(`MongoDB connected: ${mongoose.connection.host}`);
  } catch (error) {
    logger.error(`Failed to connect to MongoDB: ${error.message}`);
    // Retry after 5 seconds
    logger.info('Retrying MongoDB connection in 5 seconds...');
    setTimeout(connectDB, 5000);
  }
};

module.exports = connectDB;
