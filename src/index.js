import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import workerRoutes from './routes/workers.js';
import entryRoutes from './routes/entries.js';
import reportRoutes from './routes/reports.js';
import advanceRoutes from './routes/advances.js';
import vaultRoutes from './routes/vault.js';
import bonusRoutes from './routes/bonus.js';
import holidayRoutes from './routes/holidays.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/worker_management';

// Connect to MongoDB first
mongoose.connect(MONGODB_URI)
  .then(() => {
    console.log('Connected to MongoDB');
    
    // Middleware
    app.use(cors());
    app.use(express.json());

    // Routes
    app.use('/api/workers', workerRoutes);
    app.use('/api/entries', entryRoutes);
    app.use('/api/reports', reportRoutes);
    app.use('/api/advances', advanceRoutes);
    app.use('/api/vault', vaultRoutes);
    app.use('/api/bonus', bonusRoutes);
    app.use('/api/holidays', holidayRoutes);

    // Health check
    app.get('/api/health', (req, res) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    // Start server
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch((error) => {
    console.error('MongoDB connection error:', error);
    process.exit(1);
  });
