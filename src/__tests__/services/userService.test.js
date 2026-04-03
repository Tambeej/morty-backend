/**
 * Unit tests for src/services/userService.js
 *
 * Firestore is mocked via jest.mock so no real Firebase connection is needed.
 */

'use strict';

// ── Firestore mock setup ──────────────────────────────────────────────────────

const mockDocGet = jest.fn();
const mockDocSet = jest.fn();
const mockDocUpdate = jest.fn();
const mockDocDelete = jest.fn();
const mockDocRef = jest.fn(() => ({
  id: 'generated-doc-id',
  get: mockDocGet,
  set: mockDocSet,
  update: mockDocUpdate,
  delete: mockDocDelete,
}));

const mockQueryGet = jest.fn();
const mockLimit = jest.fn(() => ({ get: mockQueryGet }));
const mockWhere = jest.fn(() => ({ where: mockWhere, limit: mockLimit, get: mockQueryGet }));

const mockCollection = jest.fn(() => ({
  doc: mockDocRef,
  where: mockWhere,
}));

// Mock the Firestore config module
jest.mock('../../src/config/firestore', () => {
  const mock = { collection: mockCollection };
  mock.settings = jest.fn();
  return mock;
});

// Mock bcryptjs
jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('hashed_password'),
  compare: jest.fn().mockResolvedValue(true),
}));

// Mock logger to suppress output during tests
jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

// ── Import service AFTER mocks are set up ─────────────────────────────────────

const userService = require('../../src/services/userService');
const bcrypt = require('bcryptjs');

// ── Helpers ───────────────────────────────────────────────────────────────────

const makeUserDoc = (overrides = {}) => ({
  id: 'user-123',
  email: 'test@example.com',
  password: 'hashed_password',
  phone: '050-1234567',
  verified: false,
  refreshToken: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const makeSnap = (exists, data = {}) => ({
  exists,
  id: data.id || 'user-123',
  data: () => data,
});

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  // Reset mockDocRef to return a fresh object each time
  mockDocRef.mockReturnValue({
    id: 'generated-doc-id',
    get: mockDocGet,
    set: mockDocSet,
    update: mockDocUpdate,
    delete: mockDocDelete,
  });
});

// ── toPublicUser ──────────────────────────────────────────────────────────────

describe('toPublicUser', () => {
  it('strips password and refreshToken', () => {
    const doc = makeUserDoc({ refreshToken: 'some-token' });
    const pub = userService.toPublicUser(doc);
    expect(pub).not.toHaveProperty('password');
    expect(pub).not.toHaveProperty('refreshToken');
    expect(pub.email).toBe('test@example.com');
    expect(pub.id).toBe('user-123');
  });

  it('returns null for null input', () => {
    expect(userService.toPublicUser(null)).toBeNull();
  });
});

// ── findById ──────────────────────────────────────────────────────────────────

describe('findById', () => {
  it('returns user document when found', async () => {
    const userData = makeUserDoc();
    mockDocGet.mockResolvedValueOnce(makeSnap(true, userData));

    const result = await userService.findById('user-123');
    expect(result).toMatchObject({ id: 'user-123', email: 'test@example.com' });
    expect(mockCollection).toHaveBeenCalledWith('users');
  });

  it('returns null when document does not exist', async () => {
    mockDocGet.mockResolvedValueOnce(makeSnap(false));
    const result = await userService.findById('nonexistent');
    expect(result).toBeNull();
  });

  it('returns null for falsy userId', async () => {
    const result = await userService.findById(null);
    expect(result).toBeNull();
  });
});

// ── findByEmail ───────────────────────────────────────────────────────────────

describe('findByEmail', () => {
  it('returns user when email matches', async () => {
    const userData = makeUserDoc();
    const docSnap = { id: 'user-123', data: () => userData };
    mockQueryGet.mockResolvedValueOnce({ empty: false, docs: [docSnap] });

    const result = await userService.findByEmail('TEST@EXAMPLE.COM');
    expect(result).toMatchObject({ id: 'user-123', email: 'test@example.com' });
    // Verify email was normalised to lowercase
    expect(mockWhere).toHaveBeenCalledWith('email', '==', 'test@example.com');
  });

  it('returns null when no user found', async () => {
    mockQueryGet.mockResolvedValueOnce({ empty: true, docs: [] });
    const result = await userService.findByEmail('nobody@example.com');
    expect(result).toBeNull();
  });

  it('returns null for falsy email', async () => {
    const result = await userService.findByEmail('');
    expect(result).toBeNull();
  });
});

