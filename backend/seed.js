require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');
const Category = require('./models/Category');
const MenuItem = require('./models/MenuItem');
const Coupon = require('./models/Coupon');
const Inventory = require('./models/Inventory');
const Employee = require('./models/Employee');
const Table = require('./models/Table');

const seedData = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB Atlas');

        // Clear existing data
        await Promise.all([
            User.deleteMany({}),
            Category.deleteMany({}),
            MenuItem.deleteMany({}),
            Coupon.deleteMany({}),
            Inventory.deleteMany({}),
            Employee.deleteMany({}),
            Table.deleteMany({})
        ]);
        console.log('Cleared existing data');

        // Create Admin User
        const admin = await User.create({
            phone: '9999999999',
            name: 'Admin',
            email: 'admin@example.com',
            role: 'admin',
            isVerified: true
        });
        console.log('Admin user created');

        // Create Categories
        const categories = await Category.insertMany([
            { name: 'Dosa', description: 'Crispy South Indian crepes', order: 1 },
            { name: 'Idli', description: 'Soft steamed rice cakes', order: 2 },
            { name: 'Vada', description: 'Crispy fried lentil donuts', order: 3 },
            { name: 'Uttapam', description: 'Thick savory pancakes', order: 4 },
            { name: 'Beverages', description: 'Hot and cold drinks', order: 5 },
            { name: 'Sweets', description: 'Traditional Indian desserts', order: 6 },
            { name: 'Combos', description: 'Value meal combinations', order: 7 }
        ]);
        console.log('Categories created:', categories.length);

        // Get category IDs
        const dosaId = categories.find(c => c.name === 'Dosa')._id;
        const idliId = categories.find(c => c.name === 'Idli')._id;
        const vadaId = categories.find(c => c.name === 'Vada')._id;
        const uttapamId = categories.find(c => c.name === 'Uttapam')._id;
        const beveragesId = categories.find(c => c.name === 'Beverages')._id;
        const sweetsId = categories.find(c => c.name === 'Sweets')._id;
        const combosId = categories.find(c => c.name === 'Combos')._id;

        // Create Menu Items
        const menuItems = await MenuItem.insertMany([
            // Dosas
            { name: 'Plain Dosa', description: 'Classic crispy dosa', price: 60, category: dosaId, isVeg: true, isBestSeller: true },
            { name: 'Masala Dosa', description: 'Dosa with spiced potato filling', price: 80, category: dosaId, isVeg: true, isBestSeller: true },
            { name: 'Ghee Roast Dosa', description: 'Extra crispy dosa with ghee', price: 90, category: dosaId, isVeg: true },
            { name: 'Mysore Masala Dosa', description: 'Spicy red chutney with masala', price: 100, category: dosaId, isVeg: true, isBestSeller: true },
            { name: 'Rava Dosa', description: 'Crispy semolina dosa', price: 85, category: dosaId, isVeg: true },
            { name: 'Onion Dosa', description: 'Dosa topped with onions', price: 75, category: dosaId, isVeg: true },
            { name: 'Paper Dosa', description: 'Extra thin and crispy', price: 90, category: dosaId, isVeg: true },
            { name: 'Set Dosa', description: 'Soft spongy dosas (3 pcs)', price: 70, category: dosaId, isVeg: true },
            { name: 'Cheese Dosa', description: 'Dosa with melted cheese', price: 110, category: dosaId, isVeg: true, isNew: true },
            { name: 'Paneer Dosa', description: 'Dosa with paneer filling', price: 120, category: dosaId, isVeg: true, isNew: true },

            // Idlis
            { name: 'Idli (2 pcs)', description: 'Soft steamed rice cakes', price: 40, category: idliId, isVeg: true },
            { name: 'Idli (4 pcs)', description: 'Soft steamed rice cakes', price: 70, category: idliId, isVeg: true, isBestSeller: true },
            { name: 'Ghee Podi Idli', description: 'Idli with ghee and spice powder', price: 80, category: idliId, isVeg: true },
            { name: 'Mini Idli Sambar', description: 'Small idlis in sambar', price: 90, category: idliId, isVeg: true, isBestSeller: true },
            { name: 'Rava Idli', description: 'Semolina idli', price: 60, category: idliId, isVeg: true },

            // Vadas
            { name: 'Medu Vada (2 pcs)', description: 'Crispy lentil donuts', price: 50, category: vadaId, isVeg: true, isBestSeller: true },
            { name: 'Sambar Vada', description: 'Vada soaked in sambar', price: 60, category: vadaId, isVeg: true },
            { name: 'Curd Vada', description: 'Vada with curd and spices', price: 65, category: vadaId, isVeg: true },
            { name: 'Masala Vada', description: 'Spiced chana dal vada', price: 55, category: vadaId, isVeg: true },

            // Uttapam
            { name: 'Plain Uttapam', description: 'Thick savory pancake', price: 65, category: uttapamId, isVeg: true },
            { name: 'Onion Uttapam', description: 'Topped with onions', price: 75, category: uttapamId, isVeg: true, isBestSeller: true },
            { name: 'Tomato Uttapam', description: 'Topped with tomatoes', price: 75, category: uttapamId, isVeg: true },
            { name: 'Mixed Uttapam', description: 'Onion, tomato & capsicum', price: 85, category: uttapamId, isVeg: true },

            // Beverages
            { name: 'Filter Coffee', description: 'Traditional South Indian coffee', price: 30, category: beveragesId, isVeg: true, isBestSeller: true },
            { name: 'Masala Tea', description: 'Spiced Indian tea', price: 25, category: beveragesId, isVeg: true },
            { name: 'Badam Milk', description: 'Almond flavored milk', price: 50, category: beveragesId, isVeg: true },
            { name: 'Lassi', description: 'Sweet yogurt drink', price: 45, category: beveragesId, isVeg: true },
            { name: 'Buttermilk', description: 'Spiced traditional chaas', price: 30, category: beveragesId, isVeg: true },
            { name: 'Water Bottle', description: '500ml packaged water', price: 20, category: beveragesId, isVeg: true, isRecommended: true },
            { name: 'Soft Drink', description: 'Cola / Sprite / Fanta', price: 40, category: beveragesId, isVeg: true, isRecommended: true },

            // Sweets
            { name: 'Gulab Jamun (2 pcs)', description: 'Sweet milk dumplings', price: 50, category: sweetsId, isVeg: true },
            { name: 'Rasmalai (2 pcs)', description: 'Cottage cheese in milk', price: 70, category: sweetsId, isVeg: true },
            { name: 'Kesari', description: 'Semolina sweet', price: 45, category: sweetsId, isVeg: true },
            { name: 'Payasam', description: 'Rice pudding', price: 55, category: sweetsId, isVeg: true, isNew: true },

            // Combos
            { name: 'Breakfast Combo', description: '2 Idli + 1 Vada + Coffee', price: 99, category: combosId, isVeg: true, isBestSeller: true },
            { name: 'Dosa Combo', description: 'Masala Dosa + Coffee', price: 99, category: combosId, isVeg: true, isBestSeller: true },
            { name: 'Family Pack', description: '4 Dosa + 4 Idli + 2 Vada', price: 350, category: combosId, isVeg: true },
            { name: 'Mini Meals', description: 'Rice + Sambar + Curd + Papad', price: 120, category: combosId, isVeg: true }
        ]);
        console.log('Menu items created:', menuItems.length);

        // Create Coupons
        const coupons = await Coupon.insertMany([
            {
                code: 'WELCOME10',
                description: 'Get 10% off on your first order',
                discountType: 'percentage',
                discountValue: 10,
                minOrderAmount: 100,
                maxDiscount: 50,
                validFrom: new Date(),
                validUntil: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
                isActive: true
            },
            {
                code: 'DOSA20',
                description: 'Flat ₹20 off on all dosas',
                discountType: 'fixed',
                discountValue: 20,
                minOrderAmount: 80,
                validFrom: new Date(),
                validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                isActive: true
            },
            {
                code: 'COMBO50',
                description: 'Get ₹50 off on combo meals',
                discountType: 'fixed',
                discountValue: 50,
                minOrderAmount: 200,
                validFrom: new Date(),
                validUntil: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
                isActive: true
            },
            {
                code: 'FAMILY15',
                description: '15% off on orders above ₹500',
                discountType: 'percentage',
                discountValue: 15,
                minOrderAmount: 500,
                maxDiscount: 150,
                validFrom: new Date(),
                validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                isActive: true
            }
        ]);
        console.log('Coupons created:', coupons.length);

        // Create Inventory Items
        const inventory = await Inventory.insertMany([
            { name: 'Rice', category: 'ingredient', unit: 'kg', currentStock: 50, minimumStock: 20, costPerUnit: 45, supplier: 'Local Supplier' },
            { name: 'Urad Dal', category: 'ingredient', unit: 'kg', currentStock: 25, minimumStock: 10, costPerUnit: 120, supplier: 'Local Supplier' },
            { name: 'Potato', category: 'ingredient', unit: 'kg', currentStock: 30, minimumStock: 15, costPerUnit: 30, supplier: 'Vegetable Market' },
            { name: 'Onion', category: 'ingredient', unit: 'kg', currentStock: 20, minimumStock: 10, costPerUnit: 35, supplier: 'Vegetable Market' },
            { name: 'Tomato', category: 'ingredient', unit: 'kg', currentStock: 15, minimumStock: 8, costPerUnit: 40, supplier: 'Vegetable Market' },
            { name: 'Ghee', category: 'ingredient', unit: 'kg', currentStock: 10, minimumStock: 5, costPerUnit: 550, supplier: 'Dairy Supplier' },
            { name: 'Coconut Oil', category: 'ingredient', unit: 'liter', currentStock: 15, minimumStock: 8, costPerUnit: 180, supplier: 'Oil Supplier' },
            { name: 'Coffee Powder', category: 'ingredient', unit: 'kg', currentStock: 5, minimumStock: 2, costPerUnit: 400, supplier: 'Coffee Supplier' },
            { name: 'Sugar', category: 'ingredient', unit: 'kg', currentStock: 20, minimumStock: 10, costPerUnit: 45, supplier: 'Local Supplier' },
            { name: 'Salt', category: 'ingredient', unit: 'kg', currentStock: 10, minimumStock: 5, costPerUnit: 20, supplier: 'Local Supplier' },
            { name: 'Chana Dal', category: 'ingredient', unit: 'kg', currentStock: 8, minimumStock: 5, costPerUnit: 90, supplier: 'Local Supplier' },
            { name: 'Mustard Seeds', category: 'ingredient', unit: 'kg', currentStock: 2, minimumStock: 1, costPerUnit: 150, supplier: 'Spice Supplier' },
            { name: 'Paper Napkins', category: 'packaging', unit: 'pack', currentStock: 50, minimumStock: 20, costPerUnit: 25, supplier: 'Packaging Supplier' },
            { name: 'Takeaway Boxes', category: 'packaging', unit: 'pack', currentStock: 100, minimumStock: 50, costPerUnit: 150, supplier: 'Packaging Supplier' },
            { name: 'Water Bottles', category: 'other', unit: 'pieces', currentStock: 100, minimumStock: 50, costPerUnit: 10, supplier: 'Beverage Supplier' }
        ]);
        console.log('Inventory items created:', inventory.length);

        // Create Employees
        const employees = await Employee.insertMany([
            { name: 'Raju Kumar', phone: '9876543210', role: 'chef', salary: 25000, email: 'raju@example.com' },
            { name: 'Suresh Nair', phone: '9876543211', role: 'chef', salary: 22000, email: 'suresh@example.com' },
            { name: 'Priya Sharma', phone: '9876543212', role: 'waiter', salary: 15000, email: 'priya@example.com' },
            { name: 'Ankit Verma', phone: '9876543213', role: 'waiter', salary: 15000, email: 'ankit@example.com' },
            { name: 'Meena Devi', phone: '9876543214', role: 'cashier', salary: 18000, email: 'meena@example.com' },
            { name: 'Ramesh Iyer', phone: '9876543215', role: 'manager', salary: 35000, email: 'ramesh@example.com' },
            { name: 'Sunita Kumari', phone: '9876543216', role: 'cleaner', salary: 12000 }
        ]);
        console.log('Employees created:', employees.length);

        // Create Tables
        const tables = [];
        for (let i = 1; i <= 12; i++) {
            tables.push({ tableNumber: i.toString(), capacity: i <= 4 ? 2 : i <= 8 ? 4 : 6 });
        }
        const createdTables = await Table.insertMany(tables);
        console.log('Tables created:', createdTables.length);

        console.log('\n✅ Database seeded successfully!');
        console.log('\n📊 Summary:');
        console.log('- Admin: phone: 9999999999, password: value of ADMIN_PASSWORD');
        console.log('- Categories:', categories.length);
        console.log('- Menu Items:', menuItems.length);
        console.log('- Coupons:', coupons.length);
        console.log('- Inventory Items:', inventory.length);
        console.log('- Employees:', employees.length);
        console.log('- Tables:', createdTables.length);

        process.exit(0);
    } catch (error) {
        console.error('Error seeding database:', error);
        process.exit(1);
    }
};

seedData();
