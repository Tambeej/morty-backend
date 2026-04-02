/**
 * Database Connection Tests
 * Tests for MongoDB connection configuration and error handling.
 */

describe('Database Configuration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should export a connectDB function', () => {
    const connectDB = require('../../config/db');
    expect(typeof connectDB).toBe('function');
  });

  it('should exit process if MONGODB_URI is not set', async () => {
    delete process.env.MONGODB_URI;

    const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });

    const connectDB = require('../../config/db');

    await expect(connectDB()).rejects.toThrow('process.exit called');
    expect(mockExit).toHaveBeenCalledWith(1);

    mockExit.mockRestore();
  });
});
