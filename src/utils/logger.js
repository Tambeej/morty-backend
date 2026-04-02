/**
 * Winston Logger Utility
 * Provides structured logging with different transports for dev/prod.
 */

const { createLogger, format, transports } = require('winston');

const { combine, timestamp, printf, colorize, errors } = format;

const devFormat = printf(({ level, message, timestamp: ts, stack, ...meta }) => {
  const metaStr = Object.keys(meta).length ? `\n${JSON.stringify(meta, null, 2)}` : '';
  return `${ts} [${level}]: ${stack || message}${metaStr}`;
});

const prodFormat = printf((info) => JSON.stringify(info));

const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    errors({ stack: true })
  ),
  transports: [
    new transports.Console({
      format:
        process.env.NODE_ENV === 'production'
          ? prodFormat
          : combine(colorize(), devFormat),
    }),
  ],
});

module.exports = logger;
