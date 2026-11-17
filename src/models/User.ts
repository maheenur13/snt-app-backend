import bcrypt from 'bcryptjs';
import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

export const ROLES = ['user', 'admin'] as const;
export type Role = (typeof ROLES)[number];

const SALT_ROUNDS = 12;

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
    password: { type: String, required: true, minlength: 8, select: false },
    role: { type: String, enum: ROLES, default: 'user', required: true },
    interests: { type: [String], default: [] },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret: Record<string, unknown>) {
        delete ret.password;
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
  }
});

export type User = InferSchemaType<typeof userSchema>;
export type UserDocument = HydratedDocument<User>;
export const User = model('User', userSchema);
