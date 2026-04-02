/**
 * Financial Model
 * Stores user financial profile data
 */

const mongoose = require('mongoose');

const financialSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },
    income: {
      type: Number,
      required: [true, 'Monthly income is required'],
      min: [0, 'Income cannot be negative'],
    },
    expenses: {
      housing: { type: Number, default: 0, min: 0 },
      loans: { type: Number, default: 0, min: 0 },
      other: { type: Number, default: 0, min: 0 },
    },
    assets: {
      savings: { type: Number, default: 0, min: 0 },
      investments: { type: Number, default: 0, min: 0 },
    },
    debts: [
      {
        type: { type: String, required: true },
        amount: { type: Number, required: true, min: 0 },
      },
    ],
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Financial', financialSchema);
