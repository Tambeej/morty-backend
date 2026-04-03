/**
 * Database Configuration Tests
 *
 * Verifies that db.js correctly re-exports the Firestore db instance
 * from firestore.js (migration shim).
 */

describe('Database Configuration (Firestore shim)', () => {
  let mockDb;
  let mockAdmin;

  beforeEach(() => {
    jest.resetModules();

    mockDb = {
      settings: jest.fn(),
      collection: jest.fn().mockReturnThis(),
    };

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

    // Provide credentials so firestore.js does not throw
    process.env.FIREBASE_PROJECT_ID = 'test-project';
    process.env.FIREBASE_CLIENT_EMAIL = 'sa@test-project.iam.gserviceaccount.com';
    process.env.FIREBASE_PRIVATE_KEY = 'test-private-key';
  });

  afterEach(() => {
    jest.clearAllMocks();
    delete process.env.FIREBASE_PROJECT_ID;
    delete process.env.FIREBASE_CLIENT_EMAIL;
    delete process.env.FIREBASE_PRIVATE_KEY;
  });

  it('re-exports the Firestore db instance from firestore.js', () => {
    const db = require('../../config/db');
    expect(db).toBe(mockDb);
  });

  it('exports an object with a collection method (Firestore interface)', () => {
    const db = require('../../config/db');
    expect(typeof db.collection).toBe('function');
  });
});
