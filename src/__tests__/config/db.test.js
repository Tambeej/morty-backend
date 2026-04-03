/**
 * Database Configuration Tests
 *
 * Verifies that the db.js stub (used during the Mongoose→Firestore migration)
 * exports a callable no-op function and does not throw.
 *
 * Full Firestore integration tests will be added in task 3.
 */

describe('Database Configuration (migration stub)', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('should export a connectDB function', () => {
    const connectDB = require('../../config/db');
    expect(typeof connectDB).toBe('function');
  });

  it('should resolve without throwing', async () => {
    const connectDB = require('../../config/db');
    await expect(connectDB()).resolves.toBeUndefined();
  });
});
