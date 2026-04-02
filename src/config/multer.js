/**
 * Multer configuration for file uploads
 * Accepts PDF, PNG, JPG up to 5 MB.
 */
const multer = require('multer');
const path = require('path');
const os = require('os');

const ALLOWED_TYPES = ['application/pdf', 'image/png', 'image/jpeg'];
const MAX_SIZE = 5 * 1024 * 1024; // 5 MB

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, os.tmpdir()),
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${unique}${path.extname(file.originalname)}`);
  },
});

const fileFilter = (_req, file, cb) => {
  if (ALLOWED_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only PDF, PNG, and JPG files are allowed'), false);
  }
};

module.exports = multer({ storage, fileFilter, limits: { fileSize: MAX_SIZE } });
