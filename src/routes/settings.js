import express from 'express';
import Settings from '../models/Settings.js';

const router = express.Router();

// Get general settings
router.get('/', async (req, res) => {
  try {
    const settings = await Settings.findOne({ key: 'general' });
    res.json({ settings: settings || {} });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update settings (only allow companyName for now)
router.put('/', async (req, res) => {
  try {
    const { companyName } = req.body;
    let settings = await Settings.findOne({ key: 'general' });
    if (!settings) settings = new Settings({ key: 'general' });

    if (companyName !== undefined) settings.companyName = companyName;

    await settings.save();
    res.json({ success: true, settings });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
