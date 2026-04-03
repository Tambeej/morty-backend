/**
 * Firebase Admin SDK Configuration Tests
 *
 * Tests the firebase.js config module in isolation using mocks so that
 * real GCP credentials are not required in CI.
 */

'use strict';

// ── Mocks ─────────────────────────────────────────────────────────────────────

// Mock firebase-admin before any require() of the config module
jest.mock('firebase-admin', () => {
  const mockDb = {
    settings: jest.fn(),
    collection: jest.fn(),
  };

  const mockApp = { name: '[DEFAULT]' };

  const mockAdmin = {
    apps: [],
    credential: {
      applicationDefault: jest.fn(() => ({ type: 'applicationDefault' })),
      cert: jest.fn((cfg) => ({ type: 'cert', ...cfg })),
    },
    initializeApp: jest.fn((config) => {
      mockAdmin.apps.push(mockApp);
      return mockApp;
    }),
    firestore: jest.fn(() => mockDb),
  };

  return mockAdmin;
});

// Mock logger to suppress output during tests
jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

const admin = require('firebase-admin');

function resetAdminMock() {
  admin.apps.length = 0; // clear apps array
  admin.initializeApp.mockClear();
  admin.credential.applicationDefault.mockClear();
  admin.credential.cert.mockClear();
  admin.firestore.mockClear();
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Firebase Admin SDK configuration (src/config/firebase.js)', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
    resetAdminMock();
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  // ── Option A: GOOGLE_APPLICATION_CREDENTIALS ────────────────────────────────

  describe('Option A – GOOGLE_APPLICATION_CREDENTIALS', () => {
    beforeEach(() => {
      process.env.GOOGLE_APPLICATION_CREDENTIALS = '/path/to/serviceAccountKey.json';
      delete process.env.FIREBASE_PROJECT_ID;
      delete process.env.FIREBASE_CLIENT_EMAIL;
      delete process.env.FIREBASE_PRIVATE_KEY;
    });

    it('should call applicationDefault() when GOOGLE_APPLICATION_CREDENTIALS is set', () => {
      require('../../config/firebase');
      expect(admin.credential.applicationDefault).toHaveBeenCalledTimes(1);
      expect(admin.credential.cert).not.toHaveBeenCalled();
    });

    it('should initialise the firebase-admin app exactly once', () => {
      require('../../config/firebase');
      expect(admin.initializeApp).toHaveBeenCalledTimes(1);
    });

    it('should export admin, firebaseApp, and db', () => {
      const firebase = require('../../config/firebase');
      expect(firebase).toHaveProperty('admin');
      expect(firebase).toHaveProperty('firebaseApp');
      expect(firebase).toHaveProperty('db');
    });
  });

  // ── Option B: individual env vars ──────────────────────────────────────────

  describe('Option B – individual credential env vars', () => {
    beforeEach(() => {
      delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
      process.env.FIREBASE_PROJECT_ID = 'test-project-id';
      process.env.FIREBASE_CLIENT_EMAIL = 'test@test-project.iam.gserviceaccount.com';
      process.env.FIREBASE_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\\nMIIE...\\n-----END PRIVATE KEY-----\\n';
    });

    it('should call credential.cert() with the correct fields', () => {
      require('../../config/firebase');
      expect(admin.credential.cert).toHaveBeenCalledTimes(1);
      const certArg = admin.credential.cert.mock.calls[0][0];
      expect(certArg.projectId).toBe('test-project-id');
      expect(certArg.clientEmail).toBe('test@test-project.iam.gserviceaccount.com');
      // Literal \n should be replaced with real newlines
      expect(certArg.privateKey).toContain('\n');
    });

    it('should include projectId in initializeApp config', () => {
      require('../../config/firebase');
      const initArg = admin.initializeApp.mock.calls[0][0];
      expect(initArg.projectId).toBe('test-project-id');
    });

    it('should export a db object with a settings method', () => {
      const { db } = require('../../config/firebase');
      expect(typeof db.settings).toBe('function');
    });
  });

  // ── Missing credentials ─────────────────────────────────────────────────────

  describe('Missing credentials', () => {
    beforeEach(() => {
      delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
      delete process.env.FIREBASE_PROJECT_ID;
      delete process.env.FIREBASE_CLIENT_EMAIL;
      delete process.env.FIREBASE_PRIVATE_KEY;
    });

    it('should throw an error when no credentials are provided', () => {
      expect(() => require('../../config/firebase')).toThrow(
        /Firebase Admin SDK: missing credentials/
      );
    });
  });

  // ── Singleton guard ─────────────────────────────────────────────────────────

  describe('Singleton guard', () => {
    beforeEach(() => {
      process.env.GOOGLE_APPLICATION_CREDENTIALS = '/path/to/key.json';
    });

    it('should not call initializeApp again when apps array is already populated', () => {
      // Simulate an already-initialised app
      admin.apps.push({ name: '[DEFAULT]' });

      require('../../config/firebase');
      expect(admin.initializeApp).not.toHaveBeenCalled();
    });
  });
});
