import express from 'express';
import Worker from '../models/Worker.js';

const router = express.Router();

// Get all workers
router.get('/', async (req, res) => {
  try {
    // Return all workers regardless of active status
    const workers = await Worker.find({}).sort({ name: 1 });
    
    // Normalize salary field for older records that may still have dailyPay stored
    const normalized = workers.map(w => {
      const obj = w.toObject ? w.toObject() : w;
      if (!obj.hourlyRate && obj.dailyPay) {
        obj.hourlyRate = obj.dailyPay / (obj.dailyWorkingHours || 8);
      }
      return obj;
    });

    res.json(normalized);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get single worker
router.get('/:id', async (req, res) => {
  try {
    const worker = await Worker.findById(req.params.id);
    if (!worker) {
      return res.status(404).json({ error: 'Worker not found' });
    }

    const obj = worker.toObject ? worker.toObject() : worker;
    if (!obj.hourlyRate && obj.dailyPay) {
      obj.hourlyRate = obj.dailyPay / (obj.dailyWorkingHours || 8);
    }

    res.json(obj);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create worker
router.post('/', async (req, res) => {
  try {
    const {
      workerId,
      name,
      dailyWorkingHours,
      hourlyRate,
      bankDetails
    } = req.body;

    const existingWorker = await Worker.findOne({ workerId });
    if (existingWorker) {
      return res.status(400).json({ error: 'Worker ID already exists' });
    }

    const worker = new Worker({
      workerId,
      name,
      dailyWorkingHours: dailyWorkingHours || 8,
      hourlyRate,
      bankDetails: bankDetails || {}
    });

    await worker.save();
    res.status(201).json(worker);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Update worker
router.put('/:id', async (req, res) => {
  try {
    const {
      workerId,
      name,
      dailyWorkingHours,
      hourlyRate,
      bankDetails,
      isActive
    } = req.body;

    // Check if workerId is being changed and if it conflicts
    if (workerId) {
      const existingWorker = await Worker.findOne({ 
        workerId, 
        _id: { $ne: req.params.id } 
      });
      if (existingWorker) {
        return res.status(400).json({ error: 'Worker ID already exists' });
      }
    }

    const worker = await Worker.findByIdAndUpdate(
      req.params.id,
      {
        workerId,
        name,
        dailyWorkingHours,
        hourlyRate,
        bankDetails,
        isActive
      },
      { new: true, runValidators: true }
    );

    if (!worker) {
      return res.status(404).json({ error: 'Worker not found' });
    }

    res.json(worker);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Delete worker (soft delete)
router.delete('/:id', async (req, res) => {
  try {
    const worker = await Worker.findByIdAndUpdate(
      req.params.id,
      { isActive: false },
      { new: true }
    );

    if (!worker) {
      return res.status(404).json({ error: 'Worker not found' });
    }

    res.json({ message: 'Worker deactivated successfully', worker });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
