/**
 * Mortgage offer routes
 * POST   /api/v1/offers          – upload a new offer file
 * GET    /api/v1/offers          – list offers for the authenticated user
 * GET    /api/v1/offers/stats    – aggregate stats (count by status)
 * GET    /api/v1/offers/:id      – get a single offer
 * DELETE /api/v1/offers/:id      – delete an offer
 */
const express = require('express');
const router = express.Router();
const offersController = require('../controllers/offersController');
const { protect } = require('../middleware/auth');
const upload = require('../config/multer');

// All offer routes require authentication
router.use(protect);

/**
 * @route  POST /api/v1/offers
 * @desc   Upload a mortgage offer file (multipart/form-data, field: 'file')
 * @access Private
 */
router.post('/', upload.single('file'), offersController.uploadOffer);

/**
 * @route  GET /api/v1/offers/stats
 * @desc   Get offer statistics for the authenticated user
 * @access Private
 */
router.get('/stats', offersController.getStats);

/**
 * @route  GET /api/v1/offers
 * @desc   List all offers for the authenticated user (paginated)
 * @access Private
 */
router.get('/', offersController.listOffers);

/**
 * @route  GET /api/v1/offers/:id
 * @desc   Get a single offer by ID
 * @access Private
 */
router.get('/:id', offersController.getOffer);

/**
 * @route  DELETE /api/v1/offers/:id
 * @desc   Delete an offer by ID
 * @access Private
 */
router.delete('/:id', offersController.deleteOffer);

module.exports = router;
