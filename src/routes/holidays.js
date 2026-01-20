import express from 'express';
import Holiday from '../models/Holiday.js';

const router = express.Router();

// Get all holidays
router.get('/', async (req, res) => {
  try {
    const { year } = req.query;
    const filter = {};

    if (year) {
      const yearStart = new Date(parseInt(year), 0, 1);
      const yearEnd = new Date(parseInt(year), 11, 31, 23, 59, 59, 999);
      filter.date = { $gte: yearStart, $lte: yearEnd };
    }

    const holidays = await Holiday.find(filter).sort({ date: 1 });
    res.json(holidays);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create holiday
router.post('/', async (req, res) => {
  try {
    const { date, name, description } = req.body;
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);

    const holiday = await Holiday.findOneAndUpdate(
      { date: dayStart },
      { date: dayStart, name, description },
      { upsert: true, new: true }
    );

    res.status(201).json(holiday);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Delete holiday
router.delete('/:id', async (req, res) => {
  try {
    const holiday = await Holiday.findByIdAndDelete(req.params.id);
    if (!holiday) {
      return res.status(404).json({ error: 'Holiday not found' });
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
