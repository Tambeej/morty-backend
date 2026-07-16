'use strict';

require('dotenv').config();

const express = require('express');
const morgan = require('morgan');

const { initializeFirebase } = require('./config/firebase');
const { helmetMiddleware, corsMiddleware } = require('./middleware/security');
const { generalLimiter } = require('./middleware/rateLimit');
const { errorHandler } = require('./middleware/errorHandler');
const logger = require('./utils/logger');

// Route imports
const analysisRoutes = require('./routes/analysis');
const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const mortgageCaseRoutes = require('./routes/mortgageCaseRoutes');
const offersRoutes = require('./routes/offers');
const profileRoutes = require('./routes/profile');
const ratesRoutes = require('./routes/rates');
const stripeRoutes = require('./routes/stripe');
const wizardRoutes = require('./routes/wizard');
const wizardPrivateRoutes = require('./routes/wizardPrivateRoutes');

// Initialise Firebase before anything else
try {
  initializeFirebase();
} catch (err) {
  logger.error('Firebase initialisation failed — exiting', { error: err.message });
  process.exit(1);
}

const app = express();

// ─── Security & parsing middleware ───────────────────────────────────────────
app.use(helmetMiddleware);
app.use(corsMiddleware);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ─── Logging ─────────────────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('combined', {
    stream: { write: (msg) => logger.info(msg.trim()) },
  }));
}

// ─── General rate limiting ────────────────────────────────────────────────────
app.use('/api/', generalLimiter);

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
  });
});

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/profile', profileRoutes);
app.use('/api/v1/dashboard', dashboardRoutes);
app.use('/api/v1/offers', offersRoutes);
app.use('/api/v1/analysis', analysisRoutes);
app.use('/api/v1/stripe', stripeRoutes);
app.use('/api/v1/wizard', wizardPrivateRoutes);
app.use('/api/v1/public/wizard', wizardRoutes);
app.use('/api/v1/public/rates', ratesRoutes);
app.use('/api/v1', mortgageCaseRoutes);

// ─── 404 handler ─────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.path} not found`,
    },
  });
});

// ─── Global error handler ─────────────────────────────────────────────────────
app.use(errorHandler);

// ─── Start server ─────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT, 10) || 5000;

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    logger.info(`Morty backend running on port ${PORT}`, {
      env: process.env.NODE_ENV || 'development',
      port: PORT,
    });
  });
}

module.exports = app;
