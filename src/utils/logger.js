/**
 * Winston Logger
 *
 * Provides structured logging with different transports based on environment:
 * - Development: colourised console output
 * - Production:  JSON console output (suitable for log aggregators)
 *
 * Log levels: error > warn > info > http > verbose > debug > silly
 */

'use strict';

const { createLogger, format, transports } = require('winston');

const { combine, timestamp, printf, colorize, errors, json } = format;

const NODE_ENV = process.env.NODE_ENV || 'development';
const LOG_LEVEL = process.env.LOG_LEVEL || (NODE_ENV === 'production' ? 'info' : 'debug');

// Custom format for development — human-readable
const devFormat = combine(
  colorize({ all: true }),
  timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  errors({ stack: true }),
  printf(({ level, message, timestamp: ts, stack }) => {
    return stack
      ? `${ts} [${level}]: ${message}\n${stack}`
      : `${ts} [${level}]: ${message}`;
  })
);

// JSON format for production — machine-readable
const prodFormat = combine(
  timestamp(),
  errors({ stack: true }),
  json()
);

const logger = createLogger({
  level: LOG_LEVEL,
  format: NODE_ENV === 'production' ? prodFormat : devFormat,
  transports: [
    new transports.Console(),
  ],
  exitOnError: false,
});

module.exports = logger;
