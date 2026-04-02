/**
 * Financial Model
 * Stores a user's financial profile used for mortgage analysis.
 * One document per user (upserted on update).
 */

const mongoose = require('mongoose');

const financialSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true, // One financial profile per user
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
        type: { type: String, required: true, trim: true },
        amount: { type: Number, required: true, min: 0 },
      },
    ],
  },
  {
    timestamps: true,
  }
);

/**
 * Virtual: total monthly expenses
 */
financialSchema.virtual('totalExpenses').get(function () {
  const { housing = 0, loans = 0, other = 0 } = this.expenses;
  return housing + loans + other;
});

/**
 * Virtual: total assets
 */
financialSchema.virtual('totalAssets').get(function () {
  const { savings = 0, investments = 0 } = this.assets;
  return savings + investments;
});

/**
 * Virtual: total debt amount
 */
financialSchema.virtual('totalDebt').get(function () {
  return this.debts.reduce((sum, d) => sum + d.amount, 0);
});

financialSchema.set('toJSON', {
  virtuals: true,
  transform: (doc, ret) => {
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model('Financial', financialSchema);
