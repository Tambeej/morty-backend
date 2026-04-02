/**
 * Mortgage offer Mongoose model
 */
const mongoose = require('mongoose');

const offerSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    originalFile: {
      url: { type: String, required: true },
      mimetype: { type: String, required: true },
    },
    extractedData: {
      bank: { type: String, default: '' },
      amount: { type: Number, default: null },
      rate: { type: Number, default: null },
      term: { type: Number, default: null },
    },
    analysis: {
      recommendedRate: { type: Number, default: null },
      savings: { type: Number, default: null },
      aiReasoning: { type: String, default: '' },
    },
    status: {
      type: String,
      enum: ['pending', 'analyzed', 'error'],
      default: 'pending',
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Offer', offerSchema);
