/**
 * userService Unit Tests
 *
 * Tests all CRUD and auth-related operations in userService.js
 * using a fully mocked Firestore instance. No live database required.
 */

'use strict';

// ── Environment setup ─────────────────────────────────────────────────────────
process.env.NODE_ENV = 'test';

// ── Mock Firestore ────────────────────────────────────────────────────────────

/**
 * We mock the entire firestore module so that userService never touches
 * a real Firestore instance. Each test can override individual mock
 * implementations via mockResolvedValueOnce / mockReturnValueOnce.
 */
const mockDocRef = {
  id: 'generated-doc-id',
  get: jest.fn(),
  set: jest.fn().mockResolvedValue({}),
  update: jest.fn().mockResolvedValue({}),
  delete: jest.fn().mockResolvedValue({}),
};

const mockQuerySnap = {
  empty: true,
  docs: [],
  size: 0,
};

const mockCollectionRef = {
  doc: jest.fn().mockReturnValue(mockDocRef),
  where: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  get: jest.fn().mockResolvedValue(mockQuerySnap),
};

jest.mock('../../config/firestore', () => ({
  collection: jest.fn().mockReturnValue(mockCollectionRef),
}));

// ── Import service AFTER mocking ──────────────────────────────────────────────
const userService = require('../../services/userService');

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a mock Firestore DocumentSnapshot that exists. */
const makeExistingSnap = (data) => ({
  exists: true,
  id: data.id || 'user-doc-id',
  data: () => data,
});

/** Build a mock Firestore DocumentSnapshot that does NOT exist. */
const makeNotFoundSnap = () => ({
  exists: false,
  id: 'nonexistent',
  data: () => null,
});

/** Sample full user document (as stored in Firestore). */
const sampleUser = {
  id: 'firestore-uid-abc123',
  email: 'test@morty.co.il',
  password: '$2a$12$hashedpassword',
  phone: '0501234567',
  verified: false,
  refreshToken: null,
  createdAt: '2026-04-03T02:16:00.000Z',
  updatedAt: '2026-04-03T02:16:00.000Z',
};

/** Public user (no password / refreshToken). */
const publicUser = {
  id: sampleUser.id,
  email: sampleUser.email,
  phone: sampleUser.phone,
  verified: sampleUser.verified,
  createdAt: sampleUser.createdAt,
  updatedAt: sampleUser.updatedAt,
};

// ── toPublicUser ──────────────────────────────────────────────────────────────

describe('userService.toPublicUser', () => {
  it('should strip password and refreshToken', () => {
    const result = userService.toPublicUser(sampleUser);
    expect(result).not.toHaveProperty('password');
    expect(result).not.toHaveProperty('refreshToken');
  });

  it('should retain public fields', () => {
    const result = userService.toPublicUser(sampleUser);
    expect(result).toMatchObject(publicUser);
  });

  it('should return null for null input', () => {
    expect(userService.toPublicUser(null)).toBeNull();
  });

  it('should return null for undefined input', () => {
    expect(userService.toPublicUser(undefined)).toBeNull();
  });
});

// ── findById ──────────────────────────────────────────────────────────────────

describe('userService.findById', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should return the user document when found', async () => {
    mockDocRef.get.mockResolvedValueOnce(makeExistingSnap(sampleUser));

    const result = await userService.findById('firestore-uid-abc123');
    expect(result).toMatchObject({ id: 'firestore-uid-abc123', email: 'test@morty.co.il' });
  });

  it('should return null when document does not exist', async () => {
    mockDocRef.get.mockResolvedValueOnce(makeNotFoundSnap());

    const result = await userService.findById('nonexistent-id');
    expect(result).toBeNull();
  });

  it('should return null for falsy userId', async () => {
    const result = await userService.findById(null);
    expect(result).toBeNull();
  });

  it('should include the password field (full document)', async () => {
    mockDocRef.get.mockResolvedValueOnce(makeExistingSnap(sampleUser));

    const result = await userService.findById('firestore-uid-abc123');
    expect(result).toHaveProperty('password');
  });
});

