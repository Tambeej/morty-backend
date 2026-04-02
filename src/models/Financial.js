/**
 * Financial Model
 * Stores per-user financial profile data for mortgage analysis.
 * Includes income, monthly expenses, assets, and existing debts.
 */

const mongoose = require('mongoose');

const debtSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
  },
  { _id: false }
);

const financialSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true, // one financial profile per user
      index: true,
    },

    // Monthly net income in ILS
    income: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },

    // Additional monthly income (freelance, rental, etc.)
    additionalIncome: {
      type: Number,
      min: 0,
      default: 0,
    },

    // Monthly expenses breakdown
    expenses: {
      housing: { type: Number, min: 0, default: 0 },
      loans: { type: Number, min: 0, default: 0 },
      other: { type: Number, min: 0, default: 0 },
    },

    // Assets
    assets: {
      savings: { type: Number, min: 0, default: 0 },
      investments: { type: Number, min: 0, default: 0 },
    },

    // Existing debts array
    debts: {
      type: [debtSchema],
      default: [],
    },

    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Update the updatedAt field on every save
financialSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  next();
});

/**
 * Compute derived metrics useful for mortgage analysis.
 * Returns total monthly income, total expenses, and disposable income.
 */
financialSchema.methods.computeMetrics = function () {
  const totalIncome = (this.income || 0) + (this.additionalIncome || 0);
  const totalExpenses =
    (this.expenses?.housing || 0) +
    (this.expenses?.loans || 0) +
    (this.expenses?.other || 0);
  const totalAssets =
    (this.assets?.savings || 0) + (this.assets?.investments || 0);
  const totalDebt = (this.debts || []).reduce(
    (sum, d) => sum + (d.amount || 0),
    0
  );
  const disposableIncome = totalIncome - totalExpenses;

  return {
    totalIncome,
    totalExpenses,
    totalAssets,
    totalDebt,
    disposableIncome,
    debtToIncomeRatio:
      totalIncome > 0
        ? parseFloat((totalExpenses / totalIncome).toFixed(4))
        : null,
  };
};

module.exports = mongoose.model('Financial', financialSchema);
