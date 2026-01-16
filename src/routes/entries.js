import express from 'express';
import DailyEntry from '../models/DailyEntry.js';
import Worker from '../models/Worker.js';

const router = express.Router();

// Get entries with filters
router.get('/', async (req, res) => {
  try {
    const { workerId, startDate, endDate, date } = req.query;
    const filter = {};

    if (workerId) {
      filter.worker = workerId;
    }

    if (date) {
      const dayStart = new Date(date);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(date);
      dayEnd.setHours(23, 59, 59, 999);
      filter.date = { $gte: dayStart, $lte: dayEnd };
    } else if (startDate || endDate) {
      filter.date = {};
      if (startDate) {
        filter.date.$gte = new Date(startDate);
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        filter.date.$lte = end;
      }
    }

    const entries = await DailyEntry.find(filter)
      .populate('worker', 'name workerId')
      .sort({ date: -1, createdAt: -1 });

    res.json(entries);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get single entry
router.get('/:id', async (req, res) => {
  try {
    const entry = await DailyEntry.findById(req.params.id)
      .populate('worker', 'name workerId dailyWorkingHours dailyPay overtimeRate');
    
    if (!entry) {
      return res.status(404).json({ error: 'Entry not found' });
    }
    res.json(entry);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create daily entry
router.post('/', async (req, res) => {
  try {
    const { workerId, date, hoursWorked, notes } = req.body;

    // Get worker details
    const worker = await Worker.findById(workerId);
    if (!worker) {
      return res.status(404).json({ error: 'Worker not found' });
    }

    // Calculate pay
    const regularHours = Math.min(hoursWorked, worker.dailyWorkingHours);
    const overtimeHours = Math.max(0, hoursWorked - worker.dailyWorkingHours);
    
    const hourlyRate = worker.dailyPay / worker.dailyWorkingHours;
    const regularPay = regularHours * hourlyRate;
    const overtimePay = overtimeHours * hourlyRate * worker.overtimeRate;
    const totalPay = regularPay + overtimePay;

    // Create entry
    const entry = new DailyEntry({
      worker: workerId,
      date: new Date(date),
      hoursWorked,
      regularHours,
      overtimeHours,
      regularPay,
      overtimePay,
      totalPay,
      notes
    });

    await entry.save();

    // Update worker totals
    await Worker.findByIdAndUpdate(workerId, {
      $inc: {
        totalEarnings: totalPay,
        totalOvertimeHours: overtimeHours
      }
    });

    const populatedEntry = await DailyEntry.findById(entry._id)
      .populate('worker', 'name workerId');

    res.status(201).json(populatedEntry);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Update entry
router.put('/:id', async (req, res) => {
  try {
    const { hoursWorked, notes } = req.body;

    const existingEntry = await DailyEntry.findById(req.params.id);
    if (!existingEntry) {
      return res.status(404).json({ error: 'Entry not found' });
    }

    // Get worker for recalculation
    const worker = await Worker.findById(existingEntry.worker);
    if (!worker) {
      return res.status(404).json({ error: 'Worker not found' });
    }

    // Revert old totals from worker
    await Worker.findByIdAndUpdate(existingEntry.worker, {
      $inc: {
        totalEarnings: -existingEntry.totalPay,
        totalOvertimeHours: -existingEntry.overtimeHours
      }
    });

    // Recalculate pay
    const regularHours = Math.min(hoursWorked, worker.dailyWorkingHours);
    const overtimeHours = Math.max(0, hoursWorked - worker.dailyWorkingHours);
    
    const hourlyRate = worker.dailyPay / worker.dailyWorkingHours;
    const regularPay = regularHours * hourlyRate;
    const overtimePay = overtimeHours * hourlyRate * worker.overtimeRate;
    const totalPay = regularPay + overtimePay;

    // Update entry
    const entry = await DailyEntry.findByIdAndUpdate(
      req.params.id,
      {
        hoursWorked,
        regularHours,
        overtimeHours,
        regularPay,
        overtimePay,
        totalPay,
        notes
      },
      { new: true }
    ).populate('worker', 'name workerId');

    // Add new totals to worker
    await Worker.findByIdAndUpdate(existingEntry.worker, {
      $inc: {
        totalEarnings: totalPay,
        totalOvertimeHours: overtimeHours
      }
    });

    res.json(entry);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Delete entry
router.delete('/:id', async (req, res) => {
  try {
    const entry = await DailyEntry.findById(req.params.id);
    if (!entry) {
      return res.status(404).json({ error: 'Entry not found' });
    }

    // Revert totals from worker
    await Worker.findByIdAndUpdate(entry.worker, {
      $inc: {
        totalEarnings: -entry.totalPay,
        totalOvertimeHours: -entry.overtimeHours
      }
    });

    await DailyEntry.findByIdAndDelete(req.params.id);

    res.json({ message: 'Entry deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
