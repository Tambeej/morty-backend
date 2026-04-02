/**
 * Morty Backend - Server Entry Point
 * Node.js/Express REST API for AI-powered mortgage analysis.
 *
 * Middleware stack (in order):
 *   cors → helmet → rateLimit → morgan → json → routes → errorHandler
 */

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const connectDB = require('./config/db');
const { verifyCloudinaryConfig } = require('./config/cloudinary');
const { globalErrorHandler } = require('./utils/errors');
const logger = require('./utils/logger');

// Route imports
const authRoutes = require('./routes/auth');
const profileRoutes = require('./routes/profile');
const offersRoutes = require('./routes/offers');

const app = express();
const PORT = process.env.PORT || 5000;

// ─── Security Middleware ──────────────────────────────────────────────────────

/**
 * Helmet: sets security-related HTTP headers.
 */
app.use(helmet());

/**
 * CORS: allow requests from the frontend origin.
 */
const allowedOrigins = [
  process.env.FRONTEND_URL || 'http://localhost:3000',
  'https://tambeej.github.io', // GitHub Pages deployment
];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g., mobile apps, curl, Postman)
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error(`CORS policy: origin ${origin} is not allowed`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

/**
 * Global rate limiter: 100 requests per 15 minutes per IP.
 */
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: { message: 'Too many requests. Please try again later.', statusCode: 429 },
  },
});
app.use(globalLimiter);

// ─── Request Logging ──────────────────────────────────────────────────────────

app.use(
  morgan('combined', {
    stream: { write: (message) => logger.info(message.trim()) },
    skip: (req) => req.url === '/health', // Don't log health checks
  })
);

// ─── Body Parsing ─────────────────────────────────────────────────────────────

app.use(express.json({ limit: '10kb' })); // Limit JSON body size
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// ─── Health Check ─────────────────────────────────────────────────────────────

app.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    status: 'healthy',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
  });
});

// ─── API Routes ───────────────────────────────────────────────────────────────

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/profile', profileRoutes);
app.use('/api/v1/offers', offersRoutes);

/**
 * 404 handler for unmatched routes.
 */
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: {
      message: `Route not found: ${req.method} ${req.originalUrl}`,
      statusCode: 404,
    },
  });
});

// ─── Global Error Handler ─────────────────────────────────────────────────────

app.use(globalErrorHandler);

// ─── Start Server ─────────────────────────────────────────────────────────────

const startServer = async () => {
  try {
    // Connect to MongoDB
    await connectDB();

    // Verify Cloudinary configuration (non-blocking warning)
    verifyCloudinaryConfig();

    app.listen(PORT, () => {
      logger.info(`🚀 Morty backend running on port ${PORT}`);
      logger.info(`   Environment: ${process.env.NODE_ENV || 'development'}`);
      logger.info(`   API base: http://localhost:${PORT}/api/v1`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

module.exports = app; // Export for testing
