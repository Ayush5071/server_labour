import express from 'express';
import DailyEntry from '../models/DailyEntry.js';
import Worker from '../models/Worker.js';
import Holiday from '../models/Holiday.js';

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
      .populate('worker', 'name workerId hourlyRate dailyWorkingHours')
      .sort({ date: -1, createdAt: -1 });

    res.json(entries);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get entries for a specific date with all workers
router.get('/daily/:date', async (req, res) => {
  try {
    const { date } = req.params;
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(date);
    dayEnd.setHours(23, 59, 59, 999);

    // Check if it's a holiday
    const holiday = await Holiday.findOne({
      date: { $gte: dayStart, $lte: dayEnd }
    });

    // Get all active workers
    const workers = await Worker.find({ isActive: true }).sort({ name: 1 });

    // Get existing entries for this date
    const entries = await DailyEntry.find({
      date: { $gte: dayStart, $lte: dayEnd }
    }).populate('worker', 'name workerId hourlyRate dailyWorkingHours');

    // Map entries by worker ID
    const entryMap = {};
    entries.forEach(entry => {
      entryMap[entry.worker._id.toString()] = entry;
    });

    // Create response with all workers
    const result = workers.map(worker => ({
      worker: {
        _id: worker._id,
        name: worker.name,
        workerId: worker.workerId,
        hourlyRate: worker.hourlyRate,
        dailyWorkingHours: worker.dailyWorkingHours
      },
      entry: entryMap[worker._id.toString()] || null
    }));

    res.json({
      date,
      isHoliday: !!holiday,
      holiday: holiday || null,
      workers: result
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Bulk create/update daily entries
router.post('/bulk', async (req, res) => {
  try {
    const { date, entries } = req.body;
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);

    const results = [];

    for (const entry of entries) {
      const { workerId, status, hoursWorked, notes } = entry;

      // Get worker
      const worker = await Worker.findById(workerId);
      if (!worker) continue;

      // Calculate pay
      let totalPay = 0;
      if (status === 'present' || status === 'holiday') {
        const hourlyRate = worker.hourlyRate || (worker.dailyPay ? worker.dailyPay / worker.dailyWorkingHours : 0);
        totalPay = hoursWorked * hourlyRate;
      } else if (status === 'half-day') {
        const hourlyRate = worker.hourlyRate || (worker.dailyPay ? worker.dailyPay / worker.dailyWorkingHours : 0);
        totalPay = hourlyRate * (worker.dailyWorkingHours / 2);
      }

      // Upsert entry
      const updatedEntry = await DailyEntry.findOneAndUpdate(
        { worker: workerId, date: dayStart },
        {
          worker: workerId,
          date: dayStart,
          status,
          hoursWorked: hoursWorked || 0,
          totalPay,
          notes
        },
        { upsert: true, new: true }
      );

      results.push(updatedEntry);
    }

    // Update worker stats
    for (const entry of results) {
      const presentCount = await DailyEntry.countDocuments({
        worker: entry.worker,
        status: { $in: ['present', 'holiday'] }
      });
      const absentCount = await DailyEntry.countDocuments({
        worker: entry.worker,
        status: 'absent'
      });

      await Worker.findByIdAndUpdate(entry.worker, {
        totalDaysWorked: presentCount,
        totalDaysAbsent: absentCount
      });
    }

    res.json({ success: true, count: results.length });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Create single entry
router.post('/', async (req, res) => {
  try {
    const { workerId, date, status, hoursWorked, notes } = req.body;

    const worker = await Worker.findById(workerId);
    if (!worker) {
      return res.status(404).json({ error: 'Worker not found' });
    }

    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);

    // Calculate pay
    let totalPay = 0;
    if (status === 'present' || status === 'holiday') {
      const hourlyRate = worker.hourlyRate || (worker.dailyPay ? worker.dailyPay / worker.dailyWorkingHours : 0);
      totalPay = hoursWorked * hourlyRate;
    } else if (status === 'half-day') {
      const hourlyRate = worker.hourlyRate;
      totalPay = hourlyRate * (worker.dailyWorkingHours / 2);
    }

    const entry = await DailyEntry.findOneAndUpdate(
      { worker: workerId, date: dayStart },
      {
        worker: workerId,
        date: dayStart,
        status: status || 'present',
        hoursWorked: hoursWorked || 0,
        totalPay,
        notes
      },
      { upsert: true, new: true }
    );

    // Update worker stats
    const presentCount = await DailyEntry.countDocuments({
      worker: workerId,
      status: { $in: ['present', 'holiday'] }
    });
    const absentCount = await DailyEntry.countDocuments({
      worker: workerId,
      status: 'absent'
    });

    await Worker.findByIdAndUpdate(workerId, {
      totalDaysWorked: presentCount,
      totalDaysAbsent: absentCount
    });

    const populatedEntry = await DailyEntry.findById(entry._id)
      .populate('worker', 'name workerId');

    res.status(201).json(populatedEntry);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Mark holiday for all workers
router.post('/mark-holiday', async (req, res) => {
  try {
    const { date, holidayName } = req.body;
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);

    // Create or update holiday
    await Holiday.findOneAndUpdate(
      { date: dayStart },
      { date: dayStart, name: holidayName || 'Holiday' },
      { upsert: true }
    );

    // Get all active workers
    const workers = await Worker.find({ isActive: true });

    // Create entries for all workers with full day pay
    for (const worker of workers) {
      const hourlyRate = worker.hourlyRate || (worker.dailyPay ? worker.dailyPay / worker.dailyWorkingHours : 0);
      const totalPay = hourlyRate * worker.dailyWorkingHours;

      await DailyEntry.findOneAndUpdate(
        { worker: worker._id, date: dayStart },
        {
          worker: worker._id,
          date: dayStart,
          status: 'holiday',
          hoursWorked: worker.dailyWorkingHours,
          totalPay,
          notes: holidayName || 'Holiday'
        },
        { upsert: true }
      );
    }

    res.json({ success: true, message: `Holiday marked for ${workers.length} workers` });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Delete entry
router.delete('/:id', async (req, res) => {
  try {
    const entry = await DailyEntry.findByIdAndDelete(req.params.id);
    if (!entry) {
      return res.status(404).json({ error: 'Entry not found' });
    }

    // Update worker stats
    const presentCount = await DailyEntry.countDocuments({
      worker: entry.worker,
      status: { $in: ['present', 'holiday'] }
    });
    const absentCount = await DailyEntry.countDocuments({
      worker: entry.worker,
      status: 'absent'
    });

    await Worker.findByIdAndUpdate(entry.worker, {
      totalDaysWorked: presentCount,
      totalDaysAbsent: absentCount
    });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
