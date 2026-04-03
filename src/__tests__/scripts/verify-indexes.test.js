/**
 * Tests for scripts/verify-indexes.js
 *
 * Verifies that the index definitions are internally consistent and that
 * the helper functions return the expected subsets.
 */

'use strict';

const {
  REQUIRED_INDEXES,
  validateIndexDefinitions,
  getCompositeIndexes,
  getSingleFieldIndexes,
} = require('../../../scripts/verify-indexes');

describe('Firestore Index Definitions', () => {
  // ── Structure validation ──────────────────────────────────────────────────

  it('should have at least one index defined', () => {
    expect(REQUIRED_INDEXES.length).toBeGreaterThan(0);
  });

  it('should pass internal validation without throwing', () => {
    expect(() => validateIndexDefinitions()).not.toThrow();
  });

  it('every index should have a non-empty collection name', () => {
    REQUIRED_INDEXES.forEach((idx) => {
      expect(typeof idx.collection).toBe('string');
      expect(idx.collection.length).toBeGreaterThan(0);
    });
  });

  it('every index type should be composite or single-field', () => {
    REQUIRED_INDEXES.forEach((idx) => {
      expect(['composite', 'single-field']).toContain(idx.type);
    });
  });

  it('every index should have at least one field', () => {
    REQUIRED_INDEXES.forEach((idx) => {
      expect(Array.isArray(idx.fields)).toBe(true);
      expect(idx.fields.length).toBeGreaterThan(0);
    });
  });

  it('every field direction should be ASC or DESC', () => {
    REQUIRED_INDEXES.forEach((idx) => {
      idx.fields.forEach((f) => {
        expect(['ASC', 'DESC']).toContain(f.direction);
      });
    });
  });

  it('every index should document at least one usedBy entry', () => {
    REQUIRED_INDEXES.forEach((idx) => {
      expect(Array.isArray(idx.usedBy)).toBe(true);
      expect(idx.usedBy.length).toBeGreaterThan(0);
    });
  });

  // ── Required indexes presence ─────────────────────────────────────────────

  it('should include the critical offers userId+createdAt composite index', () => {
    const composites = getCompositeIndexes();
    const offersDateIndex = composites.find(
      (idx) =>
        idx.collection === 'offers' &&
        idx.fields.some((f) => f.field === 'userId' && f.direction === 'ASC') &&
        idx.fields.some((f) => f.field === 'createdAt' && f.direction === 'DESC')
    );
    expect(offersDateIndex).toBeDefined();
  });

  it('should include the offers userId+status composite index', () => {
    const composites = getCompositeIndexes();
    const offersStatusIndex = composites.find(
      (idx) =>
        idx.collection === 'offers' &&
        idx.fields.some((f) => f.field === 'userId') &&
        idx.fields.some((f) => f.field === 'status')
    );
    expect(offersStatusIndex).toBeDefined();
  });

  it('should include a single-field index for users.email', () => {
    const singleField = getSingleFieldIndexes();
    const emailIndex = singleField.find(
      (idx) =>
        idx.collection === 'users' &&
        idx.fields.some((f) => f.field === 'email')
    );
    expect(emailIndex).toBeDefined();
  });

  it('should include a single-field index for users.refreshToken', () => {
    const singleField = getSingleFieldIndexes();
    const tokenIndex = singleField.find(
      (idx) =>
        idx.collection === 'users' &&
        idx.fields.some((f) => f.field === 'refreshToken')
    );
    expect(tokenIndex).toBeDefined();
  });

  // ── Helper functions ──────────────────────────────────────────────────────

  it('getCompositeIndexes should return only composite indexes', () => {
    const composites = getCompositeIndexes();
    composites.forEach((idx) => {
      expect(idx.type).toBe('composite');
    });
  });

  it('getSingleFieldIndexes should return only single-field indexes', () => {
    const singleField = getSingleFieldIndexes();
    singleField.forEach((idx) => {
      expect(idx.type).toBe('single-field');
    });
  });

  it('composite + single-field counts should equal total', () => {
    const composites  = getCompositeIndexes();
    const singleField = getSingleFieldIndexes();
    expect(composites.length + singleField.length).toBe(REQUIRED_INDEXES.length);
  });

  // ── Collections covered ───────────────────────────────────────────────────

  it('should cover all three Firestore collections', () => {
    const collections = new Set(REQUIRED_INDEXES.map((idx) => idx.collection));
    expect(collections.has('offers')).toBe(true);
    expect(collections.has('users')).toBe(true);
    expect(collections.has('financials')).toBe(true);
  });
});
