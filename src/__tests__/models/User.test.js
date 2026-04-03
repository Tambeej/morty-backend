/**
 * User Schema Definition Tests
 *
 * Verifies the plain-JS UserSchema descriptor that replaced the Mongoose
 * model during the Firestore migration.
 */

const UserSchema = require('../../models/User');

describe('UserSchema (Firestore shape descriptor)', () => {
  it('should export a schema object', () => {
    expect(UserSchema).toBeDefined();
    expect(typeof UserSchema).toBe('object');
  });

  it('should target the correct Firestore collection', () => {
    expect(UserSchema.collection).toBe('users');
  });

  it('should define required fields', () => {
    const { fields } = UserSchema;
    expect(fields.id.required).toBe(true);
    expect(fields.email.required).toBe(true);
    expect(fields.password.required).toBe(true);
  });

  it('should define optional fields with defaults', () => {
    const { fields } = UserSchema;
    expect(fields.phone.default).toBe('');
    expect(fields.verified.default).toBe(false);
    expect(fields.refreshToken.default).toBeNull();
  });

  it('should mark email as unique', () => {
    expect(UserSchema.fields.email.unique).toBe(true);
  });

  it('should use string type for id and email', () => {
    expect(UserSchema.fields.id.type).toBe('string');
    expect(UserSchema.fields.email.type).toBe('string');
  });

  it('should use boolean type for verified', () => {
    expect(UserSchema.fields.verified.type).toBe('boolean');
  });
});