// ── findByRefreshToken ────────────────────────────────────────────────────────

describe('findByRefreshToken', () => {
  it('returns user when refresh token matches', async () => {
    const userData = makeUserDoc({ refreshToken: 'valid-refresh-token' });
    const docSnap = { id: 'user-123', data: () => userData };
    mockQueryGet.mockResolvedValueOnce({ empty: false, docs: [docSnap] });

    const result = await userService.findByRefreshToken('valid-refresh-token');
    expect(result).toMatchObject({ id: 'user-123' });
  });

  it('returns null when token not found', async () => {
    mockQueryGet.mockResolvedValueOnce({ empty: true, docs: [] });
    const result = await userService.findByRefreshToken('bad-token');
    expect(result).toBeNull();
  });

  it('returns null for falsy token', async () => {
    const result = await userService.findByRefreshToken(null);
    expect(result).toBeNull();
  });
});

// ── createUser ────────────────────────────────────────────────────────────────

describe('createUser', () => {
  it('creates a new user and returns public shape', async () => {
    // No existing user
    mockQueryGet.mockResolvedValueOnce({ empty: true, docs: [] });
    mockDocSet.mockResolvedValueOnce();

    const result = await userService.createUser({
      email: 'new@example.com',
      password: 'plaintext',
      phone: '050-9999999',
    });

    expect(bcrypt.hash).toHaveBeenCalledWith('plaintext', 12);
    expect(mockDocSet).toHaveBeenCalled();
    expect(result).not.toHaveProperty('password');
    expect(result).not.toHaveProperty('refreshToken');
    expect(result.email).toBe('new@example.com');
    expect(result.verified).toBe(false);
  });

  it('normalises email to lowercase', async () => {
    mockQueryGet.mockResolvedValueOnce({ empty: true, docs: [] });
    mockDocSet.mockResolvedValueOnce();

    const result = await userService.createUser({
      email: 'UPPER@EXAMPLE.COM',
      password: 'pass',
    });

    expect(result.email).toBe('upper@example.com');
  });

  it('throws 409 ConflictError when email already exists', async () => {
    const existingUser = makeUserDoc();
    const docSnap = { id: 'user-123', data: () => existingUser };
    mockQueryGet.mockResolvedValueOnce({ empty: false, docs: [docSnap] });

    await expect(
      userService.createUser({ email: 'test@example.com', password: 'pass' })
    ).rejects.toMatchObject({ statusCode: 409, errorCode: 'CONFLICT_ERROR' });
  });

  it('defaults phone to empty string when not provided', async () => {
    mockQueryGet.mockResolvedValueOnce({ empty: true, docs: [] });
    mockDocSet.mockResolvedValueOnce();

    const result = await userService.createUser({
      email: 'nophone@example.com',
      password: 'pass',
    });

    expect(result.phone).toBe('');
  });
});

// ── updateUser ────────────────────────────────────────────────────────────────

describe('updateUser', () => {
  it('updates user fields and returns public shape', async () => {
    const updatedData = makeUserDoc({ phone: '050-0000001' });
    mockDocUpdate.mockResolvedValueOnce();
    mockDocGet.mockResolvedValueOnce(makeSnap(true, updatedData));

    const result = await userService.updateUser('user-123', { phone: '050-0000001' });
    expect(mockDocUpdate).toHaveBeenCalled();
    expect(result.phone).toBe('050-0000001');
    expect(result).not.toHaveProperty('password');
  });

  it('throws when userId is falsy', async () => {
    await expect(userService.updateUser(null, { phone: '050' })).rejects.toThrow(
      'userId is required'
    );
  });

  it('does not allow overwriting the id field', async () => {
    const userData = makeUserDoc();
    mockDocUpdate.mockResolvedValueOnce();
    mockDocGet.mockResolvedValueOnce(makeSnap(true, userData));

    await userService.updateUser('user-123', { id: 'hacked-id', phone: '050' });

    const updateCall = mockDocUpdate.mock.calls[0][0];
    expect(updateCall).not.toHaveProperty('id');
  });
});

// ── setRefreshToken ───────────────────────────────────────────────────────────

