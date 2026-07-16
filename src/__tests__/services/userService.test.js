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
  firebaseUid: null,
  refreshToken: null,
  createdAt: '2026-04-03T02:16:00.000Z',
  updatedAt: '2026-04-03T02:16:00.000Z',
};

/** Sample Google-linked user document. */
const googleUser = {
  id: 'firestore-google-user-id',
  email: 'google@morty.co.il',
  password: null,
  phone: '',
  verified: true,
  firebaseUid: 'firebase-uid-google-123',
  displayName: 'Google User',
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
  firebaseUid: sampleUser.firebaseUid,
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

  it('should retain firebaseUid field', () => {
    const result = userService.toPublicUser(googleUser);
    expect(result).toHaveProperty('firebaseUid', 'firebase-uid-google-123');
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

// ── findByFirebaseUid ─────────────────────────────────────────────────────────

describe('userService.findByFirebaseUid', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should return the user when found by Firebase UID', async () => {
    const docSnap = { id: googleUser.id, data: () => googleUser };
    mockCollectionRef.get.mockResolvedValueOnce({ empty: false, docs: [docSnap] });

    const result = await userService.findByFirebaseUid('firebase-uid-google-123');
    expect(result).toMatchObject({ id: googleUser.id, firebaseUid: 'firebase-uid-google-123' });
  });

  it('should return null when Firebase UID is not found', async () => {
    mockCollectionRef.get.mockResolvedValueOnce({ empty: true, docs: [] });

    const result = await userService.findByFirebaseUid('unknown-firebase-uid');
    expect(result).toBeNull();
  });

  it('should return null for falsy firebaseUid', async () => {
    const result = await userService.findByFirebaseUid(null);
    expect(result).toBeNull();
  });

  it('should query Firestore with the correct field', async () => {
    mockCollectionRef.get.mockResolvedValueOnce({ empty: true, docs: [] });

    await userService.findByFirebaseUid('some-firebase-uid');
    expect(mockCollectionRef.where).toHaveBeenCalledWith('firebaseUid', '==', 'some-firebase-uid');
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

// ── findOrCreateByFirebaseUser ────────────────────────────────────────────────

describe('userService.findOrCreateByFirebaseUser', () => {
  beforeEach(() => jest.clearAllMocks());

  const firebaseParams = {
    email: 'google@morty.co.il',
    firebaseUid: 'firebase-uid-google-123',
    emailVerified: true,
    displayName: 'Google User',
  };

  // ── Path 1: Returning Google user (found by firebaseUid) ──────────────────

  it('should return existing user found by firebaseUid (fast path)', async () => {
    // findByFirebaseUid returns the existing Google user
    const docSnap = { id: googleUser.id, data: () => googleUser };
    mockCollectionRef.get.mockResolvedValueOnce({ empty: false, docs: [docSnap] });
    // update() for updatedAt
    mockDocRef.update.mockResolvedValueOnce({});

    const result = await userService.findOrCreateByFirebaseUser(firebaseParams);

    expect(result).toHaveProperty('id', googleUser.id);
    expect(result).toHaveProperty('email', 'google@morty.co.il');
    expect(result).toHaveProperty('firebaseUid', 'firebase-uid-google-123');
    expect(result).not.toHaveProperty('password');
    expect(result).not.toHaveProperty('refreshToken');
  });

  it('should update verified=true when emailVerified is true and user was unverified', async () => {
    const unverifiedGoogleUser = { ...googleUser, verified: false };
    const docSnap = { id: unverifiedGoogleUser.id, data: () => unverifiedGoogleUser };
    mockCollectionRef.get.mockResolvedValueOnce({ empty: false, docs: [docSnap] });
    mockDocRef.update.mockResolvedValueOnce({});

    const result = await userService.findOrCreateByFirebaseUser({
      ...firebaseParams,
      emailVerified: true,
    });

    expect(mockDocRef.update).toHaveBeenCalledWith(
      expect.objectContaining({ verified: true })
    );
    expect(result).toHaveProperty('verified', true);
  });

  it('should NOT set verified=true when emailVerified is false', async () => {
    const docSnap = { id: googleUser.id, data: () => googleUser };
    mockCollectionRef.get.mockResolvedValueOnce({ empty: false, docs: [docSnap] });
    mockDocRef.update.mockResolvedValueOnce({});

    await userService.findOrCreateByFirebaseUser({
      ...firebaseParams,
      emailVerified: false,
    });

    const updateCall = mockDocRef.update.mock.calls[0][0];
    expect(updateCall).not.toHaveProperty('verified');
  });

  // ── Path 2: Existing email/password user linking Google ───────────────────

  it('should link firebaseUid to existing email/password user', async () => {
    // findByFirebaseUid → not found
    mockCollectionRef.get.mockResolvedValueOnce({ empty: true, docs: [] });
    // findByEmail → existing email/password user (no firebaseUid)
    const emailUser = { ...sampleUser, firebaseUid: null };
    const docSnap = { id: emailUser.id, data: () => emailUser };
    mockCollectionRef.get.mockResolvedValueOnce({ empty: false, docs: [docSnap] });
    // update() for linking
    mockDocRef.update.mockResolvedValueOnce({});

    const result = await userService.findOrCreateByFirebaseUser(firebaseParams);

    expect(mockDocRef.update).toHaveBeenCalledWith(
      expect.objectContaining({ firebaseUid: 'firebase-uid-google-123' })
    );
    expect(result).toHaveProperty('id', sampleUser.id);
    expect(result).toHaveProperty('firebaseUid', 'firebase-uid-google-123');
    expect(result).not.toHaveProperty('password');
  });

  it('should set verified=true when linking and emailVerified is true', async () => {
    // findByFirebaseUid → not found
    mockCollectionRef.get.mockResolvedValueOnce({ empty: true, docs: [] });
    // findByEmail → existing user
    const emailUser = { ...sampleUser, firebaseUid: null, verified: false };
    const docSnap = { id: emailUser.id, data: () => emailUser };
    mockCollectionRef.get.mockResolvedValueOnce({ empty: false, docs: [docSnap] });
    mockDocRef.update.mockResolvedValueOnce({});

    await userService.findOrCreateByFirebaseUser({ ...firebaseParams, emailVerified: true });

    expect(mockDocRef.update).toHaveBeenCalledWith(
      expect.objectContaining({ firebaseUid: 'firebase-uid-google-123', verified: true })
    );
  });

  it('should throw 409 when email is already linked to a DIFFERENT Firebase UID', async () => {
    // findByFirebaseUid → not found (different UID)
    mockCollectionRef.get.mockResolvedValueOnce({ empty: true, docs: [] });
    // findByEmail → user with a different firebaseUid
    const conflictUser = { ...sampleUser, firebaseUid: 'different-firebase-uid' };
    const docSnap = { id: conflictUser.id, data: () => conflictUser };
    mockCollectionRef.get.mockResolvedValueOnce({ empty: false, docs: [docSnap] });

    await expect(
      userService.findOrCreateByFirebaseUser(firebaseParams)
    ).rejects.toMatchObject({ statusCode: 409, errorCode: 'CONFLICT_ERROR' });
  });

  // ── Path 3: Brand-new Google user ────────────────────────────────────────

  it('should create a new passwordless user for a brand-new Google account', async () => {
    // findByFirebaseUid → not found
    mockCollectionRef.get.mockResolvedValueOnce({ empty: true, docs: [] });
    // findByEmail → not found
    mockCollectionRef.get.mockResolvedValueOnce({ empty: true, docs: [] });
    // docRef.set succeeds
    mockDocRef.set.mockResolvedValueOnce({});

    const result = await userService.findOrCreateByFirebaseUser(firebaseParams);

    expect(mockDocRef.set).toHaveBeenCalledTimes(1);
    const setCall = mockDocRef.set.mock.calls[0][0];
    expect(setCall).not.toHaveProperty('password');
    expect(setCall.firebaseUid).toBe('firebase-uid-google-123');
    expect(setCall.email).toBe('google@morty.co.il');
    expect(setCall.verified).toBe(true);

    expect(result).not.toHaveProperty('password');
    expect(result).not.toHaveProperty('refreshToken');
    expect(result).toHaveProperty('firebaseUid', 'firebase-uid-google-123');
    expect(result).toHaveProperty('verified', true);
  });

  it('should normalise email to lowercase when creating new Google user', async () => {
    mockCollectionRef.get.mockResolvedValueOnce({ empty: true, docs: [] });
    mockCollectionRef.get.mockResolvedValueOnce({ empty: true, docs: [] });
    mockDocRef.set.mockResolvedValueOnce({});

    const result = await userService.findOrCreateByFirebaseUser({
      ...firebaseParams,
      email: 'GOOGLE@MORTY.CO.IL',
    });

    expect(result.email).toBe('google@morty.co.il');
    const setCall = mockDocRef.set.mock.calls[0][0];
    expect(setCall.email).toBe('google@morty.co.il');
  });

  it('should set displayName from Google profile when creating new user', async () => {
    mockCollectionRef.get.mockResolvedValueOnce({ empty: true, docs: [] });
    mockCollectionRef.get.mockResolvedValueOnce({ empty: true, docs: [] });
    mockDocRef.set.mockResolvedValueOnce({});

    await userService.findOrCreateByFirebaseUser({
      ...firebaseParams,
      displayName: 'John Doe',
    });

    const setCall = mockDocRef.set.mock.calls[0][0];
    expect(setCall.displayName).toBe('John Doe');
  });

  it('should set verified=false when emailVerified is false for new user', async () => {
    mockCollectionRef.get.mockResolvedValueOnce({ empty: true, docs: [] });
    mockCollectionRef.get.mockResolvedValueOnce({ empty: true, docs: [] });
    mockDocRef.set.mockResolvedValueOnce({});

    const result = await userService.findOrCreateByFirebaseUser({
      ...firebaseParams,
      emailVerified: false,
    });

    expect(result).toHaveProperty('verified', false);
    const setCall = mockDocRef.set.mock.calls[0][0];
    expect(setCall.verified).toBe(false);
  });

  // ── Input validation ──────────────────────────────────────────────────────

  it('should throw 422 when email is missing', async () => {
    await expect(
      userService.findOrCreateByFirebaseUser({ email: '', firebaseUid: 'uid-123' })
    ).rejects.toMatchObject({ statusCode: 422 });
  });

  it('should throw 422 when firebaseUid is missing', async () => {
    await expect(
      userService.findOrCreateByFirebaseUser({ email: 'test@morty.co.il', firebaseUid: '' })
    ).rejects.toMatchObject({ statusCode: 422 });
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
