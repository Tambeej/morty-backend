/**
 * `protect` middleware tests.
 *
 * The middleware verifies Firebase ID tokens via `getAuth().verifyIdToken()`
 * and looks up the Firestore user doc by firebaseUid. Both dependencies are
 * mocked here so no live Firebase or Firestore is contacted.
 */

'use strict';

process.env.NODE_ENV = 'test';

// ── Mock firebase config ──────────────────────────────────────────────────────
// The middleware calls getAuth().verifyIdToken(token) — provide a controllable
// mock so tests can decide whether verification succeeds or throws.

const verifyIdTokenMock = jest.fn();

jest.mock('../../config/firebase', () => ({
  getAuth: () => ({ verifyIdToken: verifyIdTokenMock }),
}));

// ── Mock userService.findByFirebaseUid ────────────────────────────────────────
const findByFirebaseUidMock = jest.fn();

jest.mock('../../services/userService', () => ({
  findByFirebaseUid: findByFirebaseUidMock,
}));

const request = require('supertest');
const express = require('express');
const { protect } = require('../../middleware/auth');
const { globalErrorHandler } = require('../../middleware/errorHandler');

const createApp = () => {
  const app = express();
  app.use(express.json());
  app.get('/protected', protect, (req, res) => {
    res.json({ success: true, userId: req.user.id, uid: req.user.uid });
  });
  app.use(globalErrorHandler);
  return app;
};

beforeEach(() => {
  verifyIdTokenMock.mockReset();
  findByFirebaseUidMock.mockReset();
});

describe('protect middleware', () => {
  it('rejects requests without an Authorization header (401)', async () => {
    const app = createApp();
    const res = await request(app).get('/protected');
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('rejects requests with a non-Bearer Authorization header (401)', async () => {
    const app = createApp();
    const res = await request(app)
      .get('/protected')
      .set('Authorization', 'Token abc123');
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('rejects requests when Firebase Admin rejects the token (401)', async () => {
    verifyIdTokenMock.mockRejectedValue(new Error('token expired'));

    const app = createApp();
    const res = await request(app)
      .get('/protected')
      .set('Authorization', 'Bearer some.jwt.value');

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(verifyIdTokenMock).toHaveBeenCalledWith('some.jwt.value');
  });

  it('rejects when the Firestore user document does not exist (401)', async () => {
    verifyIdTokenMock.mockResolvedValue({
      uid: 'firebase-uid-123',
      email: 'user@example.com',
    });
    findByFirebaseUidMock.mockResolvedValue(null);

    const app = createApp();
    const res = await request(app)
      .get('/protected')
      .set('Authorization', 'Bearer valid.jwt.value');

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('allows valid tokens and attaches req.user (200)', async () => {
    verifyIdTokenMock.mockResolvedValue({
      uid: 'firebase-uid-123',
      email: 'user@example.com',
    });
    findByFirebaseUidMock.mockResolvedValue({
      id: 'firestore-doc-abc',
      email: 'user@example.com',
      phone: '',
      verified: true,
      firebaseUid: 'firebase-uid-123',
    });

    const app = createApp();
    const res = await request(app)
      .get('/protected')
      .set('Authorization', 'Bearer valid.jwt.value');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.userId).toBe('firestore-doc-abc');
    expect(res.body.uid).toBe('firebase-uid-123');
  });
});
