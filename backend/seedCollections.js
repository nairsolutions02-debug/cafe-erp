const mongoose = require('mongoose');
require('dotenv').config();
const Collection = require('./models/Collection');
const MenuItem = require('./models/MenuItem');

const seedCollections = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB');

        // Check if default collections exist
        const existingCollections = await Collection.find({ type: { $ne: 'custom' } });

        if (existingCollections.length === 0) {
            console.log('Creating default collections...');

            // Get menu items for each type
            const bestsellers = await MenuItem.find({ bestseller: true, inStock: true }).limit(10);
            const newItems = await MenuItem.find({ isNew: true, inStock: true }).limit(10);
            const recommended = await MenuItem.find({ recommended: true, inStock: true }).limit(10);

            // Create default collections
            const collections = [
                {
                    name: 'Bestsellers',
                    slug: 'bestsellers',
                    icon: '🔥',
                    description: 'Our most popular dishes loved by customers',
                    type: 'bestseller',
                    order: 1,
                    showOnHomepage: true,
                    products: bestsellers.map(item => item._id)
                },
                {
                    name: 'New Arrivals',
                    slug: 'new-arrivals',
                    icon: '✨',
                    description: 'Fresh additions to our menu',
                    type: 'new',
                    order: 2,
                    showOnHomepage: true,
                    products: newItems.map(item => item._id)
                },
                {
                    name: "Don't Forget",
                    slug: 'recommended',
                    icon: '💡',
                    description: 'Recommended items you might love',
                    type: 'recommended',
                    order: 99,
                    showOnHomepage: true,
                    products: recommended.map(item => item._id)
                }
            ];

            await Collection.insertMany(collections);
            console.log('Default collections created successfully!');
        } else {
            console.log('Default collections already exist. Updating products...');

            // Update products in existing collections
            for (const collection of existingCollections) {
                let products = [];

                if (collection.type === 'bestseller') {
                    products = await MenuItem.find({ bestseller: true, inStock: true }).limit(10);
                } else if (collection.type === 'new') {
                    products = await MenuItem.find({ isNew: true, inStock: true }).limit(10);
                } else if (collection.type === 'recommended') {
                    products = await MenuItem.find({ recommended: true, inStock: true }).limit(10);
                }

                collection.products = products.map(item => item._id);
                await collection.save();
                console.log(`Updated ${collection.name} with ${products.length} products`);
            }
        }

        console.log('Seed completed!');
        process.exit(0);
    } catch (error) {
        console.error('Seed error:', error);
        process.exit(1);
    }
};

seedCollections();
