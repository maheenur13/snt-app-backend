import bcrypt from 'bcryptjs';
import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';
import { LIMITS, passwordFitsBcrypt } from './limits.js';

export const ROLES = ['user', 'admin'] as const;
export type Role = (typeof ROLES)[number];

const SALT_ROUNDS = 12;

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: LIMITS.name },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: LIMITS.email,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Email is not valid'],
    },
    password: {
      type: String,
      required: true,
      minlength: LIMITS.passwordMin,
      select: false,
      validate: { validator: passwordFitsBcrypt, message: `Password must be at most ${LIMITS.passwordMaxBytes} bytes` },
    },
    // tokens issued before this moment are rejected (see authenticate)
    passwordChangedAt: { type: Date, select: false },
    role: { type: String, enum: ROLES, default: 'user', required: true },
    interests: {
      type: [{ type: String, maxlength: LIMITS.interest }],
      default: [],
      validate: {
        validator: (v: string[]) => v.length <= LIMITS.interests,
        message: `At most ${LIMITS.interests} interests`,
      },
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret: Record<string, unknown>) {
        delete ret.password;
        delete ret.passwordChangedAt;
        delete ret.__v;
        return ret;
      },
    },
  },
);

// Login and registration look users up by email. Unique also stops duplicate accounts.
userSchema.index({ email: 1 }, { unique: true });

// Multikey index for the $match stage of the "users grouped by interest" aggregation.
userSchema.index({ interests: 1 });

// Admin user list (sorted by _id) and profile reads (by _id) use the default _id index.

userSchema.pre('save', async function () {
  if (this.isModified('password')) {
    this.password = await bcrypt.hash(this.password, SALT_ROUNDS);
    if (!this.isNew) this.passwordChangedAt = new Date();
  }
});

export type User = InferSchemaType<typeof userSchema>;
export type UserDocument = HydratedDocument<User>;
export const User = model('User', userSchema);
