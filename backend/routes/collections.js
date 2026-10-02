const express = require('express');
const router = express.Router();
const Collection = require('../models/Collection');
const { protect, admin } = require('../middleware/auth');

const MenuItem = require('../models/MenuItem');

// Get all collections (public - for homepage)
router.get('/', async (req, res) => {
    try {
        const { homepage } = req.query;

        let query = { isActive: true };
        if (homepage === 'true') {
            query.showOnHomepage = true;
        }

        const collections = await Collection.find(query)
            .populate({
                path: 'products',
                populate: { path: 'category', select: 'name' }
            })
            .sort({ order: 1, createdAt: -1 });

        // For system collections (bestseller, new, recommended), if products are empty, 
        // fetch them dynamically from MenuItem model
        const populatedCollections = await Promise.all(collections.map(async (col) => {
            const collectionObj = col.toObject();

            if (collectionObj.products.length === 0) {
                if (col.type === 'bestseller') {
                    collectionObj.products = await MenuItem.find({ isBestseller: true, isActive: true }).populate('category', 'name').limit(10);
                } else if (col.type === 'new') {
                    collectionObj.products = await MenuItem.find({ isNew: true, isActive: true }).populate('category', 'name').limit(10);
                } else if (col.type === 'recommended') {
                    collectionObj.products = await MenuItem.find({ isRecommended: true, isActive: true }).populate('category', 'name').limit(10);
                }
            }
            return collectionObj;
        }));

        res.json(populatedCollections);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// Admin: Get all collections (including inactive) - MUST come before /:slug
router.get('/admin/all', protect, admin, async (req, res) => {
    try {
        const collections = await Collection.find()
            .populate('products', 'name price image')
            .sort({ order: 1, createdAt: -1 });

        // Also populate dynamic products for admin view if list is empty
        const populatedCollections = await Promise.all(collections.map(async (col) => {
            const collectionObj = col.toObject();
            if (collectionObj.products.length === 0) {
                if (col.type === 'bestseller') {
                    collectionObj.products = await MenuItem.find({ isBestseller: true, isActive: true }).select('name price image').limit(10);
                } else if (col.type === 'new') {
                    collectionObj.products = await MenuItem.find({ isNew: true, isActive: true }).select('name price image').limit(10);
                } else if (col.type === 'recommended') {
                    collectionObj.products = await MenuItem.find({ isRecommended: true, isActive: true }).select('name price image').limit(10);
                }
            }
            return collectionObj;
        }));

        res.json(populatedCollections);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// Get single collection by slug
router.get('/:slug', async (req, res) => {
    try {
        const collection = await Collection.findOne({ slug: req.params.slug })
            .populate({
                path: 'products',
                populate: { path: 'category', select: 'name' }
            });

        if (!collection) {
            return res.status(404).json({ message: 'Collection not found' });
        }

        res.json(collection);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// Admin: Create collection
router.post('/', protect, admin, async (req, res) => {
    try {
        console.log('Creating collection with body:', req.body);
        const { name, icon, description, showOnHomepage, order, type } = req.body;

        if (!name) {
            return res.status(400).json({ message: 'Collection name is required' });
        }

        const collection = new Collection({
            name,
            icon: icon || '🍽️',
            description: description || '',
            showOnHomepage: showOnHomepage !== false,
            order: parseInt(order) || 0,
            type: type || 'custom'
        });

        await collection.save();
        console.log('Collection created successfully:', collection._id);
        res.status(201).json(collection);
    } catch (error) {
        console.error('Error in create collection:', error);
        res.status(400).json({ message: error.message });
    }
});

// Admin: Update collection
router.put('/:id', protect, admin, async (req, res) => {
    try {
        console.log('Updating collection:', req.params.id, 'with body:', req.body);
        const { name, icon, description, isActive, showOnHomepage, order } = req.body;

        const collection = await Collection.findById(req.params.id);
        if (!collection) {
            return res.status(404).json({ message: 'Collection not found' });
        }

        if (name) collection.name = name;
        if (icon) collection.icon = icon;
        if (description !== undefined) collection.description = description;
        if (isActive !== undefined) collection.isActive = isActive;
        if (showOnHomepage !== undefined) collection.showOnHomepage = showOnHomepage;
        if (order !== undefined) collection.order = order;

        await collection.save();
        console.log('Collection updated successfully:', collection._id);
        res.json(collection);
    } catch (error) {
        console.error('Error in update collection:', error);
        res.status(400).json({ message: error.message });
    }
});

// Admin: Add product(s) to collection
router.post('/:id/products', protect, admin, async (req, res) => {
    try {
        console.log('Adding products to collection:', req.params.id, 'Data:', req.body);
        const { productId, productIds } = req.body;
        const idsToAdd = productIds || (productId ? [productId] : []);

        if (idsToAdd.length === 0) {
            return res.status(400).json({ message: 'No product IDs provided' });
        }

        const collection = await Collection.findById(req.params.id);
        if (!collection) {
            return res.status(404).json({ message: 'Collection not found' });
        }

        let addedCount = 0;
        idsToAdd.forEach(id => {
            if (!collection.products.includes(id)) {
                collection.products.push(id);
                addedCount++;
            }
        });

        if (addedCount > 0) {
            await collection.save();
        }

        const populatedCollection = await Collection.findById(req.params.id).populate({
            path: 'products',
            populate: { path: 'category', select: 'name' }
        });

        console.log(`Successfully added ${addedCount} products to collection`);
        res.json(populatedCollection);
    } catch (error) {
        console.error('Error adding products:', error);
        res.status(400).json({ message: error.message });
    }
});

// Admin: Remove product from collection
router.delete('/:id/products/:productId', protect, admin, async (req, res) => {
    try {
        const collection = await Collection.findById(req.params.id);
        if (!collection) {
            return res.status(404).json({ message: 'Collection not found' });
        }

        collection.products = collection.products.filter(
            p => p.toString() !== req.params.productId
        );
        await collection.save();

        await collection.populate({
            path: 'products',
            populate: { path: 'category', select: 'name' }
        });

        res.json(collection);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

// Admin: Delete collection
router.delete('/:id', protect, admin, async (req, res) => {
    try {
        const collection = await Collection.findByIdAndDelete(req.params.id);
        if (!collection) {
            return res.status(404).json({ message: 'Collection not found' });
        }

        res.json({ message: 'Collection deleted successfully' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

module.exports = router;