describe('setRefreshToken', () => {
  it('stores the refresh token', async () => {
    mockDocUpdate.mockResolvedValueOnce();
    await userService.setRefreshToken('user-123', 'new-refresh-token');
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ refreshToken: 'new-refresh-token' })
    );
  });

  it('stores null when token is null', async () => {
    mockDocUpdate.mockResolvedValueOnce();
    await userService.setRefreshToken('user-123', null);
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ refreshToken: null })
    );
  });

  it('throws when userId is falsy', async () => {
    await expect(userService.setRefreshToken(null, 'token')).rejects.toThrow(
      'userId is required'
    );
  });
});

// ── clearRefreshToken ─────────────────────────────────────────────────────────

describe('clearRefreshToken', () => {
  it('sets refreshToken to null', async () => {
    mockDocUpdate.mockResolvedValueOnce();
    await userService.clearRefreshToken('user-123');
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ refreshToken: null })
    );
  });
});

// ── clearRefreshTokenByValue ──────────────────────────────────────────────────

describe('clearRefreshTokenByValue', () => {
  it('finds user by token and clears it', async () => {
    const userData = makeUserDoc({ refreshToken: 'old-token' });
    const docSnap = { id: 'user-123', data: () => userData };
    mockQueryGet.mockResolvedValueOnce({ empty: false, docs: [docSnap] });
    mockDocUpdate.mockResolvedValueOnce();

    await userService.clearRefreshTokenByValue('old-token');
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ refreshToken: null })
    );
  });

  it('does nothing when token is falsy', async () => {
    await userService.clearRefreshTokenByValue(null);
    expect(mockQueryGet).not.toHaveBeenCalled();
  });

  it('does nothing when token is not found', async () => {
    mockQueryGet.mockResolvedValueOnce({ empty: true, docs: [] });
    await userService.clearRefreshTokenByValue('unknown-token');
    expect(mockDocUpdate).not.toHaveBeenCalled();
  });
});

// ── verifyPassword ────────────────────────────────────────────────────────────

describe('verifyPassword', () => {
  it('returns true for matching password', async () => {
    bcrypt.compare.mockResolvedValueOnce(true);
    const result = await userService.verifyPassword('plain', 'hashed');
    expect(result).toBe(true);
    expect(bcrypt.compare).toHaveBeenCalledWith('plain', 'hashed');
  });

  it('returns false for non-matching password', async () => {
    bcrypt.compare.mockResolvedValueOnce(false);
    const result = await userService.verifyPassword('wrong', 'hashed');
    expect(result).toBe(false);
  });
});

// ── updatePassword ────────────────────────────────────────────────────────────

describe('updatePassword', () => {
  it('hashes and stores the new password', async () => {
    mockDocUpdate.mockResolvedValueOnce();
    await userService.updatePassword('user-123', 'newPlainPassword');
    expect(bcrypt.hash).toHaveBeenCalledWith('newPlainPassword', 12);
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ password: 'hashed_password' })
    );
  });

  it('throws when userId is falsy', async () => {
    await expect(userService.updatePassword(null, 'pass')).rejects.toThrow(
      'userId is required'
    );
  });
});

// ── verifyUser ────────────────────────────────────────────────────────────────

describe('verifyUser', () => {
  it('sets verified to true', async () => {
    const verifiedData = makeUserDoc({ verified: true });
    mockDocUpdate.mockResolvedValueOnce();
    mockDocGet.mockResolvedValueOnce(makeSnap(true, verifiedData));

    const result = await userService.verifyUser('user-123');
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ verified: true })
    );
    expect(result.verified).toBe(true);
  });
});

// ── deleteUser ────────────────────────────────────────────────────────────────

describe('deleteUser', () => {
  it('deletes the user document', async () => {
    mockDocDelete.mockResolvedValueOnce();
    await userService.deleteUser('user-123');
    expect(mockDocDelete).toHaveBeenCalled();
  });

  it('throws when userId is falsy', async () => {
    await expect(userService.deleteUser(null)).rejects.toThrow('userId is required');
  });
});

// ── getUserById ───────────────────────────────────────────────────────────────

describe('getUserById', () => {
  it('returns public user shape', async () => {
    const userData = makeUserDoc();
    mockDocGet.mockResolvedValueOnce(makeSnap(true, userData));

    const result = await userService.getUserById('user-123');
    expect(result).not.toHaveProperty('password');
    expect(result).not.toHaveProperty('refreshToken');
    expect(result.id).toBe('user-123');
  });

  it('returns null when user not found', async () => {
    mockDocGet.mockResolvedValueOnce(makeSnap(false));
    const result = await userService.getUserById('nonexistent');
    expect(result).toBeNull();
  });
});
