/**
 * Firestore Configuration Tests
 *
 * Verifies that the Firestore module correctly initialises the
 * Firebase Admin SDK and returns a usable db instance.
 *
 * All firebase-admin calls are mocked so no real GCP credentials
 * are required during testing.
 */

describe('Firestore Configuration', () => {
  let mockFirestore;
  let mockAdmin;
  let mockDb;

  beforeEach(() => {
    jest.resetModules();

    // Mock Firestore db instance
    mockDb = {
      settings: jest.fn(),
      collection: jest.fn().mockReturnThis(),
    };

    // Mock firebase-admin module
    mockAdmin = {
      apps: [],
      credential: {
        applicationDefault: jest.fn().mockReturnValue({ type: 'applicationDefault' }),
        cert: jest.fn().mockReturnValue({ type: 'cert' }),
      },
      initializeApp: jest.fn(),
      firestore: jest.fn().mockReturnValue(mockDb),
    };

    jest.mock('firebase-admin', () => mockAdmin);
  });

  afterEach(() => {
    jest.clearAllMocks();
    // Clean up env vars set during tests
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    delete process.env.FIREBASE_PROJECT_ID;
    delete process.env.FIREBASE_CLIENT_EMAIL;
    delete process.env.FIREBASE_PRIVATE_KEY;
  });

  describe('buildCredential – GOOGLE_APPLICATION_CREDENTIALS strategy', () => {
    it('uses applicationDefault() when GOOGLE_APPLICATION_CREDENTIALS is set', () => {
      process.env.GOOGLE_APPLICATION_CREDENTIALS = '/path/to/key.json';

      const db = require('../../config/firestore');

      expect(mockAdmin.credential.applicationDefault).toHaveBeenCalledTimes(1);
      expect(mockAdmin.credential.cert).not.toHaveBeenCalled();
      expect(db).toBe(mockDb);
    });
  });

  describe('buildCredential – individual env vars strategy', () => {
    it('uses cert() when FIREBASE_PROJECT_ID, CLIENT_EMAIL and PRIVATE_KEY are set', () => {
      process.env.FIREBASE_PROJECT_ID = 'test-project';
      process.env.FIREBASE_CLIENT_EMAIL = 'sa@test-project.iam.gserviceaccount.com';
      process.env.FIREBASE_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\nABC\n-----END PRIVATE KEY-----\n';

      const db = require('../../config/firestore');

      expect(mockAdmin.credential.cert).toHaveBeenCalledTimes(1);
      expect(mockAdmin.credential.cert).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 'test-project',
          clientEmail: 'sa@test-project.iam.gserviceaccount.com',
        })
      );
      expect(db).toBe(mockDb);
    });

    it('replaces literal \\n sequences in FIREBASE_PRIVATE_KEY', () => {
      process.env.FIREBASE_PROJECT_ID = 'test-project';
      process.env.FIREBASE_CLIENT_EMAIL = 'sa@test-project.iam.gserviceaccount.com';
      // Simulate how Render stores multi-line secrets
      process.env.FIREBASE_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\\nABC\\n-----END PRIVATE KEY-----\\n';

      require('../../config/firestore');

      const certArg = mockAdmin.credential.cert.mock.calls[0][0];
      expect(certArg.privateKey).toContain('\n');
      expect(certArg.privateKey).not.toContain('\\n');
    });
  });

  describe('credential error handling', () => {
    it('throws when no credentials are configured', () => {
      // Ensure no credential env vars are set
      delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
      delete process.env.FIREBASE_PROJECT_ID;
      delete process.env.FIREBASE_CLIENT_EMAIL;
      delete process.env.FIREBASE_PRIVATE_KEY;

      expect(() => require('../../config/firestore')).toThrow(
        /Firestore credentials not configured/
      );
    });

    it('throws when only FIREBASE_PROJECT_ID is set (incomplete config)', () => {
      process.env.FIREBASE_PROJECT_ID = 'test-project';
      // CLIENT_EMAIL and PRIVATE_KEY intentionally missing

      expect(() => require('../../config/firestore')).toThrow(
        /Firestore credentials not configured/
      );
    });
  });

  describe('singleton behaviour', () => {
    it('does not call initializeApp again when apps array is non-empty', () => {
      process.env.FIREBASE_PROJECT_ID = 'test-project';
      process.env.FIREBASE_CLIENT_EMAIL = 'sa@test-project.iam.gserviceaccount.com';
      process.env.FIREBASE_PRIVATE_KEY = 'key';

      // Simulate an already-initialised app
      mockAdmin.apps = [{ name: '[DEFAULT]' }];

      require('../../config/firestore');

      expect(mockAdmin.initializeApp).not.toHaveBeenCalled();
    });
  });

  describe('db settings', () => {
    it('calls db.settings with ignoreUndefinedProperties', () => {
      process.env.FIREBASE_PROJECT_ID = 'test-project';
      process.env.FIREBASE_CLIENT_EMAIL = 'sa@test-project.iam.gserviceaccount.com';
      process.env.FIREBASE_PRIVATE_KEY = 'key';

      require('../../config/firestore');

      expect(mockDb.settings).toHaveBeenCalledWith(
        expect.objectContaining({ ignoreUndefinedProperties: true })
      );
    });
  });

  describe('module exports', () => {
    it('exports the db instance as default export', () => {
      process.env.FIREBASE_PROJECT_ID = 'test-project';
      process.env.FIREBASE_CLIENT_EMAIL = 'sa@test-project.iam.gserviceaccount.com';
      process.env.FIREBASE_PRIVATE_KEY = 'key';

      const db = require('../../config/firestore');
      expect(db).toBe(mockDb);
    });

    it('exports admin as a named export', () => {
      process.env.FIREBASE_PROJECT_ID = 'test-project';
      process.env.FIREBASE_CLIENT_EMAIL = 'sa@test-project.iam.gserviceaccount.com';
      process.env.FIREBASE_PRIVATE_KEY = 'key';

      const { admin } = require('../../config/firestore');
      expect(admin).toBe(mockAdmin);
    });

    it('exports initFirestore as a named export', () => {
      process.env.FIREBASE_PROJECT_ID = 'test-project';
      process.env.FIREBASE_CLIENT_EMAIL = 'sa@test-project.iam.gserviceaccount.com';
      process.env.FIREBASE_PRIVATE_KEY = 'key';

      const { initFirestore } = require('../../config/firestore');
      expect(typeof initFirestore).toBe('function');
    });
  });
});
