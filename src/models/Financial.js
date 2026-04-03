/**
 * Financial profile data shape definition.
 *
 * Mongoose has been removed. This module exports a plain-JS schema
 * descriptor that documents the Firestore `financials` collection structure.
 * Actual Firestore CRUD is handled by src/services/financialService.js.
 *
 * Firestore document shape:
 * {
 *   id:               string  (Firestore document ID == userId)
 *   userId:           string  (required, indexed)
 *   income:           number  (required, >= 0)
 *   additionalIncome: number  (default 0)
 *   expenses: {
 *     housing:        number  (default 0)
 *     loans:          number  (default 0)
 *     other:          number  (default 0)
 *   }
 *   assets: {
 *     savings:        number  (default 0)
 *     investments:    number  (default 0)
 *   }
 *   debts: Array<{ type: string, amount: number }>
 *   updatedAt:        ISO string
 * }
 */

/** Field-level schema descriptor (for documentation / validation reference). */
const FinancialSchema = {
  collection: 'financials',
  fields: {
    id:               { type: 'string', required: true },
    userId:           { type: 'string', required: true },
    income:           { type: 'number', required: true, min: 0 },
    additionalIncome: { type: 'number', default: 0 },
    expenses: {
      housing:        { type: 'number', default: 0 },
      loans:          { type: 'number', default: 0 },
      other:          { type: 'number', default: 0 },
    },
    assets: {
      savings:        { type: 'number', default: 0 },
      investments:    { type: 'number', default: 0 },
    },
    debts:            { type: 'array',  default: [] },
    updatedAt:        { type: 'string' },
  },
};

module.exports = FinancialSchema;
