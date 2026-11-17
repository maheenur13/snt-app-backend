import bcrypt from 'bcryptjs';
import { User } from '../models/User.js';

/**
 * Makes sure the demo admin from DEMO_ADMIN_EMAIL / DEMO_ADMIN_PASSWORD exists, so reviewers can log in.
 * Runs on every startup: creates the account if it's missing, and restores the admin role and password
 * if someone changed them while trying the app. Returns what it did, for the startup log.
 */
export async function ensureDemoAdmin({ email, password }: { email: string; password: string }) {
  const user = await User.findOne({ email: email.trim().toLowerCase() }).select('+password');
  if (!user) {
    await User.create({ name: 'Demo Admin', email, password, role: 'admin' });
    return 'created';
  }

  const passwordMatches = await bcrypt.compare(password, user.password);
  if (user.role === 'admin' && passwordMatches) return 'unchanged';

  user.role = 'admin';
  if (!passwordMatches) user.password = password; // hashed by the pre-save hook
  await user.save();
  return 'restored';
}
