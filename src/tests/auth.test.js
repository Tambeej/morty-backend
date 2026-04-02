/**
 * Tests for authentication middleware.
 * Tests token generation, verification, and blacklisting.
 */

const jwt = require('jsonwebtoken');
const {
  generateAccessToken,
  generateRefreshToken,
  verifyToken,
  verifyRefreshToken,
  blacklistToken,
  isTokenBlacklisted,
} = require('../middleware/auth');

// Set up test environment variables
beforeAll(() => {
  process.env.JWT_SECRET = 'test-jwt-secret-key-for-testing-only';
  process.env.JWT_REFRESH_SECRET = 'test-jwt-refresh-secret-key-for-testing-only';
  process.env.JWT_EXPIRES_IN = '1h';
  process.env.JWT_REFRESH_EXPIRES_IN = '7d';
});

describe('Authentication Utilities', () => {
  const testUser = {
    id: '507f1f77bcf86cd799439011',
    email: 'test@example.com',
  };

  describe('generateAccessToken', () => {
    it('should generate a valid JWT token', () => {
      const token = generateAccessToken(testUser);
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3); // JWT has 3 parts
    });

    it('should include user id and email in payload', () => {
      const token = generateAccessToken(testUser);
      const decoded = jwt.decode(token);

      expect(decoded.id).toBe(testUser.id);
      expect(decoded.email).toBe(testUser.email);
    });

    it('should set issuer and audience claims', () => {
      const token = generateAccessToken(testUser);
      const decoded = jwt.decode(token);

      expect(decoded.iss).toBe('morty-backend');
      expect(decoded.aud).toBe('morty-app');
    });
  });

  describe('generateRefreshToken', () => {
    it('should generate a valid refresh token', () => {
      const token = generateRefreshToken(testUser);
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
    });

    it('should include user id in payload', () => {
      const token = generateRefreshToken(testUser);
      const decoded = jwt.decode(token);

      expect(decoded.id).toBe(testUser.id);
    });
  });

  describe('verifyToken', () => {
    it('should verify a valid token', () => {
      const token = generateAccessToken(testUser);
      const decoded = verifyToken(token);

      expect(decoded.id).toBe(testUser.id);
      expect(decoded.email).toBe(testUser.email);
    });

    it('should throw AuthenticationError for invalid token', () => {
      expect(() => verifyToken('invalid.token.here')).toThrow();
    });

    it('should throw AuthenticationError for expired token', () => {
      const expiredToken = jwt.sign(
        { id: testUser.id },
        process.env.JWT_SECRET,
        { expiresIn: '-1s' } // Already expired
      );

      expect(() => verifyToken(expiredToken)).toThrow();
    });

    it('should throw for tampered token', () => {
      const token = generateAccessToken(testUser);
      const tampered = token.slice(0, -5) + 'XXXXX';

      expect(() => verifyToken(tampered)).toThrow();
    });
  });

  describe('verifyRefreshToken', () => {
    it('should verify a valid refresh token', () => {
      const token = generateRefreshToken(testUser);
      const decoded = verifyRefreshToken(token);

      expect(decoded.id).toBe(testUser.id);
    });

    it('should throw for invalid refresh token', () => {
      expect(() => verifyRefreshToken('invalid-token')).toThrow();
    });

    it('should not verify access token as refresh token', () => {
      const accessToken = generateAccessToken(testUser);
      // Access token signed with different secret
      expect(() => verifyRefreshToken(accessToken)).toThrow();
    });
  });

  describe('Token Blacklist', () => {
    it('should blacklist a token', () => {
      const token = generateAccessToken(testUser);
      const decoded = jwt.decode(token);

      expect(isTokenBlacklisted(token)).toBe(false);
      blacklistToken(token, decoded.exp);
      expect(isTokenBlacklisted(token)).toBe(true);
    });

    it('should not affect other tokens', () => {
      const token1 = generateAccessToken(testUser);
      const token2 = generateAccessToken({ ...testUser, id: 'different-id' });
      const decoded1 = jwt.decode(token1);

      blacklistToken(token1, decoded1.exp);

      expect(isTokenBlacklisted(token1)).toBe(true);
      expect(isTokenBlacklisted(token2)).toBe(false);
    });
  });
});
