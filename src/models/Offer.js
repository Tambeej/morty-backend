/**
 * Offer Model
 * Represents a mortgage offer uploaded by a user.
 * Stores file metadata, extracted OCR data, and AI analysis results.
 */

const mongoose = require('mongoose');

const offerSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    /**
     * Original uploaded file metadata
     */
    originalFile: {
      url: {
        type: String,
        required: true,
      },
      publicId: {
        // Cloudinary public_id for deletion
        type: String,
        default: null,
      },
      mimetype: {
        type: String,
        required: true,
        enum: ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg'],
      },
      originalName: {
        type: String,
        required: true,
      },
      size: {
        type: Number, // bytes
        required: true,
      },
    },

    /**
     * Data extracted via OCR / AI from the uploaded file
     */
    extractedData: {
      bank: { type: String, default: null },
      amount: { type: Number, default: null }, // ILS
      rate: { type: Number, default: null }, // annual interest rate %
      term: { type: Number, default: null }, // months
      monthlyPayment: { type: Number, default: null }, // ILS
      rawText: { type: String, default: null }, // full OCR text
    },

    /**
     * AI-generated analysis and recommendations
     */
    analysis: {
      recommendedRate: { type: Number, default: null },
      savings: { type: Number, default: null }, // lifetime savings in ILS
      aiReasoning: { type: String, default: null },
      recommendations: [{ type: String }],
    },

    /**
     * Processing status of the offer
     */
    status: {
      type: String,
      enum: ['pending', 'processing', 'analyzed', 'error'],
      default: 'pending',
    },

    /**
     * Error message if processing failed
     */
    errorMessage: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true, // adds createdAt and updatedAt
  }
);

// Compound index for efficient user-specific queries
offerSchema.index({ userId: 1, createdAt: -1 });
offerSchema.index({ userId: 1, status: 1 });

/**
 * Virtual: human-readable file size
 */
offerSchema.virtual('fileSizeFormatted').get(function () {
  const bytes = this.originalFile.size;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
});

/**
 * Transform output: remove internal fields from JSON responses
 */
offerSchema.set('toJSON', {
  virtuals: true,
  transform: (doc, ret) => {
    delete ret.__v;
    // Remove Cloudinary publicId from client responses
    if (ret.originalFile) {
      delete ret.originalFile.publicId;
    }
    return ret;
  },
});

module.exports = mongoose.model('Offer', offerSchema);
