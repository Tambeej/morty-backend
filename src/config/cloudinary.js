/**
 * Cloudinary Configuration
 * Sets up the Cloudinary SDK with credentials from environment variables.
 * Used for storing uploaded mortgage offer files (PDFs and images).
 */

const cloudinary = require('cloudinary').v2;
const logger = require('../utils/logger');

/**
 * Configure Cloudinary with environment credentials.
 * Credentials must be set in environment variables:
 *   CLOUDINARY_CLOUD_NAME
 *   CLOUDINARY_API_KEY
 *   CLOUDINARY_API_SECRET
 */
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true, // Always use HTTPS
});

/**
 * Verify Cloudinary configuration on startup.
 * Logs a warning if credentials are missing.
 */
const verifyCloudinaryConfig = () => {
  const { cloud_name, api_key, api_secret } = cloudinary.config();
  if (!cloud_name || !api_key || !api_secret) {
    logger.warn(
      'Cloudinary credentials are not fully configured. File uploads will fail. ' +
        'Please set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.'
    );
    return false;
  }
  logger.info(`Cloudinary configured for cloud: ${cloud_name}`);
  return true;
};

/**
 * Upload a file buffer to Cloudinary.
 *
 * @param {Buffer} fileBuffer - The file data as a Buffer
 * @param {Object} options - Upload options
 * @param {string} options.folder - Cloudinary folder path
 * @param {string} options.resourceType - 'image' | 'raw' (use 'raw' for PDFs)
 * @param {string} options.publicId - Optional custom public ID
 * @returns {Promise<Object>} Cloudinary upload result
 */
const uploadToCloudinary = (fileBuffer, options = {}) => {
  return new Promise((resolve, reject) => {
    const uploadOptions = {
      folder: options.folder || 'morty/offers',
      resource_type: options.resourceType || 'auto',
      use_filename: false,
      unique_filename: true,
      overwrite: false,
      // Tag for easy management
      tags: ['morty', 'mortgage-offer'],
      ...options,
    };

    const uploadStream = cloudinary.uploader.upload_stream(
      uploadOptions,
      (error, result) => {
        if (error) {
          logger.error('Cloudinary upload error:', error);
          return reject(new Error(`File upload failed: ${error.message}`));
        }
        resolve(result);
      }
    );

    uploadStream.end(fileBuffer);
  });
};

/**
 * Delete a file from Cloudinary by its public ID.
 *
 * @param {string} publicId - The Cloudinary public ID of the file
 * @param {string} resourceType - 'image' | 'raw'
 * @returns {Promise<Object>} Cloudinary deletion result
 */
const deleteFromCloudinary = async (publicId, resourceType = 'image') => {
  try {
    const result = await cloudinary.uploader.destroy(publicId, {
      resource_type: resourceType,
    });
    logger.info(`Cloudinary file deleted: ${publicId}`);
    return result;
  } catch (error) {
    logger.error(`Cloudinary deletion error for ${publicId}:`, error);
    throw new Error(`File deletion failed: ${error.message}`);
  }
};

/**
 * Generate a signed URL for secure file access.
 *
 * @param {string} publicId - The Cloudinary public ID
 * @param {Object} options - URL generation options
 * @returns {string} Signed URL
 */
const getSignedUrl = (publicId, options = {}) => {
  return cloudinary.url(publicId, {
    sign_url: true,
    secure: true,
    expires_at: Math.floor(Date.now() / 1000) + 3600, // 1 hour expiry
    ...options,
  });
};

module.exports = {
  cloudinary,
  verifyCloudinaryConfig,
  uploadToCloudinary,
  deleteFromCloudinary,
  getSignedUrl,
};
