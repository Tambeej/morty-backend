/**
 * User Model
 * Defines the schema for user accounts in the Morty platform.
 * Includes email/password auth, phone verification, and refresh token storage.
 */

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const SALT_ROUNDS = 12;

/**
 * User Schema
 * @typedef {Object} User
 * @property {string} email - Unique email address (lowercase)
 * @property {string} password - Bcrypt-hashed password
 * @property {string} fullName - User's full name
 * @property {string} phone - Israeli phone number (+972 format)
 * @property {boolean} verified - Whether email/phone is verified
 * @property {string} refreshToken - Current valid refresh token (hashed)
 * @property {Date} createdAt - Account creation timestamp
 * @property {Date} updatedAt - Last update timestamp
 */
const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
        'Please provide a valid email address',
      ],
      index: true,
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [8, 'Password must be at least 8 characters'],
      select: false, // Exclude from queries by default for security
    },
    fullName: {
      type: String,
      required: [true, 'Full name is required'],
      trim: true,
      minlength: [2, 'Full name must be at least 2 characters'],
      maxlength: [100, 'Full name cannot exceed 100 characters'],
    },
    phone: {
      type: String,
      trim: true,
      match: [
        /^(\+972|0)(5[0-9]|7[0-9])[0-9]{7}$/,
        'Please provide a valid Israeli phone number',
      ],
      default: null,
    },
    verified: {
      type: Boolean,
      default: false,
    },
    refreshToken: {
      type: String,
      select: false, // Exclude from queries by default
      default: null,
    },
    passwordResetToken: {
      type: String,
      select: false,
      default: null,
    },
    passwordResetExpires: {
      type: Date,
      select: false,
      default: null,
    },
    lastLoginAt: {
      type: Date,
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true, // Adds createdAt and updatedAt automatically
    toJSON: {
      transform: function (doc, ret) {
        // Remove sensitive fields from JSON output
        delete ret.password;
        delete ret.refreshToken;
        delete ret.passwordResetToken;
        delete ret.passwordResetExpires;
        delete ret.__v;
        return ret;
      },
    },
    toObject: {
      transform: function (doc, ret) {
        delete ret.password;
        delete ret.refreshToken;
        delete ret.passwordResetToken;
        delete ret.passwordResetExpires;
        delete ret.__v;
        return ret;
      },
    },
  }
);

/**
 * Pre-save middleware: Hash password before saving
 * Only hashes if the password field has been modified.
 */
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();

  try {
    const salt = await bcrypt.genSalt(SALT_ROUNDS);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

/**
 * Instance method: Compare provided password with stored hash
 * @param {string} candidatePassword - Plain text password to verify
 * @returns {Promise<boolean>} True if passwords match
 */
userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

/**
 * Instance method: Get safe user object (without sensitive fields)
 * @returns {Object} User object without sensitive data
 */
userSchema.methods.toSafeObject = function () {
  return {
    _id: this._id,
    email: this.email,
    fullName: this.fullName,
    phone: this.phone,
    verified: this.verified,
    lastLoginAt: this.lastLoginAt,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

/**
 * Static method: Find user by email (includes password for auth)
 * @param {string} email - Email address to search
 * @returns {Promise<User>} User document with password field
 */
userSchema.statics.findByEmailWithPassword = function (email) {
  return this.findOne({ email: email.toLowerCase() }).select(
    '+password +refreshToken'
  );
};

// Indexes for performance
userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ createdAt: -1 });

const User = mongoose.model('User', userSchema);

module.exports = User;
