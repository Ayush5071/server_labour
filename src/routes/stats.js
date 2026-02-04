import express from 'express';
import mongoose from 'mongoose';

const router = express.Router();

router.get('/storage', async (req, res) => {
  try {
    if (mongoose.connection.readyState === 1) {
      const stats = await mongoose.connection.db.stats();
      res.json({
        dataSize: stats.dataSize,
        storageSize: stats.storageSize,
        objects: stats.objects,
        avgObjSize: stats.avgObjSize,
        indexes: stats.indexes,
        indexSize: stats.indexSize,
        fileSize: stats.fileSize // May be null on Atlas
      });
    } else {
      res.status(503).json({ error: 'Database not connected' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
