/**
 * Offer Model
 * Stores mortgage offer documents uploaded by users.
 * Tracks file metadata, OCR-extracted data, and AI analysis results.
 */

const mongoose = require('mongoose');

/**
 * Offer Schema
 * @typedef {Object} Offer
 * @property {ObjectId} userId - Reference to the User document
 * @property {Object} originalFile - Uploaded file metadata
 * @property {Object} extractedData - OCR-extracted mortgage terms
 * @property {Object} analysis - AI analysis results and recommendations
 * @property {string} status - Processing status
 */
const offerSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User ID is required'],
      index: true,
    },
    originalFile: {
      url: {
        type: String,
        required: [true, 'File URL is required'],
        trim: true,
      },
      publicId: {
        type: String,
        trim: true,
        comment: 'Cloudinary public ID for file management',
      },
      filename: {
        type: String,
        trim: true,
      },
      mimetype: {
        type: String,
        enum: ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg'],
        required: [true, 'File MIME type is required'],
      },
      size: {
        type: Number,
        min: 0,
        comment: 'File size in bytes',
      },
    },
    extractedData: {
      bank: {
        type: String,
        trim: true,
        default: null,
        comment: 'Bank name extracted from document',
      },
      amount: {
        type: Number,
        min: 0,
        default: null,
        comment: 'Mortgage amount in ILS',
      },
      rate: {
        type: Number,
        min: 0,
        max: 100,
        default: null,
        comment: 'Annual interest rate percentage',
      },
      term: {
        type: Number,
        min: 1,
        max: 50,
        default: null,
        comment: 'Loan term in years',
      },
      monthlyPayment: {
        type: Number,
        min: 0,
        default: null,
        comment: 'Calculated monthly payment in ILS',
      },
      rawOcrText: {
        type: String,
        select: false,
        comment: 'Raw OCR text output (not returned by default)',
      },
      confidence: {
        type: Number,
        min: 0,
        max: 1,
        default: null,
        comment: 'OCR confidence score (0-1)',
      },
    },
    analysis: {
      recommendedRate: {
        type: Number,
        min: 0,
        max: 100,
        default: null,
        comment: 'AI-recommended optimal interest rate',
      },
      savings: {
        type: Number,
        default: null,
        comment: 'Potential lifetime savings in ILS vs current offer',
      },
      aiReasoning: {
        type: String,
        default: null,
        comment: 'AI explanation of analysis and recommendations',
      },
      recommendations: [
        {
          type: String,
          trim: true,
        },
      ],
      marketComparison: {
        averageRate: {
          type: Number,
          default: null,
        },
        bestRate: {
          type: Number,
          default: null,
        },
        ratePercentile: {
          type: Number,
          min: 0,
          max: 100,
          default: null,
          comment: 'Where this offer falls in market (0=best, 100=worst)',
        },
      },
      analyzedAt: {
        type: Date,
        default: null,
      },
    },
    status: {
      type: String,
      enum: ['pending', 'processing', 'analyzed', 'error'],
      default: 'pending',
      index: true,
    },
    errorMessage: {
      type: String,
      default: null,
      comment: 'Error details if status is error',
    },
    processingStartedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

/**
 * Virtual: Check if offer has been fully analyzed
 */
offerSchema.virtual('isAnalyzed').get(function () {
  return this.status === 'analyzed';
});

/**
 * Virtual: Check if offer is still being processed
 */
offerSchema.virtual('isProcessing').get(function () {
  return this.status === 'pending' || this.status === 'processing';
});

/**
 * Virtual: Calculate total cost of mortgage
 */
offerSchema.virtual('totalCost').get(function () {
  if (
    this.extractedData.monthlyPayment &&
    this.extractedData.term
  ) {
    return this.extractedData.monthlyPayment * this.extractedData.term * 12;
  }
  return null;
});

/**
 * Pre-save middleware: Set processingStartedAt when status changes to processing
 */
offerSchema.pre('save', function (next) {
  if (this.isModified('status') && this.status === 'processing') {
    this.processingStartedAt = new Date();
  }
  if (this.isModified('status') && this.status === 'analyzed') {
    this.analysis.analyzedAt = new Date();
  }
  next();
});

// Indexes for performance
offerSchema.index({ userId: 1, createdAt: -1 });
offerSchema.index({ userId: 1, status: 1 });
offerSchema.index({ status: 1, createdAt: -1 });

const Offer = mongoose.model('Offer', offerSchema);

module.exports = Offer;
