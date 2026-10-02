const express = require('express');
const router = express.Router();
const Inventory = require('../models/Inventory');
const { protect, admin } = require('../middleware/auth');

// @route   GET /api/inventory
// @desc    Get all inventory items
// @access  Private/Admin
router.get('/', protect, admin, async (req, res) => {
    try {
        const { category, lowStock } = req.query;
        let query = {};

        if (category) query.category = category;
        if (lowStock === 'true') query.isLowStock = true;

        const items = await Inventory.find(query).sort('name');
        res.json(items);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   GET /api/inventory/low-stock
// @desc    Get low stock items
// @access  Private/Admin
router.get('/low-stock', protect, admin, async (req, res) => {
    try {
        const items = await Inventory.find({ isLowStock: true }).sort('currentStock');
        res.json(items);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   GET /api/inventory/:id
// @desc    Get inventory item by ID
// @access  Private/Admin
router.get('/:id', protect, admin, async (req, res) => {
    try {
        const item = await Inventory.findById(req.params.id);
        if (!item) {
            return res.status(404).json({ message: 'Item not found' });
        }
        res.json(item);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   POST /api/inventory
// @desc    Create inventory item
// @access  Private/Admin
router.post('/', protect, admin, async (req, res) => {
    try {
        const { name, category, unit, currentStock, minimumStock, costPerUnit, supplier, amountPaid } = req.body;

        const totalValue = (currentStock || 0) * (costPerUnit || 0);
        let paymentStatus = 'unpaid';
        if (amountPaid >= totalValue && totalValue > 0) paymentStatus = 'paid';
        else if (amountPaid > 0) paymentStatus = 'partial';

        const item = new Inventory({
            name,
            category: category || 'ingredient',
            unit,
            currentStock: currentStock || 0,
            minimumStock: minimumStock || 10,
            costPerUnit: costPerUnit || 0,
            amountPaid: amountPaid || 0,
            paymentStatus,
            supplier: supplier || ''
        });

        await item.save();
        res.status(201).json(item);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   PUT /api/inventory/:id
// @desc    Update inventory item
// @access  Private/Admin
router.put('/:id', protect, admin, async (req, res) => {
    try {
        const item = await Inventory.findById(req.params.id);
        if (!item) {
            return res.status(404).json({ message: 'Item not found' });
        }

        const fields = ['name', 'category', 'unit', 'currentStock', 'minimumStock', 'costPerUnit', 'supplier', 'amountPaid'];
        fields.forEach(field => {
            if (req.body[field] !== undefined) {
                item[field] = req.body[field];
            }
        });

        // Auto update payment status
        const totalValue = item.currentStock * item.costPerUnit;
        if (item.amountPaid >= totalValue && totalValue > 0) item.paymentStatus = 'paid';
        else if (item.amountPaid > 0) item.paymentStatus = 'partial';
        else item.paymentStatus = 'unpaid';

        await item.save();
        res.json(item);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   PUT /api/inventory/:id/restock
// @desc    Restock inventory item
// @access  Private/Admin
router.put('/:id/restock', protect, admin, async (req, res) => {
    try {
        const { quantity } = req.body;

        const item = await Inventory.findById(req.params.id);
        if (!item) {
            return res.status(404).json({ message: 'Item not found' });
        }

        item.currentStock += quantity;
        item.lastRestocked = new Date();
        await item.save();

        res.json(item);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   DELETE /api/inventory/:id
// @desc    Delete inventory item
// @access  Private/Admin
router.delete('/:id', protect, admin, async (req, res) => {
    try {
        const item = await Inventory.findByIdAndDelete(req.params.id);
        if (!item) {
            return res.status(404).json({ message: 'Item not found' });
        }
        res.json({ message: 'Item deleted' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;
