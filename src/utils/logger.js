/**
 * Logger Utility
 * Winston-based structured logging for the Morty backend.
 * Supports different log levels and formats for development vs production.
 */

const winston = require('winston');

const { combine, timestamp, printf, colorize, errors, json } = winston.format;

// Custom log format for development (human-readable)
const devFormat = printf(({ level, message, timestamp, stack }) => {
  return `${timestamp} [${level}]: ${stack || message}`;
});

// Determine environment
const isDevelopment = process.env.NODE_ENV !== 'production';

/**
 * Create Winston logger instance
 */
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || (isDevelopment ? 'debug' : 'info'),
  format: combine(
    errors({ stack: true }), // Capture stack traces
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    isDevelopment
      ? combine(colorize(), devFormat)
      : json() // JSON format for production (easier to parse in log aggregators)
  ),
  transports: [
    // Console transport (always active)
    new winston.transports.Console({
      silent: process.env.NODE_ENV === 'test', // Suppress logs during testing
    }),
  ],
  exitOnError: false,
});

// Add file transport in production
if (!isDevelopment) {
  logger.add(
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    })
  );
  logger.add(
    new winston.transports.File({
      filename: 'logs/combined.log',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    })
  );
}

/**
 * Stream interface for Morgan HTTP logger integration
 */
logger.stream = {
  write: (message) => {
    logger.http(message.trim());
  },
};

module.exports = logger;
