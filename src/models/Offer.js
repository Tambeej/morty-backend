/**
 * Mortgage offer data shape definition.
 *
 * Mongoose has been removed. This module exports a plain-JS schema
 * descriptor that documents the Firestore `offers` collection structure.
 * Actual Firestore CRUD is handled by src/services/offerService.js.
 *
 * Firestore document shape:
 * {
 *   id:     string  (Firestore document ID)
 *   userId: string  (required, indexed with createdAt desc)
 *   originalFile: {
 *     url:      string  (Cloudinary URL)
 *     mimetype: string
 *   }
 *   extractedData: {
 *     bank:   string  (default '')
 *     amount: number|null
 *     rate:   number|null
 *     term:   number|null
 *   }
 *   analysis: {
 *     recommendedRate: number|null
 *     savings:         number|null
 *     aiReasoning:     string  (default '')
 *   }
 *   status:    'pending'|'analyzed'|'error'  (default 'pending')
 *   createdAt: ISO string
 *   updatedAt: ISO string
 * }
 */

/** Valid offer status values. */
const OFFER_STATUSES = Object.freeze(['pending', 'analyzed', 'error']);

/** Field-level schema descriptor (for documentation / validation reference). */
const OfferSchema = {
  collection: 'offers',
  statuses: OFFER_STATUSES,
  fields: {
    id:     { type: 'string', required: true },
    userId: { type: 'string', required: true },
    originalFile: {
      url:      { type: 'string', required: true },
      mimetype: { type: 'string', required: true },
    },
    extractedData: {
      bank:   { type: 'string', default: '' },
      amount: { type: 'number', default: null },
      rate:   { type: 'number', default: null },
      term:   { type: 'number', default: null },
    },
    analysis: {
      recommendedRate: { type: 'number', default: null },
      savings:         { type: 'number', default: null },
      aiReasoning:     { type: 'string', default: '' },
    },
    status:    { type: 'string', enum: OFFER_STATUSES, default: 'pending' },
    createdAt: { type: 'string' },
    updatedAt: { type: 'string' },
  },
};

module.exports = OfferSchema;