// ── findByEmail ───────────────────────────────────────────────────────────────

describe('userService.findByEmail', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should return the user when found by email', async () => {
    const docSnap = { id: sampleUser.id, data: () => sampleUser };
    mockCollectionRef.get.mockResolvedValueOnce({ empty: false, docs: [docSnap] });

    const result = await userService.findByEmail('test@morty.co.il');
    expect(result).toMatchObject({ id: sampleUser.id, email: sampleUser.email });
  });

  it('should return null when email is not found', async () => {
    mockCollectionRef.get.mockResolvedValueOnce({ empty: true, docs: [] });

    const result = await userService.findByEmail('unknown@example.com');
    expect(result).toBeNull();
  });

  it('should return null for falsy email', async () => {
    const result = await userService.findByEmail(null);
    expect(result).toBeNull();
  });

  it('should normalise email to lowercase before querying', async () => {
    mockCollectionRef.get.mockResolvedValueOnce({ empty: true, docs: [] });

    await userService.findByEmail('TEST@MORTY.CO.IL');
    // The where() call should have been made with the lowercased email
    expect(mockCollectionRef.where).toHaveBeenCalledWith('email', '==', 'test@morty.co.il');
  });
});

// ── getUserById ───────────────────────────────────────────────────────────────

describe('userService.getUserById', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should return public user (no password/refreshToken)', async () => {
    mockDocRef.get.mockResolvedValueOnce(makeExistingSnap(sampleUser));

    const result = await userService.getUserById('firestore-uid-abc123');
    expect(result).not.toHaveProperty('password');
    expect(result).not.toHaveProperty('refreshToken');
    expect(result).toHaveProperty('id', 'firestore-uid-abc123');
  });

  it('should return null when user does not exist', async () => {
    mockDocRef.get.mockResolvedValueOnce(makeNotFoundSnap());

    const result = await userService.getUserById('nonexistent');
    expect(result).toBeNull();
  });
});

// ── createUser ────────────────────────────────────────────────────────────────

describe('userService.createUser', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should create a new user and return public user', async () => {
    // Email uniqueness check – no existing user
    mockCollectionRef.get.mockResolvedValueOnce({ empty: true, docs: [] });
    // docRef.set succeeds
    mockDocRef.set.mockResolvedValueOnce({});

    const result = await userService.createUser({
      email: 'new@morty.co.il',
      password: 'Password123!',
      phone: '0501234567',
    });

    expect(result).not.toHaveProperty('password');
    expect(result).not.toHaveProperty('refreshToken');
    expect(result).toHaveProperty('email', 'new@morty.co.il');
    expect(result).toHaveProperty('verified', false);
  });

  it('should throw 409 ConflictError when email already exists', async () => {
    // Email uniqueness check – existing user found
    const docSnap = { id: sampleUser.id, data: () => sampleUser };
    mockCollectionRef.get.mockResolvedValueOnce({ empty: false, docs: [docSnap] });

    await expect(
      userService.createUser({ email: 'test@morty.co.il', password: 'Password123!' })
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('should hash the password before storing', async () => {
    mockCollectionRef.get.mockResolvedValueOnce({ empty: true, docs: [] });
    mockDocRef.set.mockResolvedValueOnce({});

    await userService.createUser({ email: 'hash@morty.co.il', password: 'PlainPassword1' });

    // Verify that set() was called with a hashed password (not plain text)
    const setCall = mockDocRef.set.mock.calls[0][0];
    expect(setCall.password).not.toBe('PlainPassword1');
    expect(setCall.password).toMatch(/^\$2[ab]\$/); // bcrypt hash prefix
  });

  it('should normalise email to lowercase', async () => {
    mockCollectionRef.get.mockResolvedValueOnce({ empty: true, docs: [] });
    mockDocRef.set.mockResolvedValueOnce({});

    const result = await userService.createUser({
      email: 'UPPER@MORTY.CO.IL',
      password: 'Password123!',
    });

    expect(result.email).toBe('upper@morty.co.il');
  });

  it('should set createdAt and updatedAt as ISO strings', async () => {
    mockCollectionRef.get.mockResolvedValueOnce({ empty: true, docs: [] });
    mockDocRef.set.mockResolvedValueOnce({});

    const result = await userService.createUser({
      email: 'ts@morty.co.il',
      password: 'Password123!',
    });

    expect(result).toHaveProperty('createdAt');
    expect(result).toHaveProperty('updatedAt');
    expect(() => new Date(result.createdAt)).not.toThrow();
    expect(new Date(result.createdAt).toISOString()).toBe(result.createdAt);
  });
});

// ── setRefreshToken ───────────────────────────────────────────────────────────

describe('userService.setRefreshToken', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should call update with the new refresh token', async () => {
    mockDocRef.update.mockResolvedValueOnce({});

    await userService.setRefreshToken('user-123', 'new-refresh-token');

    expect(mockDocRef.update).toHaveBeenCalledWith(
      expect.objectContaining({ refreshToken: 'new-refresh-token' })
    );
  });

  it('should throw when userId is falsy', async () => {
    await expect(userService.setRefreshToken(null, 'token')).rejects.toThrow();
  });
});

