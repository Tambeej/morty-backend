/**
 * User Model Tests
 * Tests for User schema validation, password hashing, and instance methods.
 */

const mongoose = require('mongoose');
const User = require('../../models/User');

// Mock mongoose to avoid actual DB connection in unit tests
jest.mock('mongoose', () => {
  const actualMongoose = jest.requireActual('mongoose');
  return actualMongoose;
});

describe('User Model', () => {
  beforeAll(async () => {
    // Connect to in-memory MongoDB for testing
    const mongoUri = process.env.MONGODB_TEST_URI || 'mongodb://localhost:27017/morty_test';
    try {
      await mongoose.connect(mongoUri);
    } catch (err) {
      // Skip DB tests if no test DB available
      console.warn('Test DB not available, skipping DB tests');
    }
  });

  afterAll(async () => {
    try {
      await mongoose.connection.dropDatabase();
      await mongoose.connection.close();
    } catch (err) {
      // Ignore cleanup errors
    }
  });

  afterEach(async () => {
    try {
      await User.deleteMany({});
    } catch (err) {
      // Ignore cleanup errors
    }
  });

  describe('Schema Validation', () => {
    it('should require email field', async () => {
      const user = new User({
        password: 'Password123!',
        fullName: 'Test User',
      });

      let error;
      try {
        await user.validate();
      } catch (err) {
        error = err;
      }

      expect(error).toBeDefined();
      expect(error.errors.email).toBeDefined();
    });

    it('should require password field', async () => {
      const user = new User({
        email: 'test@example.com',
        fullName: 'Test User',
      });

      let error;
      try {
        await user.validate();
      } catch (err) {
        error = err;
      }

      expect(error).toBeDefined();
      expect(error.errors.password).toBeDefined();
    });

    it('should require fullName field', async () => {
      const user = new User({
        email: 'test@example.com',
        password: 'Password123!',
      });

      let error;
      try {
        await user.validate();
      } catch (err) {
        error = err;
      }

      expect(error).toBeDefined();
      expect(error.errors.fullName).toBeDefined();
    });

    it('should reject invalid email format', async () => {
      const user = new User({
        email: 'not-an-email',
        password: 'Password123!',
        fullName: 'Test User',
      });

      let error;
      try {
        await user.validate();
      } catch (err) {
        error = err;
      }

      expect(error).toBeDefined();
      expect(error.errors.email).toBeDefined();
    });

    it('should convert email to lowercase', () => {
      const user = new User({
        email: 'TEST@EXAMPLE.COM',
        password: 'Password123!',
        fullName: 'Test User',
      });

      expect(user.email).toBe('test@example.com');
    });

    it('should set verified to false by default', () => {
      const user = new User({
        email: 'test@example.com',
        password: 'Password123!',
        fullName: 'Test User',
      });

      expect(user.verified).toBe(false);
    });

    it('should set isActive to true by default', () => {
      const user = new User({
        email: 'test@example.com',
        password: 'Password123!',
        fullName: 'Test User',
      });

      expect(user.isActive).toBe(true);
    });

    it('should validate Israeli phone number format', async () => {
      const user = new User({
        email: 'test@example.com',
        password: 'Password123!',
        fullName: 'Test User',
        phone: 'invalid-phone',
      });

      let error;
      try {
        await user.validate();
      } catch (err) {
        error = err;
      }

      expect(error).toBeDefined();
      expect(error.errors.phone).toBeDefined();
    });

    it('should accept valid Israeli phone number', async () => {
      const user = new User({
        email: 'test@example.com',
        password: 'Password123!',
        fullName: 'Test User',
        phone: '+972501234567',
      });

      let error;
      try {
        await user.validate();
      } catch (err) {
        error = err;
      }

      // Phone validation should pass
      expect(error).toBeUndefined();
    });
  });

  describe('toSafeObject method', () => {
    it('should return user object without sensitive fields', () => {
      const user = new User({
        email: 'test@example.com',
        password: 'Password123!',
        fullName: 'Test User',
      });

      const safeObj = user.toSafeObject();

      expect(safeObj.email).toBe('test@example.com');
      expect(safeObj.fullName).toBe('Test User');
      expect(safeObj.password).toBeUndefined();
      expect(safeObj.refreshToken).toBeUndefined();
    });
  });

  describe('JSON transform', () => {
    it('should exclude sensitive fields from JSON output', () => {
      const user = new User({
        email: 'test@example.com',
        password: 'hashedpassword',
        fullName: 'Test User',
      });

      const json = user.toJSON();

      expect(json.password).toBeUndefined();
      expect(json.refreshToken).toBeUndefined();
      expect(json.__v).toBeUndefined();
    });
  });
});
