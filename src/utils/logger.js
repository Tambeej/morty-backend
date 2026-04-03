/**
 * Winston logger with security event support.
 *
 * Provides structured logging for the Morty backend.
 * The `logSecurity` method is used by security middleware to record
 * suspicious or blocked requests.
 */
const { createLogger, format, transports } = require('winston');

const winstonLogger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: format.combine(
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    format.errors({ stack: true }),
    format.printf(({ timestamp, level, message, stack, ...meta }) => {
      const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
      return stack
        ? `${timestamp} [${level.toUpperCase()}] ${message}${metaStr}\n${stack}`
        : `${timestamp} [${level.toUpperCase()}] ${message}${metaStr}`;
    })
  ),
  transports: [
    new transports.Console(),
    ...(process.env.NODE_ENV === 'production'
      ? [
          new transports.File({ filename: 'logs/error.log', level: 'error' }),
          new transports.File({ filename: 'logs/combined.log' }),
        ]
      : []),
  ],
});

/**
 * Thin wrapper around the Winston logger that adds a `logSecurity` helper.
 * All standard Winston methods (info, warn, error, debug) are proxied.
 */
const logger = {
  info: (message, meta) => winstonLogger.info(message, meta),
  warn: (message, meta) => winstonLogger.warn(message, meta),
  error: (message, meta) => winstonLogger.error(message, meta),
  debug: (message, meta) => winstonLogger.debug(message, meta),
  verbose: (message, meta) => winstonLogger.verbose(message, meta),

  /**
   * Log a security-relevant event (CORS block, rate limit, suspicious input, etc.).
   *
   * @param {string} eventType - Short identifier for the event (e.g. 'CORS_BLOCKED')
   * @param {Object} [context] - Additional context (ip, path, userId, …)
   */
  logSecurity: (eventType, context = {}) => {
    winstonLogger.warn(`[SECURITY] ${eventType}`, context);
  },
};

module.exports = logger;
