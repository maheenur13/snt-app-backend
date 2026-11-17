import { Schema, model } from 'mongoose';

// One document per issued refresh token. Only a SHA-256 hash is stored, so a database leak
// doesn't hand out working tokens. Used tokens are kept until they expire to detect reuse.
const refreshTokenSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    tokenHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// Every refresh and logout looks the token up by its hash. Unique also guards against collisions.
refreshTokenSchema.index({ tokenHash: 1 }, { unique: true });

// Revoking all of a user's sessions (token reuse, password change, user deleted): deleteMany({ user }).
refreshTokenSchema.index({ user: 1 });

// TTL index: MongoDB deletes each token once expiresAt has passed, so the collection doesn't grow forever.
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const RefreshToken = model('RefreshToken', refreshTokenSchema);
