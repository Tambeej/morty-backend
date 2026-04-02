/**
 * Offers Routes
 * Handles mortgage offer file upload and management endpoints.
 *
 * All routes require JWT authentication.
 *
 * Routes:
 *   POST   /api/v1/offers          - Upload a new mortgage offer
 *   GET    /api/v1/offers          - List all offers for the user
 *   GET    /api/v1/offers/stats    - Get offer statistics
 *   GET    /api/v1/offers/:id      - Get a single offer
 *   DELETE /api/v1/offers/:id      - Delete an offer
 */

const express = require('express');
const router = express.Router();

const { authenticate } = require('../middleware/auth');
const { uploadSingle, requireFile } = require('../middleware/upload');
const {
  uploadOffer,
  listOffers,
  getOffer,
  deleteOffer,
  getOfferStats,
} = require('../controllers/offersController');
const { validateOfferUpload } = require('../middleware/validate');

/**
 * All routes in this router require authentication.
 */
router.use(authenticate);

/**
 * POST /api/v1/offers
 * Upload a new mortgage offer file.
 *
 * Middleware chain:
 *   1. uploadSingle  - Multer: parse multipart/form-data, validate file type/size
 *   2. requireFile   - Ensure a file was actually provided
 *   3. validateOfferUpload - Joi: validate optional body fields (bankName)
 *   4. uploadOffer   - Controller: upload to Cloudinary, save to DB
 */
router.post(
  '/',
  uploadSingle,
  requireFile,
  validateOfferUpload,
  uploadOffer
);

/**
 * GET /api/v1/offers/stats
 * Get offer statistics for the authenticated user.
 * Must be defined BEFORE /:id to avoid 'stats' being treated as an ID.
 */
router.get('/stats', getOfferStats);

/**
 * GET /api/v1/offers
 * List all mortgage offers for the authenticated user.
 * Supports pagination and status filtering.
 */
router.get('/', listOffers);

/**
 * GET /api/v1/offers/:id
 * Get a single mortgage offer by ID.
 */
router.get('/:id', getOffer);

/**
 * DELETE /api/v1/offers/:id
 * Delete a mortgage offer and its associated Cloudinary file.
 */
router.delete('/:id', deleteOffer);

module.exports = router;
