import express from 'express';
import DailyEntry from '../models/DailyEntry.js';
import Worker from '../models/Worker.js';
import Holiday from '../models/Holiday.js';

const router = express.Router();

// Helper function to parse date string consistently in local timezone
const parseLocalDate = (dateString) => {
  const [year, month, day] = dateString.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  date.setHours(0, 0, 0, 0);
  return date;
};

// Get entries with filters
router.get('/', async (req, res) => {
  try {
    const { workerId, startDate, endDate, date } = req.query;
    const filter = {};

    if (workerId) {
      filter.worker = workerId;
    }

    if (date) {
      const dayStart = parseLocalDate(date);
      const dayEnd = new Date(dayStart);
      dayEnd.setHours(23, 59, 59, 999);
      filter.date = { $gte: dayStart, $lte: dayEnd };
    } else if (startDate || endDate) {
      filter.date = {};
      if (startDate) {
        filter.date.$gte = parseLocalDate(startDate);
      }
      if (endDate) {
        const end = parseLocalDate(endDate);
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
    const dayStart = parseLocalDate(date);
    const dayEnd = new Date(dayStart);
    dayEnd.setHours(23, 59, 59, 999);

    // Check if it's a holiday
    const holiday = await Holiday.findOne({
      date: { $gte: dayStart, $lte: dayEnd }
    });

    console.log(`🌐 [SERVER] GET /daily/${date}`);
    console.log(`🌐 [SERVER] Query Range: ${dayStart.toISOString()} to ${dayEnd.toISOString()}`);

    // Get all active workers
    const workers = await Worker.find({ isActive: true }).sort({ name: 1 });

    // Get existing entries for this date
    // Sort by updatedAt asc so that most recent entry overwrites older ones in the map
    const entries = await DailyEntry.find({
      date: { $gte: dayStart, $lte: dayEnd }
    }).sort({ updatedAt: 1 }).populate('worker', 'name workerId hourlyRate dailyWorkingHours');

    console.log(`🌐 [SERVER] Found ${entries.length} raw entries in range`);
    entries.forEach(e => {
        console.log(`   - Entry ${e._id}: Worker ${e.worker?.name} (${e.worker?._id}), Date: ${e.date.toISOString()}, Hours: ${e.hoursWorked}, UpdatedAt: ${e.updatedAt}`);
    });

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

    console.log(`🌐 [SERVER] Returning ${result.length} workers for date ${date}`);
    result.forEach(r => {
      if (r.entry) {
        console.log(`🌐 [SERVER] Worker ${r.worker.name}: hours = ${r.entry.hoursWorked}, status = ${r.entry.status}`);
      }
    });
    
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
    
    console.log('🌐 [SERVER] Bulk save request for date:', date);
    console.log('🌐 [SERVER] Received entries:', JSON.stringify(entries, null, 2));
    
    // Use range for querying to match any entry on this day regardless of timezone time
    const rangeStart = parseLocalDate(date);
    const rangeEnd = new Date(rangeStart);
    rangeEnd.setHours(23, 59, 59, 999);
    console.log('🌐 [SERVER] Date range:', { rangeStart, rangeEnd });

    const results = [];

    for (const entry of entries) {
      const { workerId, status, hoursWorked, notes } = entry;

      // Get worker
      const worker = await Worker.findById(workerId);
      if (!worker) continue;

      // Calculate pay
      let totalPay = 0;
      const hourlyRate = worker.hourlyRate || (worker.dailyPay ? worker.dailyPay / (worker.dailyWorkingHours || 8) : 0);

      if (['present', 'holiday', 'half-day'].includes(status)) {
         totalPay = (hoursWorked || 0) * hourlyRate;
      }

      // Find existing entry in range to avoid duplicates AND CLEAN UP DUPLICATES
      const existingEntries = await DailyEntry.find({
        worker: workerId,
        date: { $gte: rangeStart, $lte: rangeEnd }
      }).sort({ updatedAt: -1 }); // Newest first

      let dailyEntry;
      if (existingEntries.length > 0) {
        // Use the newest one
        dailyEntry = existingEntries[0];
      }

      const hoursValue = typeof hoursWorked === 'number' ? hoursWorked : (parseFloat(hoursWorked) >= 0 ? parseFloat(hoursWorked) : 0);
      console.log(`🌐 [SERVER] Worker ${workerId}: hoursWorked input = ${hoursWorked}, converted = ${hoursValue}`);

      if (dailyEntry) {
        console.log(`🌐 [SERVER] Updating existing entry ${dailyEntry._id} for worker ${workerId}`);
        dailyEntry.status = status;
        dailyEntry.hoursWorked = hoursValue;
        dailyEntry.totalPay = totalPay;
        // Normalize date to prevent future fuzzy matching issues
        dailyEntry.date = rangeStart;
        if (notes !== undefined) dailyEntry.notes = notes;
        await dailyEntry.save();
        console.log(`🌐 [SERVER] Saved entry ${dailyEntry._id}:`, { status: dailyEntry.status, hoursWorked: dailyEntry.hoursWorked });

        // Post-save cleanup: Ensure NO other entries exist for this worker on this date
        // This handles race conditions and "hidden" duplicates that might have been missed by initial sort
        const cleanupResult = await DailyEntry.deleteMany({
            worker: workerId,
            date: { $gte: rangeStart, $lte: rangeEnd },
            _id: { $ne: dailyEntry._id }
        });
        if (cleanupResult.deletedCount > 0) {
            console.log(`🧹 [SERVER] Post-save Cleanup: Deleted ${cleanupResult.deletedCount} extra entries for worker ${workerId}`);
        }

      } else {
        console.log(`🌐 [SERVER] Creating new entry for worker ${workerId}`);
        dailyEntry = new DailyEntry({
          worker: workerId,
          date: rangeStart, // Normalize to midnight
          status,
          hoursWorked: hoursValue,
          totalPay,
          notes
        });
        await dailyEntry.save();
        console.log(`🌐 [SERVER] Created entry ${dailyEntry._id}:`, { status: dailyEntry.status, hoursWorked: dailyEntry.hoursWorked });
      }

      results.push(dailyEntry);
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

    console.log(`🌐 [SERVER] ✅ Bulk save completed. Saved ${results.length} entries`);
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

    const rangeStart = parseLocalDate(date);
    const rangeEnd = new Date(rangeStart);
    rangeEnd.setHours(23, 59, 59, 999);

    // Calculate pay
    let totalPay = 0;
    const hourlyRate = worker.hourlyRate || (worker.dailyPay ? worker.dailyPay / (worker.dailyWorkingHours || 8) : 0);

    if (['present', 'holiday', 'half-day'].includes(status)) {
       totalPay = (hoursWorked || 0) * hourlyRate;
    }

    // Find existing entry in range
    let dailyEntry = await DailyEntry.findOne({
      worker: workerId,
      date: { $gte: rangeStart, $lte: rangeEnd }
    });

    const hoursValue = typeof hoursWorked === 'number' ? hoursWorked : (parseFloat(hoursWorked) >= 0 ? parseFloat(hoursWorked) : 0);

    if (dailyEntry) {
      dailyEntry.status = status || 'present';
      dailyEntry.hoursWorked = hoursValue;
      dailyEntry.totalPay = totalPay;
      if (notes !== undefined) dailyEntry.notes = notes;
      await dailyEntry.save();
    } else {
      dailyEntry = new DailyEntry({
        worker: workerId,
        date: rangeStart,
        status: status || 'present',
        hoursWorked: hoursValue,
        totalPay,
        notes
      });
      await dailyEntry.save();
    }

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

    const populatedEntry = await DailyEntry.findById(dailyEntry._id)
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
    
    // Use range for consistent querying
    const rangeStart = parseLocalDate(date);
    const rangeEnd = new Date(rangeStart);
    rangeEnd.setHours(23, 59, 59, 999);

    // Create or update holiday
    // Check if holiday exists in range
    let holiday = await Holiday.findOne({
      date: { $gte: rangeStart, $lte: rangeEnd }
    });

    if (holiday) {
      holiday.name = holidayName || 'Holiday';
      await holiday.save();
    } else {
      await Holiday.create({ date: rangeStart, name: holidayName || 'Holiday' });
    }

    // Get all active workers
    const workers = await Worker.find({ isActive: true });

    // Create entries for all workers with full day pay
    for (const worker of workers) {
      const hourlyRate = worker.hourlyRate || (worker.dailyPay ? worker.dailyPay / worker.dailyWorkingHours : 0);
      const totalPay = hourlyRate * worker.dailyWorkingHours;

      let dailyEntry = await DailyEntry.findOne({
        worker: worker._id,
        date: { $gte: rangeStart, $lte: rangeEnd }
      });

      if (dailyEntry) {
        dailyEntry.status = 'holiday';
        dailyEntry.hoursWorked = worker.dailyWorkingHours;
        dailyEntry.totalPay = totalPay;
        dailyEntry.notes = holidayName || 'Holiday';
        await dailyEntry.save();
      } else {
        await DailyEntry.create({
          worker: worker._id,
          date: rangeStart,
          status: 'holiday',
          hoursWorked: worker.dailyWorkingHours,
          totalPay,
          notes: holidayName || 'Holiday'
        });
      }
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
