import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import Worker from '../src/models/Worker.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../.env') });

const MONGODB_URI = process.env.MONGODB_URI;

console.log('Connecting to:', MONGODB_URI);

mongoose.connect(MONGODB_URI)
  .then(async () => {
    console.log('Connected to MongoDB');
    try {
        const count = await Worker.countDocuments({});
        console.log(`Found ${count} workers.`);
        
        const result = await Worker.updateMany({}, { $set: { isActive: true } });
        console.log('Update result:', result);
        console.log('All workers have been marked as Active.');
    } catch (e) {
        console.error('Error updating workers:', e);
    } finally {
        await mongoose.disconnect();
        console.log('Disconnected');
    }
  })
  .catch(err => {
      console.error('Connection error:', err);
      process.exit(1);
  });
