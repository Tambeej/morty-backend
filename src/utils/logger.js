/**
 * Winston logger configuration for the Morty backend.
 * Provides structured logging with different transports for
 * development (console) and production (file + console).
 */

const winston = require('winston');
const path = require('path');
const fs = require('fs');

// Ensure logs directory exists
const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

/**
 * Custom log format for structured logging.
 * Includes timestamp, level, message, and any additional metadata.
 */
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

/**
 * Console format for development - colorized and human-readable.
 */
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
    let log = `${timestamp} [${level}]: ${message}`;
    if (stack) {
      log += `\n${stack}`;
    }
    if (Object.keys(meta).length > 0) {
      log += `\n${JSON.stringify(meta, null, 2)}`;
    }
    return log;
  })
);

/**
 * Define log transports based on environment.
 */
const transports = [];

// Always log to console
transports.push(
  new winston.transports.Console({
    format: process.env.NODE_ENV === 'production' ? logFormat : consoleFormat,
    level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  })
);

// In production, also log to files
if (process.env.NODE_ENV === 'production') {
  // Combined log (all levels)
  transports.push(
    new winston.transports.File({
      filename: path.join(logsDir, 'combined.log'),
      level: 'info',
      format: logFormat,
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5,
      tailable: true,
    })
  );

  // Error log (errors only)
  transports.push(
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      format: logFormat,
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5,
      tailable: true,
    })
  );
}

/**
 * Create the Winston logger instance.
 */
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  format: logFormat,
  transports,
  // Do not exit on uncaught exceptions - let the process manager handle it
  exitOnError: false,
});

/**
 * Create a child logger with additional context.
 * Useful for adding request IDs, user IDs, etc.
 *
 * @param {Object} context - Additional context to include in all log messages
 * @returns {winston.Logger} Child logger instance
 *
 * @example
 * const reqLogger = logger.child({ requestId: req.id, userId: req.user?.id });
 * reqLogger.info('Processing request');
 */
logger.createChild = (context) => logger.child(context);

/**
 * Log HTTP request details.
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {number} duration - Request duration in milliseconds
 */
logger.logRequest = (req, res, duration) => {
  const logData = {
    method: req.method,
    url: req.originalUrl,
    statusCode: res.statusCode,
    duration: `${duration}ms`,
    ip: req.ip || req.connection?.remoteAddress,
    userAgent: req.get('User-Agent'),
    userId: req.user?.id,
    requestId: req.id,
  };

  if (res.statusCode >= 500) {
    logger.error('HTTP Request', logData);
  } else if (res.statusCode >= 400) {
    logger.warn('HTTP Request', logData);
  } else {
    logger.info('HTTP Request', logData);
  }
};

/**
 * Log security events (failed auth, suspicious activity, etc.).
 * @param {string} event - Security event type
 * @param {Object} details - Event details
 */
logger.logSecurity = (event, details) => {
  logger.warn('SECURITY_EVENT', { event, ...details });
};

module.exports = logger;
