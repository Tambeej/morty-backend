/**
 * Financial Model
 * Stores user financial profile data used for mortgage analysis.
 * Each user has one financial document (upserted on update).
 */

const mongoose = require('mongoose');

/**
 * Financial Schema
 * @typedef {Object} Financial
 * @property {ObjectId} userId - Reference to the User document
 * @property {number} income - Monthly net income in ILS
 * @property {Object} expenses - Monthly expense breakdown
 * @property {Object} assets - User assets and savings
 * @property {Array} debts - List of existing debts
 * @property {Date} updatedAt - Last update timestamp
 */
const financialSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User ID is required'],
      unique: true, // One financial profile per user
      index: true,
    },
    income: {
      monthly: {
        type: Number,
        min: [0, 'Monthly income cannot be negative'],
        default: 0,
      },
      additional: {
        type: Number,
        min: [0, 'Additional income cannot be negative'],
        default: 0,
      },
    },
    expenses: {
      housing: {
        type: Number,
        min: [0, 'Housing expense cannot be negative'],
        default: 0,
        comment: 'Current rent or mortgage payment in ILS',
      },
      loans: {
        type: Number,
        min: [0, 'Loan expense cannot be negative'],
        default: 0,
        comment: 'Existing loan payments in ILS',
      },
      other: {
        type: Number,
        min: [0, 'Other expenses cannot be negative'],
        default: 0,
        comment: 'Other fixed monthly expenses in ILS',
      },
    },
    assets: {
      savings: {
        type: Number,
        min: [0, 'Savings cannot be negative'],
        default: 0,
        comment: 'Cash and savings in ILS',
      },
      investments: {
        type: Number,
        min: [0, 'Investments cannot be negative'],
        default: 0,
        comment: 'Investment portfolio value in ILS',
      },
    },
    debts: [
      {
        type: {
          type: String,
          enum: ['mortgage', 'car_loan', 'personal_loan', 'credit_card', 'student_loan', 'other'],
          required: true,
        },
        amount: {
          type: Number,
          min: [0, 'Debt amount cannot be negative'],
          required: true,
        },
        monthlyPayment: {
          type: Number,
          min: [0, 'Monthly payment cannot be negative'],
          default: 0,
        },
        description: {
          type: String,
          trim: true,
          maxlength: 200,
        },
      },
    ],
    profileCompleteness: {
      type: Number,
      min: 0,
      max: 100,
      default: 0,
      comment: 'Percentage of profile fields filled (0-100)',
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

/**
 * Virtual: Calculate total monthly income
 */
financialSchema.virtual('totalMonthlyIncome').get(function () {
  return (this.income.monthly || 0) + (this.income.additional || 0);
});

/**
 * Virtual: Calculate total monthly expenses
 */
financialSchema.virtual('totalMonthlyExpenses').get(function () {
  return (
    (this.expenses.housing || 0) +
    (this.expenses.loans || 0) +
    (this.expenses.other || 0)
  );
});

/**
 * Virtual: Calculate total assets
 */
financialSchema.virtual('totalAssets').get(function () {
  return (this.assets.savings || 0) + (this.assets.investments || 0);
});

/**
 * Virtual: Calculate total debt
 */
financialSchema.virtual('totalDebt').get(function () {
  return this.debts.reduce((sum, debt) => sum + (debt.amount || 0), 0);
});

/**
 * Virtual: Calculate debt-to-income ratio
 */
financialSchema.virtual('debtToIncomeRatio').get(function () {
  const totalIncome = this.totalMonthlyIncome;
  if (!totalIncome) return 0;
  return (
    (this.totalMonthlyExpenses / totalIncome) * 100
  ).toFixed(2);
});

/**
 * Pre-save middleware: Calculate profile completeness
 */
financialSchema.pre('save', function (next) {
  let filledFields = 0;
  const totalFields = 6; // income.monthly, expenses.housing, expenses.loans, expenses.other, assets.savings, assets.investments

  if (this.income.monthly > 0) filledFields++;
  if (this.expenses.housing > 0) filledFields++;
  if (this.expenses.loans > 0) filledFields++;
  if (this.expenses.other > 0) filledFields++;
  if (this.assets.savings > 0) filledFields++;
  if (this.assets.investments > 0) filledFields++;

  this.profileCompleteness = Math.round((filledFields / totalFields) * 100);
  next();
});

// Indexes
financialSchema.index({ userId: 1 }, { unique: true });
financialSchema.index({ updatedAt: -1 });

const Financial = mongoose.model('Financial', financialSchema);

module.exports = Financial;