// ── clearRefreshToken ─────────────────────────────────────────────────────────

describe('userService.clearRefreshToken', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should set refreshToken to null', async () => {
    mockDocRef.update.mockResolvedValueOnce({});

    await userService.clearRefreshToken('user-123');

    expect(mockDocRef.update).toHaveBeenCalledWith(
      expect.objectContaining({ refreshToken: null })
    );
  });
});

// ── clearRefreshTokenByValue ──────────────────────────────────────────────────

describe('userService.clearRefreshTokenByValue', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should find user by token and clear it', async () => {
    const docSnap = { id: sampleUser.id, data: () => ({ ...sampleUser, refreshToken: 'old-token' }) };
    mockCollectionRef.get.mockResolvedValueOnce({ empty: false, docs: [docSnap] });
    mockDocRef.update.mockResolvedValueOnce({});

    await userService.clearRefreshTokenByValue('old-token');

    expect(mockDocRef.update).toHaveBeenCalledWith(
      expect.objectContaining({ refreshToken: null })
    );
  });

  it('should do nothing when token is not found', async () => {
    mockCollectionRef.get.mockResolvedValueOnce({ empty: true, docs: [] });

    await expect(userService.clearRefreshTokenByValue('unknown-token')).resolves.toBeUndefined();
    expect(mockDocRef.update).not.toHaveBeenCalled();
  });

  it('should do nothing for falsy token', async () => {
    await expect(userService.clearRefreshTokenByValue(null)).resolves.toBeUndefined();
    expect(mockCollectionRef.get).not.toHaveBeenCalled();
  });
});

// ── verifyPassword ────────────────────────────────────────────────────────────

describe('userService.verifyPassword', () => {
  it('should return true for correct password', async () => {
    const bcrypt = require('bcryptjs');
    const hash = await bcrypt.hash('CorrectPassword1', 12);

    const result = await userService.verifyPassword('CorrectPassword1', hash);
    expect(result).toBe(true);
  });

  it('should return false for incorrect password', async () => {
    const bcrypt = require('bcryptjs');
    const hash = await bcrypt.hash('CorrectPassword1', 12);

    const result = await userService.verifyPassword('WrongPassword', hash);
    expect(result).toBe(false);
  });
});

// ── deleteUser ────────────────────────────────────────────────────────────────

describe('userService.deleteUser', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should call delete on the user document', async () => {
    mockDocRef.delete.mockResolvedValueOnce({});

    await userService.deleteUser('user-to-delete');

    expect(mockDocRef.delete).toHaveBeenCalled();
  });

  it('should throw when userId is falsy', async () => {
    await expect(userService.deleteUser(null)).rejects.toThrow();
  });
});
