/**
 * Morty Backend - Main Server Entry Point
 *
 * Express server with complete security middleware stack:
 * cors → helmet → requestId → rateLimit → morgan → json →
 * sanitize → securityAudit → authGuard → routes → 404 → errorHandler
 *
 * @module index
 */

require('dotenv').config();

const express = require('express');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');

// Internal modules
const connectDB = require('./config/db');
const logger = require('./utils/logger');
const { globalErrorHandler, notFoundHandler } = require('./middleware/errorHandler');
const {
  corsMiddleware,
  helmetMiddleware,
  generalRateLimit,
  sanitizeRequest,
  requestId,
  securityAudit,
} = require('./middleware/security');

// Route modules
const authRoutes = require('./routes/auth');
const profileRoutes = require('./routes/profile');
const offersRoutes = require('./routes/offers');
const analysisRoutes = require('./routes/analysis');
const dashboardRoutes = require('./routes/dashboard');

// ─────────────────────────────────────────────
// App initialization
// ─────────────────────────────────────────────

const app = express();
const PORT = process.env.PORT || 5000;
const API_PREFIX = '/api/v1';

// ─────────────────────────────────────────────
// Trust proxy (for Render.com deployment)
// ─────────────────────────────────────────────

// Trust the first proxy (Render's load balancer)
// Required for correct IP detection with rate limiting
app.set('trust proxy', 1);

// ─────────────────────────────────────────────
// Security Middleware (applied first)
// Order: cors → helmet → requestId → rateLimit
// ─────────────────────────────────────────────

// 1. CORS - must be first to handle preflight requests
app.use(corsMiddleware);

// 2. Helmet - security headers
app.use(helmetMiddleware);

// 3. Request ID - for tracing and log correlation
app.use(requestId);

// 4. General rate limiting - applied to all routes
app.use(generalRateLimit);

// ─────────────────────────────────────────────
// Request Parsing Middleware
// ─────────────────────────────────────────────

// 5. HTTP request logging
if (process.env.NODE_ENV !== 'test') {
  app.use(
    morgan('combined', {
      stream: {
        write: (message) => logger.info(message.trim()),
      },
      skip: (req) => req.path === '/health',
    })
  );
}

// 6. JSON body parser with size limit
app.use(
  express.json({
    limit: '10kb', // Prevent large payload attacks
    strict: true, // Only accept arrays and objects
  })
);

// 7. URL-encoded body parser
app.use(
  express.urlencoded({
    extended: true,
    limit: '10kb',
  })
);

// 8. Cookie parser (for httpOnly cookie auth)
app.use(cookieParser());

// ─────────────────────────────────────────────
// Input Sanitization (after parsing, before routes)
// ─────────────────────────────────────────────

// 9. Sanitize request data (XSS + NoSQL injection prevention)
app.use(sanitizeRequest);

// 10. Security audit (log suspicious patterns)
app.use(securityAudit);

// ─────────────────────────────────────────────
// Health Check (no auth required)
// ─────────────────────────────────────────────

/**
 * @route GET /health
 * @desc Health check endpoint for Render.com and monitoring
 * @access Public
 */
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    service: 'morty-backend',
    version: process.env.npm_package_version || '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
  });
});

/**
 * @route GET /api/v1/health
 * @desc API health check
 * @access Public
 */
app.get(`${API_PREFIX}/health`, (req, res) => {
  res.status(200).json({
    status: 'healthy',
    api: 'v1',
    timestamp: new Date().toISOString(),
  });
});

// ─────────────────────────────────────────────
// API Routes
// ─────────────────────────────────────────────

app.use(`${API_PREFIX}/auth`, authRoutes);
app.use(`${API_PREFIX}/profile`, profileRoutes);
app.use(`${API_PREFIX}/offers`, offersRoutes);
app.use(`${API_PREFIX}/analysis`, analysisRoutes);
app.use(`${API_PREFIX}/dashboard`, dashboardRoutes);

// ─────────────────────────────────────────────
// Error Handling (must be LAST)
// ─────────────────────────────────────────────

// 404 handler - must be after all routes
app.use(notFoundHandler);

// Global error handler - must be last middleware
app.use(globalErrorHandler);

// ─────────────────────────────────────────────
// Server Startup
// ─────────────────────────────────────────────

/**
 * Start the server after connecting to the database.
 */
const startServer = async () => {
  try {
    // Connect to MongoDB
    await connectDB();
    logger.info('Database connected successfully');

    // Start HTTP server
    const server = app.listen(PORT, () => {
      logger.info(`Morty backend server started`, {
        port: PORT,
        environment: process.env.NODE_ENV || 'development',
        apiPrefix: API_PREFIX,
        pid: process.pid,
      });
    });

    // ─────────────────────────────────────────────
    // Graceful Shutdown
    // ─────────────────────────────────────────────

    /**
     * Handle graceful shutdown signals.
     * Closes server and database connections before exiting.
     *
     * @param {string} signal - OS signal (SIGTERM, SIGINT)
     */
    const gracefulShutdown = async (signal) => {
      logger.info(`Received ${signal}. Starting graceful shutdown...`);

      // Stop accepting new connections
      server.close(async () => {
        logger.info('HTTP server closed');

        try {
          // Close database connection
          const mongoose = require('mongoose');
          await mongoose.connection.close();
          logger.info('Database connection closed');

          logger.info('Graceful shutdown complete');
          process.exit(0);
        } catch (err) {
          logger.error('Error during shutdown', { error: err.message });
          process.exit(1);
        }
      });

      // Force shutdown after 30 seconds
      setTimeout(() => {
        logger.error('Forced shutdown after timeout');
        process.exit(1);
      }, 30000);
    };

    // Register shutdown handlers
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    // ─────────────────────────────────────────────
    // Unhandled Error Handlers
    // ─────────────────────────────────────────────

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled Promise Rejection', {
        reason: reason?.message || reason,
        stack: reason?.stack,
      });
      // In production, exit and let process manager restart
      if (process.env.NODE_ENV === 'production') {
        gracefulShutdown('unhandledRejection');
      }
    });

    // Handle uncaught exceptions
    process.on('uncaughtException', (err) => {
      logger.error('Uncaught Exception', {
        error: err.message,
        stack: err.stack,
      });
      // Always exit on uncaught exceptions - state is unknown
      gracefulShutdown('uncaughtException');
    });

    return server;
  } catch (err) {
    logger.error('Failed to start server', { error: err.message, stack: err.stack });
    process.exit(1);
  }
};

// Start the server
startServer();

module.exports = app; // Export for testing
