/**
 * Offers Controller
 * Handles mortgage offer file uploads, retrieval, and deletion.
 * Integrates with Cloudinary for file storage.
 */

const Offer = require('../models/Offer');
const { uploadToCloudinary, deleteFromCloudinary } = require('../config/cloudinary');
const { AppError } = require('../utils/errors');
const logger = require('../utils/logger');

/**
 * Determine Cloudinary resource type based on MIME type.
 * PDFs must use 'raw', images use 'image'.
 *
 * @param {string} mimetype - File MIME type
 * @returns {string} Cloudinary resource type
 */
const getCloudinaryResourceType = (mimetype) => {
  if (mimetype === 'application/pdf') return 'raw';
  return 'image';
};

/**
 * POST /api/v1/offers
 * Upload a new mortgage offer file.
 *
 * Accepts multipart/form-data with:
 *   - file: PDF, PNG, or JPG (max 5MB)
 *   - bankName (optional): name of the bank
 *
 * Flow:
 *   1. Validate file (done by Multer middleware)
 *   2. Upload file buffer to Cloudinary
 *   3. Create Offer document in MongoDB with 'pending' status
 *   4. Return offer data to client
 *   5. (AI analysis triggered separately in task 6)
 *
 * @param {Object} req - Express request (req.file from Multer, req.user from auth)
 * @param {Object} res - Express response
 * @param {Function} next - Next middleware
 */
const uploadOffer = async (req, res, next) => {
  try {
    const { file } = req;
    const userId = req.user.id;
    const { bankName } = req.body;

    logger.info(`User ${userId} uploading offer: ${file.originalname} (${file.mimetype}, ${file.size} bytes)`);

    // Determine Cloudinary resource type
    const resourceType = getCloudinaryResourceType(file.mimetype);

    // Upload file buffer to Cloudinary
    let cloudinaryResult;
    try {
      cloudinaryResult = await uploadToCloudinary(file.buffer, {
        folder: `morty/offers/${userId}`,
        resourceType,
        // Use original filename (sanitized) as part of the public ID context
        context: {
          original_name: file.originalname,
          user_id: userId.toString(),
        },
      });
    } catch (uploadError) {
      logger.error(`Cloudinary upload failed for user ${userId}:`, uploadError);
      return next(new AppError('Failed to store the uploaded file. Please try again.', 502));
    }

    logger.info(`File uploaded to Cloudinary: ${cloudinaryResult.public_id}`);

    // Create Offer document in MongoDB
    const offer = await Offer.create({
      userId,
      originalFile: {
        url: cloudinaryResult.secure_url,
        publicId: cloudinaryResult.public_id,
        mimetype: file.mimetype,
        originalName: file.originalname,
        size: file.size,
      },
      // Pre-populate bank name if provided
      extractedData: {
        bank: bankName || null,
      },
      status: 'pending',
    });

    logger.info(`Offer created: ${offer._id} for user ${userId}`);

    res.status(201).json({
      success: true,
      message: 'Mortgage offer uploaded successfully. Analysis is queued.',
      data: {
        offer,
      },
    });
  } catch (error) {
    logger.error('uploadOffer error:', error);
    next(error);
  }
};

/**
 * GET /api/v1/offers
 * List all mortgage offers for the authenticated user.
 *
 * Query params:
 *   - status: filter by status ('pending' | 'processing' | 'analyzed' | 'error')
 *   - page: page number (default: 1)
 *   - limit: items per page (default: 10, max: 50)
 *
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Function} next - Next middleware
 */
const listOffers = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { status } = req.query;

    // Pagination
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));
    const skip = (page - 1) * limit;

    // Build query filter
    const filter = { userId };
    if (status && ['pending', 'processing', 'analyzed', 'error'].includes(status)) {
      filter.status = status;
    }

    // Execute query with pagination
    const [offers, total] = await Promise.all([
      Offer.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean({ virtuals: true }),
      Offer.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      data: {
        offers,
        pagination: {
          total,
          page,
          limit,
          pages: Math.ceil(total / limit),
          hasNext: page * limit < total,
          hasPrev: page > 1,
        },
      },
    });
  } catch (error) {
    logger.error('listOffers error:', error);
    next(error);
  }
};

/**
 * GET /api/v1/offers/:id
 * Get a single mortgage offer by ID.
 * Only the owner can access their offer.
 *
 * @param {Object} req - Express request (req.params.id)
 * @param {Object} res - Express response
 * @param {Function} next - Next middleware
 */
const getOffer = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const offer = await Offer.findOne({ _id: id, userId }).lean({ virtuals: true });

    if (!offer) {
      return next(new AppError('Offer not found.', 404));
    }

    res.status(200).json({
      success: true,
      data: { offer },
    });
  } catch (error) {
    // Handle invalid MongoDB ObjectId
    if (error.name === 'CastError') {
      return next(new AppError('Invalid offer ID.', 400));
    }
    logger.error('getOffer error:', error);
    next(error);
  }
};

/**
 * DELETE /api/v1/offers/:id
 * Delete a mortgage offer and its associated file from Cloudinary.
 * Only the owner can delete their offer.
 *
 * @param {Object} req - Express request (req.params.id)
 * @param {Object} res - Express response
 * @param {Function} next - Next middleware
 */
const deleteOffer = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    // Find the offer (need publicId for Cloudinary deletion)
    const offer = await Offer.findOne({ _id: id, userId });

    if (!offer) {
      return next(new AppError('Offer not found.', 404));
    }

    // Delete file from Cloudinary (best-effort — don't fail if Cloudinary is down)
    if (offer.originalFile && offer.originalFile.publicId) {
      const resourceType = getCloudinaryResourceType(offer.originalFile.mimetype);
      try {
        await deleteFromCloudinary(offer.originalFile.publicId, resourceType);
      } catch (cloudinaryError) {
        // Log but don't block deletion
        logger.warn(
          `Failed to delete Cloudinary file ${offer.originalFile.publicId}: ${cloudinaryError.message}`
        );
      }
    }

    // Delete from MongoDB
    await Offer.deleteOne({ _id: id, userId });

    logger.info(`Offer ${id} deleted by user ${userId}`);

    res.status(200).json({
      success: true,
      message: 'Offer deleted successfully.',
    });
  } catch (error) {
    if (error.name === 'CastError') {
      return next(new AppError('Invalid offer ID.', 400));
    }
    logger.error('deleteOffer error:', error);
    next(error);
  }
};

/**
 * GET /api/v1/offers/stats
 * Get offer statistics for the authenticated user.
 * Returns counts by status and summary metrics.
 *
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Function} next - Next middleware
 */
const getOfferStats = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const stats = await Offer.aggregate([
      { $match: { userId: require('mongoose').Types.ObjectId.createFromHexString(userId.toString()) } },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
        },
      },
    ]);

    // Transform to a flat object
    const statusCounts = {
      pending: 0,
      processing: 0,
      analyzed: 0,
      error: 0,
    };
    stats.forEach(({ _id, count }) => {
      if (_id in statusCounts) statusCounts[_id] = count;
    });

    const total = Object.values(statusCounts).reduce((sum, c) => sum + c, 0);

    res.status(200).json({
      success: true,
      data: {
        stats: {
          total,
          ...statusCounts,
        },
      },
    });
  } catch (error) {
    logger.error('getOfferStats error:', error);
    next(error);
  }
};

module.exports = {
  uploadOffer,
  listOffers,
  getOffer,
  deleteOffer,
  getOfferStats,
};
