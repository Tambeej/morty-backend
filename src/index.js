/**
 * Morty Backend – Express server entry point
 */
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const connectDB = require('./config/db');
const { apiLimiter } = require('./middleware/rateLimit');
const logger = require('./utils/logger');

// Route imports
const authRoutes = require('./routes/auth');
const profileRoutes = require('./routes/profile');
const offersRoutes = require('./routes/offers');
const analysisRoutes = require('./routes/analysis');
const dashboardRoutes = require('./routes/dashboard');

// ── App setup ────────────────────────────────────────────────────────────────
const app = express();

// Security & utility middleware (order matters)
app.use(helmet());
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
    credentials: true,
  })
);
app.use(apiLimiter);
app.use(morgan('combined', { stream: { write: (msg) => logger.info(msg.trim()) } }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/profile', profileRoutes);
app.use('/api/v1/offers', offersRoutes);
app.use('/api/v1/analysis', analysisRoutes);
app.use('/api/v1/dashboard', dashboardRoutes);

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
const PORT = process.env.PORT || 5000;

const start = async () => {
  await connectDB();
  app.listen(PORT, () => {
    logger.info(`Morty backend running on port ${PORT} in ${process.env.NODE_ENV || 'development'} mode`);
  });
};

start();

module.exports = app; // for testing
