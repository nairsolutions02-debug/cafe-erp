const express = require('express');
const router = express.Router();
const Settings = require('../models/Settings');
const { protect, admin } = require('../middleware/auth');

// Get all settings (public for GST etc.)
router.get('/', async (req, res) => {
    try {
        const settings = await Settings.find();
        const settingsObj = {};
        settings.forEach(s => {
            settingsObj[s.key] = s.value;
        });
        res.json(settingsObj);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// Get GST rate (public)
router.get('/gst', async (req, res) => {
    try {
        const gstRate = await Settings.getSetting('gst_rate', 5);
        res.json({ gstRate });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// Admin: Update GST rate
router.put('/gst', protect, admin, async (req, res) => {
    try {
        const { gstRate } = req.body;

        if (gstRate < 0 || gstRate > 100) {
            return res.status(400).json({ message: 'GST rate must be between 0 and 100' });
        }

        const setting = await Settings.setSetting('gst_rate', gstRate, 'GST Tax Rate Percentage');

        // Emit socket event for real-time update
        const io = req.app.get('io');
        if (io) {
            io.emit('settings-updated', { gstRate });
        }

        res.json({ gstRate: setting.value });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// Admin: Update any setting
router.put('/:key', protect, admin, async (req, res) => {
    try {
        const { value, description } = req.body;
        const setting = await Settings.setSetting(req.params.key, value, description);
        res.json(setting);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

module.exports = router;
