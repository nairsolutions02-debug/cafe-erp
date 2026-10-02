const express = require('express');
const router = express.Router();
const MenuItem = require('../models/MenuItem');
const { protect, admin } = require('../middleware/auth');
const upload = require('../middleware/upload');

// @route   GET /api/menu
// @desc    Get all available menu items
// @access  Public
router.get('/', async (req, res) => {
    try {
        const { category, search, bestseller, isNew, recommended } = req.query;

        let query = { isAvailable: true };

        if (category) query.category = category;
        if (bestseller === 'true') query.isBestSeller = true;
        if (isNew === 'true') query.isNewItem = true;
        if (recommended === 'true') query.isRecommended = true;
        if (search) {
            query.$or = [
                { name: { $regex: search, $options: 'i' } },
                { description: { $regex: search, $options: 'i' } }
            ];
        }

        const items = await MenuItem.find(query).populate('category', 'name');
        res.json(items);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   GET /api/menu/all
// @desc    Get all menu items (admin)
// @access  Private/Admin
router.get('/all', protect, admin, async (req, res) => {
    try {
        const items = await MenuItem.find().populate('category', 'name');
        res.json(items);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   GET /api/menu/bestsellers
// @desc    Get bestseller items
// @access  Public
router.get('/bestsellers', async (req, res) => {
    try {
        const items = await MenuItem.find({ isBestSeller: true, isAvailable: true })
            .populate('category', 'name')
            .limit(10);
        res.json(items);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   GET /api/menu/new
// @desc    Get new items
// @access  Public
router.get('/new', async (req, res) => {
    try {
        const items = await MenuItem.find({ isNewItem: true, isAvailable: true })
            .populate('category', 'name')
            .limit(10);
        res.json(items);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   GET /api/menu/recommended
// @desc    Get recommended items (like water bottle)
// @access  Public
router.get('/recommended', async (req, res) => {
    try {
        const items = await MenuItem.find({ isRecommended: true, isAvailable: true })
            .populate('category', 'name');
        res.json(items);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   GET /api/menu/:id
// @desc    Get menu item by ID
// @access  Public
router.get('/:id', async (req, res) => {
    try {
        const item = await MenuItem.findById(req.params.id).populate('category', 'name');
        if (!item) {
            return res.status(404).json({ message: 'Menu item not found' });
        }
        res.json(item);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   POST /api/menu
// @desc    Create menu item
// @access  Private/Admin
router.post('/', protect, admin, upload.single('image'), upload.processAndUploadToR2('uploads'), async (req, res) => {
    try {
        const {
            name, description, price, category, isVeg,
            isBestSeller, isNewItem, isRecommended, isUpsell, tags,
            preparationTime, stockQuantity
        } = req.body;

        // If setting this item as upsell, unset any existing upsell
        if (isUpsell === 'true' || isUpsell === true) {
            await MenuItem.updateMany({}, { isUpsell: false });
        }

        const item = new MenuItem({
            name,
            description,
            price,
            category,
            isVeg: isVeg === 'true' || isVeg === true,
            isBestSeller: isBestSeller === 'true' || isBestSeller === true,
            isNewItem: isNewItem === 'true' || isNewItem === true,
            isRecommended: isRecommended === 'true' || isRecommended === true,
            isUpsell: isUpsell === 'true' || isUpsell === true,
            tags: tags ? JSON.parse(tags) : [],
            preparationTime: preparationTime || 15,
            stockQuantity: stockQuantity || -1,
            image: req.fileUrl || ''
        });

        await item.save();
        const populatedItem = await MenuItem.findById(item._id).populate('category', 'name');
        res.status(201).json(populatedItem);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   PUT /api/menu/:id
// @desc    Update menu item
// @access  Private/Admin
router.put('/:id', protect, admin, upload.single('image'), upload.processAndUploadToR2('uploads'), async (req, res) => {
    try {
        const item = await MenuItem.findById(req.params.id);
        if (!item) {
            return res.status(404).json({ message: 'Menu item not found' });
        }

        const fields = ['name', 'description', 'price', 'category', 'preparationTime', 'stockQuantity'];
        const boolFields = ['isVeg', 'isAvailable', 'isBestSeller', 'isNewItem', 'isRecommended', 'isUpsell'];

        fields.forEach(field => {
            if (req.body[field] !== undefined) {
                item[field] = req.body[field];
            }
        });

        // Check if isUpsell is being set to true for this item
        if (req.body.isUpsell === 'true' || req.body.isUpsell === true) {
            // If so, unset isUpsell for all other items
            await MenuItem.updateMany({ _id: { $ne: item._id } }, { isUpsell: false });
        }

        boolFields.forEach(field => {
            if (req.body[field] !== undefined) {
                item[field] = req.body[field] === 'true' || req.body[field] === true;
            }
        });

        if (req.body.tags) {
            item.tags = JSON.parse(req.body.tags);
        }

        if (req.fileUrl) {
            item.image = req.fileUrl;
        }

        await item.save();
        const populatedItem = await MenuItem.findById(item._id).populate('category', 'name');
        res.json(populatedItem);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   PUT /api/menu/:id/stock
// @desc    Update stock status
// @access  Private/Admin
router.put('/:id/stock', protect, admin, async (req, res) => {
    try {
        const { isAvailable, stockQuantity } = req.body;

        const item = await MenuItem.findById(req.params.id);
        if (!item) {
            return res.status(404).json({ message: 'Menu item not found' });
        }

        if (isAvailable !== undefined) {
            item.isAvailable = isAvailable;
        }
        if (stockQuantity !== undefined) {
            item.stockQuantity = stockQuantity;
        }

        await item.save();
        res.json(item);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   DELETE /api/menu/:id
// @desc    Delete menu item
// @access  Private/Admin
router.delete('/:id', protect, admin, async (req, res) => {
    try {
        const item = await MenuItem.findByIdAndDelete(req.params.id);
        if (!item) {
            return res.status(404).json({ message: 'Menu item not found' });
        }
        res.json({ message: 'Menu item deleted' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;
