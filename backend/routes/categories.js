const express = require('express');
const router = express.Router();
const Category = require('../models/Category');
const { protect, admin } = require('../middleware/auth');
const upload = require('../middleware/upload');

// @route   GET /api/categories
// @desc    Get all categories
// @access  Public
router.get('/', async (req, res) => {
    try {
        const categories = await Category.find({ isActive: true }).sort('order');
        res.json(categories);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   GET /api/categories/all
// @desc    Get all categories including inactive (admin)
// @access  Private/Admin
router.get('/all', protect, admin, async (req, res) => {
    try {
        const categories = await Category.find().sort('order');
        res.json(categories);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   GET /api/categories/:id
// @desc    Get category by ID
// @access  Public
router.get('/:id', async (req, res) => {
    try {
        const category = await Category.findById(req.params.id);
        if (!category) {
            return res.status(404).json({ message: 'Category not found' });
        }
        res.json(category);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   POST /api/categories
// @desc    Create category
// @access  Private/Admin
router.post('/', protect, admin, upload.single('image'), upload.processAndUploadToR2('uploads'), async (req, res) => {
    try {
        const { name, description, order } = req.body;

        const category = new Category({
            name,
            description,
            order: order || 0,
            image: req.fileUrl || ''
        });

        await category.save();
        res.status(201).json(category);
    } catch (error) {
        console.error(error);
        if (error.code === 11000) {
            return res.status(400).json({ message: 'Category already exists' });
        }
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   PUT /api/categories/:id
// @desc    Update category
// @access  Private/Admin
router.put('/:id', protect, admin, upload.single('image'), upload.processAndUploadToR2('uploads'), async (req, res) => {
    try {
        const { name, description, order, isActive } = req.body;

        const category = await Category.findById(req.params.id);
        if (!category) {
            return res.status(404).json({ message: 'Category not found' });
        }

        if (name) category.name = name;
        if (description !== undefined) category.description = description;
        if (order !== undefined) category.order = order;
        if (isActive !== undefined) category.isActive = isActive === 'true' || isActive === true;
        if (req.fileUrl) category.image = req.fileUrl;

        await category.save();
        res.json(category);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   DELETE /api/categories/:id
// @desc    Delete category
// @access  Private/Admin
router.delete('/:id', protect, admin, async (req, res) => {
    try {
        const category = await Category.findByIdAndDelete(req.params.id);
        if (!category) {
            return res.status(404).json({ message: 'Category not found' });
        }
        res.json({ message: 'Category deleted' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;
