import mongoose from 'mongoose';
import { app } from './app.js';
import { config } from './config.js';

await mongoose.connect(config.mongoUri);
console.log('Connected to MongoDB');

app.listen(config.port, () => {
  console.log(`API listening on http://localhost:${config.port}`);
});
