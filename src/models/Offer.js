/**
 * Offer Model
 * Represents a mortgage offer uploaded by a user
 */

const mongoose = require('mongoose');

const recommendationSchema = new mongoose.Schema(
  {
    priority: { type: Number },
    type: { type: String },
    title: { type: String },
    description: { type: String },
    potentialSavings: { type: Number, default: null },
  },
  { _id: false }
);

const offerSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    originalFile: {
      url: { type: String, required: true },
      mimetype: { type: String, required: true },
      originalName: { type: String },
      size: { type: Number },
      publicId: { type: String },
    },
    extractedData: {
      bank: { type: String, default: null },
      amount: { type: Number, default: null },
      rate: { type: Number, default: null },
      term: { type: Number, default: null },
      monthlyPayment: { type: Number, default: null },
      loanType: { type: String, default: null },
      currency: { type: String, default: 'ILS' },
      additionalFees: { type: String, default: null },
      conditions: { type: String, default: null },
    },
    analysis: {
      recommendedRate: { type: Number, default: null },
      savings: { type: Number, default: 0 },
      aiReasoning: { type: String, default: null },
      monthlyPayment: { type: Number, default: null },
      totalCost: { type: Number, default: null },
      totalInterest: { type: Number, default: null },
      marketAverageRate: { type: Number, default: null },
      rateVsMarket: { type: Number, default: null },
      debtToIncomeRatio: { type: Number, default: null },
      affordabilityScore: { type: Number, default: null },
      recommendations: [recommendationSchema],
      analysisSource: {
        type: String,
        enum: ['openai', 'algorithmic', 'mock'],
        default: null,
      },
      analyzedAt: { type: Date, default: null },
    },
    status: {
      type: String,
      enum: ['pending', 'analyzed', 'error'],
      default: 'pending',
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

// Compound indexes for efficient queries
offerSchema.index({ userId: 1, createdAt: -1 });
offerSchema.index({ userId: 1, status: 1 });

module.exports = mongoose.model('Offer', offerSchema);
