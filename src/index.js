/**
 * Morty Backend – Express server entry point
 */
require('dotenv').config();

const express = require('express');
const morgan = require('morgan');

const { apiLimiter } = require('./middleware/rateLimit');
const { corsMiddleware, helmetMiddleware } = require('./middleware/security');
const logger = require('./utils/logger');

// Route imports
const authRoutes = require('./routes/auth');
const profileRoutes = require('./routes/profile');
const offersRoutes = require('./routes/offers');
const analysisRoutes = require('./routes/analysis');
const dashboardRoutes = require('./routes/dashboard');
const ratesRoutes = require('./routes/rates');
const wizardRoutes = require('./routes/wizard');
const stripeRoutes = require('./routes/stripe');
// Cron jobs
const { startRatesCron } = require('./cron/ratesCron');

// ── App setup ────────────────────────────────────────────────────────────────
const app = express();

// Trust the first proxy (Render's reverse proxy) so that req.ip,
// rate-limiters, and other IP-dependent middleware work correctly.
app.set('trust proxy', 1);


// Security & utility middleware (order matters)
app.use(helmetMiddleware);
app.use(corsMiddleware);
app.options('*', corsMiddleware);
app.use(apiLimiter);
app.use(morgan('combined', { stream: { write: (msg) => logger.info(msg.trim()) } }));

// ── Stripe Webhook Route (MUST be before express.json()) ─────────────────────
// Stripe webhook signature verification requires the raw request body.
// We mount the webhook endpoint with express.raw() BEFORE the global
// express.json() middleware so the body is not parsed as JSON.
app.use(
  '/api/v1/stripe/webhook',
  express.raw({ type: 'application/json' })
);

// Global JSON body parser (for all other routes)
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/profile', profileRoutes);
app.use('/api/v1/offers', offersRoutes);
app.use('/api/v1/analysis', analysisRoutes);
app.use('/api/v1/dashboard', dashboardRoutes);

// Stripe payment routes
app.use('/api/v1/stripe', stripeRoutes);

// Public routes (no auth required)
app.use('/api/v1/public/rates', ratesRoutes);
app.use('/api/v1/public/wizard', wizardRoutes);

// Health check
app.get('/health', (_req, res) => res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() }));

// 404 handler
app.use((_req, res) => res.status(404).json({ success: false, message: 'Route not found' }));

// Global error handler
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  logger.error(err.stack || err.message);

  // Multer file size error
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ success: false, message: 'File too large. Maximum size is 5 MB.' });
  }

  const status = err.statusCode || err.status || 500;
  const message = err.isOperational ? err.message : 'Internal server error';
  return res.status(status).json({ success: false, message });
});

// ── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5001;

const start = async () => {
  try {
    // Initialise Firestore – the module is required here so that any
    // credential errors surface at startup rather than on first request.
    const db = require('./config/firestore');
    const projectId =
      process.env.FIREBASE_PROJECT_ID ||
      process.env.GCLOUD_PROJECT ||
      process.env.GOOGLE_CLOUD_PROJECT ||
      'unknown';
    logger.info(`Firestore connected (project: ${projectId})`);

    // Attach db to app locals so controllers can access it if needed
    app.locals.db = db;

    // Start cron jobs
    startRatesCron();
    logger.info('Cron jobs initialised');

    // Log Stripe configuration status
    if (process.env.STRIPE_SECRET_KEY) {
      logger.info('Stripe payment integration configured');
    } else {
      logger.warn('Stripe payment integration NOT configured (STRIPE_SECRET_KEY missing)');
    }
  } catch (err) {
    logger.error(`Failed to initialise Firestore: ${err.message}`);
    // In production, exit so the process manager can restart with correct creds
    if (process.env.NODE_ENV === 'production') {
      process.exit(1);
    }
  }

  app.listen(PORT, () => {
    logger.info(`Morty backend running on port ${PORT} in ${process.env.NODE_ENV || 'development'} mode`);
  });
};

start();

module.exports = app; // for testing
