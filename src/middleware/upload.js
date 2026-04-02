/**
 * Multer Upload Middleware
 * Handles multipart/form-data file uploads for mortgage offers.
 * Enforces file type (PDF, PNG, JPG) and size (5MB) restrictions.
 */

const multer = require('multer');
const path = require('path');
const { AppError } = require('../utils/errors');

/**
 * Allowed MIME types for mortgage offer uploads.
 * Only PDF and common image formats are accepted.
 */
const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',
];

/**
 * Maximum file size: 5MB in bytes
 */
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

/**
 * Use memory storage so we can stream the buffer directly to Cloudinary.
 * Files are NOT written to disk.
 */
const storage = multer.memoryStorage();

/**
 * File filter function — validates MIME type before accepting the file.
 *
 * @param {Object} req - Express request
 * @param {Object} file - Multer file object
 * @param {Function} cb - Callback(error, acceptFile)
 */
const fileFilter = (req, file, cb) => {
  if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(
      new AppError(
        `Invalid file type. Only PDF, PNG, and JPG files are allowed. Received: ${file.mimetype}`,
        400
      ),
      false
    );
  }
};

/**
 * Multer instance configured for mortgage offer uploads.
 */
const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1, // Only one file per request
  },
});

/**
 * Middleware: handle single file upload under field name 'file'.
 * Wraps multer to provide consistent error handling.
 *
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Function} next - Next middleware
 */
const uploadSingle = (req, res, next) => {
  const multerMiddleware = upload.single('file');

  multerMiddleware(req, res, (err) => {
    if (!err) return next();

    // Handle Multer-specific errors
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(
          new AppError(
            `File too large. Maximum allowed size is ${MAX_FILE_SIZE / (1024 * 1024)}MB.`,
            400
          )
        );
      }
      if (err.code === 'LIMIT_FILE_COUNT') {
        return next(new AppError('Only one file can be uploaded at a time.', 400));
      }
      if (err.code === 'LIMIT_UNEXPECTED_FILE') {
        return next(
          new AppError(
            'Unexpected file field. Use the field name "file" for uploads.',
            400
          )
        );
      }
      return next(new AppError(`Upload error: ${err.message}`, 400));
    }

    // Pass through AppError instances (from fileFilter)
    if (err instanceof AppError) {
      return next(err);
    }

    // Unknown error
    return next(new AppError('File upload failed. Please try again.', 500));
  });
};

/**
 * Middleware: validate that a file was actually provided in the request.
 * Must be used AFTER uploadSingle.
 *
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Function} next - Next middleware
 */
const requireFile = (req, res, next) => {
  if (!req.file) {
    return next(new AppError('No file provided. Please upload a PDF, PNG, or JPG file.', 400));
  }
  next();
};

module.exports = {
  uploadSingle,
  requireFile,
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE,
};
