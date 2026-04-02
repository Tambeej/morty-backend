/**
 * Morty Backend - Main Server Entry Point
 *
 * Express application with security-first middleware stack:
 * cors → helmet → rateLimit → morgan → json → routes
 */

'use strict';

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const { generalLimiter } = require('./middleware/rateLimit');
const { errorHandler, notFoundHandler } = require('./utils/errors');
const logger = require('./utils/logger');

// ---------------------------------------------------------------------------
// App Initialization
// ---------------------------------------------------------------------------
const app = express();
const PORT = process.env.PORT || 5000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// ---------------------------------------------------------------------------
// Middleware Stack (order matters)
// ---------------------------------------------------------------------------

// 1. CORS — allow configured frontend origin
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000')
  .split(',')
  .map((o) => o.trim());

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. mobile apps, curl, Postman)
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error(`CORS policy: origin '${origin}' not allowed`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// 2. Helmet — secure HTTP headers
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'"],
        frameSrc: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);

// 3. Rate Limiting — protect against brute-force / DDoS
app.use('/api/', generalLimiter);

// 4. HTTP Request Logging
if (NODE_ENV !== 'test') {
  app.use(
    morgan('combined', {
      stream: { write: (message) => logger.http(message.trim()) },
    })
  );
}

// 5. Body Parsers
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ---------------------------------------------------------------------------
// Health Check (no auth required)
// ---------------------------------------------------------------------------
app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'morty-backend',
    version: process.env.npm_package_version || '1.0.0',
    environment: NODE_ENV,
    timestamp: new Date().toISOString(),
  });
});

// ---------------------------------------------------------------------------
// API Routes (v1)
// ---------------------------------------------------------------------------
// Routes will be mounted here as they are implemented in subsequent tasks:
// app.use('/api/v1/auth',      require('./routes/auth'));
// app.use('/api/v1/profile',   require('./routes/profile'));
// app.use('/api/v1/offers',    require('./routes/offers'));
// app.use('/api/v1/analysis',  require('./routes/analysis'));
// app.use('/api/v1/dashboard', require('./routes/dashboard'));

// ---------------------------------------------------------------------------
// Error Handling (must be last)
// ---------------------------------------------------------------------------
app.use(notFoundHandler);
app.use(errorHandler);

// ---------------------------------------------------------------------------
// Start Server
// ---------------------------------------------------------------------------
const server = app.listen(PORT, () => {
  logger.info(`Morty backend running on port ${PORT} [${NODE_ENV}]`);
});

// Graceful shutdown
const shutdown = (signal) => {
  logger.info(`${signal} received — shutting down gracefully`);
  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });

  // Force exit after 10 s if connections linger
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10_000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = app; // exported for testing
