const express = require('express');
const router = express.Router();
const Table = require('../models/Table');
const { protect, admin } = require('../middleware/auth');

// Get all tables (public - for dropdown)
router.get('/', async (req, res) => {
    try {
        const tables = await Table.find({ isActive: true })
            .populate('currentOrder', 'orderNumber status')
            .sort('tableNumber');
        res.json(tables);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// Get available tables only
router.get('/available', async (req, res) => {
    try {
        const tables = await Table.find({ isActive: true, status: 'available' })
            .sort('tableNumber');
        res.json(tables);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// Admin: Create table
router.post('/', protect, admin, async (req, res) => {
    try {
        const { tableNumber, capacity } = req.body;

        const existing = await Table.findOne({ tableNumber });
        if (existing) {
            return res.status(400).json({ message: 'Table number already exists' });
        }

        const table = await Table.create({ tableNumber, capacity });
        res.status(201).json(table);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// Admin: Bulk create tables
router.post('/bulk', protect, admin, async (req, res) => {
    try {
        const { startNumber, endNumber, capacity } = req.body;
        const tables = [];

        for (let i = startNumber; i <= endNumber; i++) {
            const tableNumber = i.toString();
            const existing = await Table.findOne({ tableNumber });
            if (!existing) {
                tables.push({ tableNumber, capacity: capacity || 4 });
            }
        }

        const created = await Table.insertMany(tables);
        res.status(201).json({ message: `Created ${created.length} tables`, tables: created });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// Admin: Update table
router.put('/:id', protect, admin, async (req, res) => {
    try {
        const table = await Table.findByIdAndUpdate(
            req.params.id,
            req.body,
            { new: true }
        );
        res.json(table);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// Admin: Delete table
router.delete('/:id', protect, admin, async (req, res) => {
    try {
        await Table.findByIdAndDelete(req.params.id);
        res.json({ message: 'Table deleted' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// Occupy table (internal use)
router.put('/:id/occupy', protect, async (req, res) => {
    try {
        const { orderId } = req.body;
        const table = await Table.findByIdAndUpdate(
            req.params.id,
            { status: 'occupied', isOccupied: true, currentOrder: orderId },
            { new: true }
        );
        res.json(table);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// Free table (after payment)
router.put('/:id/free', protect, async (req, res) => {
    try {
        const table = await Table.findByIdAndUpdate(
            req.params.id,
            { status: 'available', isOccupied: false, currentOrder: null },
            { new: true }
        );

        // Emit socket event
        const io = req.app.get('io');
        if (io) {
            io.emit('table-freed', table);
        }

        res.json(table);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

module.exports = router;
