// Usage: pnpm create-admin <email> <password> [name]
// Creates an admin, or promotes the user if the email already exists.
import mongoose from 'mongoose';
import { config } from '../config.js';
import { User } from '../models/User.js';

const [email, password, name = 'Admin'] = process.argv.slice(2);
if (!email || !password) {
  console.error('Usage: pnpm create-admin <email> <password> [name]');
  process.exit(1);
}

await mongoose.connect(config.mongoUri);

const user = (await User.findOne({ email: email.toLowerCase() })) ?? new User({ email, name });
user.password = password;
user.role = 'admin';
await user.save();

console.log(`Admin ready: ${user.email}`);
await mongoose.disconnect();
