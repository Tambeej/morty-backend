/**
 * Logger Utility
 * Winston-based structured logging for the application.
 * Outputs JSON in production, colorized text in development.
 */

const winston = require('winston');

const { combine, timestamp, printf, colorize, errors, json } = winston.format;

/**
 * Custom log format for development: colorized, human-readable.
 */
const devFormat = combine(
  colorize({ all: true }),
  timestamp({ format: 'HH:mm:ss' }),
  errors({ stack: true }),
  printf(({ level, message, timestamp: ts, stack, ...meta }) => {
    let log = `${ts} [${level}]: ${message}`;
    if (Object.keys(meta).length > 0) {
      log += ` ${JSON.stringify(meta)}`;
    }
    if (stack) {
      log += `\n${stack}`;
    }
    return log;
  })
);

/**
 * Production format: structured JSON for log aggregation.
 */
const prodFormat = combine(
  timestamp(),
  errors({ stack: true }),
  json()
);

const isProduction = process.env.NODE_ENV === 'production';

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug'),
  format: isProduction ? prodFormat : devFormat,
  transports: [
    new winston.transports.Console(),
  ],
  // Don't exit on uncaught exceptions — let the process manager handle it
  exitOnError: false,
});

module.exports = logger;
