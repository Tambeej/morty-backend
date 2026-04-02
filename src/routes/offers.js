/**
 * Offers Routes
 * Handles mortgage offer file upload and retrieval
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { uploadOffer, getOffers, getOffer, deleteOffer } = require('../controllers/offersController');
const authMiddleware = require('../middleware/auth');
const { AppError } = require('../utils/errors');

// Ensure uploads directory exists
const uploadsDir = process.env.UPLOAD_DIR || 'uploads';
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${uniqueSuffix}${path.extname(file.originalname)}`);
  },
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new AppError('Invalid file type. Only PDF, PNG, and JPG are allowed.', 400), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
});

// All offer routes require authentication
router.use(authMiddleware);

/**
 * @route   POST /api/v1/offers
 * @desc    Upload a mortgage offer document
 * @access  Private
 */
router.post('/', upload.single('file'), uploadOffer);

/**
 * @route   GET /api/v1/offers
 * @desc    Get all offers for the authenticated user
 * @access  Private
 */
router.get('/', getOffers);

/**
 * @route   GET /api/v1/offers/:id
 * @desc    Get a specific offer by ID
 * @access  Private
 */
router.get('/:id', getOffer);

/**
 * @route   DELETE /api/v1/offers/:id
 * @desc    Delete a specific offer
 * @access  Private
 */
router.delete('/:id', deleteOffer);

module.exports = router;
