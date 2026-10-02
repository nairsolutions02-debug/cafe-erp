const express = require('express');
const router = express.Router();
const Order = require('../models/Order');
const User = require('../models/User');
const Settings = require('../models/Settings');
const { protect, admin } = require('../middleware/auth');
const { getDateRange } = require('../utils/helpers');

// @route   GET /api/analytics/customers
// @desc    Get all customers with spending data (searchable, sortable)
// @access  Private/Admin
router.get('/customers', protect, admin, async (req, res) => {
    try {
        const { search, sortBy = 'totalSpent', order = 'desc', page = 1, limit = 20 } = req.query;

        // Build match query for search
        let searchMatch = { role: 'customer' };
        if (search) {
            searchMatch.$or = [
                { name: { $regex: search, $options: 'i' } },
                { phone: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } }
            ];
        }

        // Get all customers with their order stats
        const customers = await User.aggregate([
            { $match: searchMatch },
            {
                $lookup: {
                    from: 'orders',
                    localField: '_id',
                    foreignField: 'user',
                    as: 'orders'
                }
            },
            {
                $addFields: {
                    totalOrders: { $size: '$orders' },
                    totalSpent: {
                        $sum: {
                            $map: {
                                input: {
                                    $filter: {
                                        input: '$orders',
                                        as: 'order',
                                        cond: { $eq: ['$$order.status', 'paid'] }
                                    }
                                },
                                as: 'paidOrder',
                                in: '$$paidOrder.total'
                            }
                        }
                    },
                    paidOrders: {
                        $size: {
                            $filter: {
                                input: '$orders',
                                as: 'order',
                                cond: { $eq: ['$$order.status', 'paid'] }
                            }
                        }
                    },
                    lastOrderDate: { $max: '$orders.createdAt' }
                }
            },
            {
                $project: {
                    name: 1,
                    phone: 1,
                    email: 1,
                    loyaltyPoints: 1,
                    totalPointsEarned: 1,
                    totalOrders: 1,
                    paidOrders: 1,
                    totalSpent: 1,
                    lastOrderDate: 1,
                    createdAt: 1
                }
            },
            { $sort: { [sortBy]: order === 'desc' ? -1 : 1 } },
            { $skip: (parseInt(page) - 1) * parseInt(limit) },
            { $limit: parseInt(limit) }
        ]);

        const totalCount = await User.countDocuments(searchMatch);

        res.json({
            customers,
            pagination: {
                total: totalCount,
                page: parseInt(page),
                pages: Math.ceil(totalCount / parseInt(limit))
            }
        });
    } catch (error) {
        console.error('Customer analytics error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   GET /api/analytics/customer/:id
router.get('/customer/:id', protect, admin, async (req, res) => {
    try {
        const user = await User.findById(req.params.id).select('-otp -otpExpiry');
        if (!user) return res.status(404).json({ message: 'Customer not found' });

        const orders = await Order.find({ user: req.params.id })
            .populate('items.menuItem', 'name image price')
            .sort({ createdAt: -1 });

        const paidOrders = orders.filter(o => o.status === 'paid');
        const totalSpent = paidOrders.reduce((sum, o) => sum + o.total, 0);
        const avgOrderValue = paidOrders.length > 0 ? totalSpent / paidOrders.length : 0;

        const itemCounts = {};
        paidOrders.forEach(order => {
            order.items.forEach(item => {
                const name = item.name;
                if (!itemCounts[name]) itemCounts[name] = { name, count: 0, total: 0 };
                itemCounts[name].count += item.quantity;
                itemCounts[name].total += item.total;
            });
        });
        const favoriteItems = Object.values(itemCounts).sort((a, b) => b.count - a.count).slice(0, 5);

        const ordersByMonth = {};
        paidOrders.forEach(order => {
            const month = new Date(order.createdAt).toLocaleString('en-IN', { month: 'short', year: 'numeric' });
            if (!ordersByMonth[month]) ordersByMonth[month] = { orders: 0, spent: 0 };
            ordersByMonth[month].orders++;
            ordersByMonth[month].spent += order.total;
        });

        res.json({
            customer: user,
            stats: {
                totalOrders: orders.length,
                paidOrders: paidOrders.length,
                totalSpent,
                avgOrderValue,
                lastOrderDate: orders.length > 0 ? orders[0].createdAt : null
            },
            favoriteItems,
            ordersByMonth: Object.entries(ordersByMonth).map(([month, data]) => ({ month, ...data })),
            recentOrders: orders.slice(0, 10)
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

// Get dashboard stats
router.get('/dashboard', protect, admin, async (req, res) => {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const todayOrders = await Order.find({
            createdAt: { $gte: today, $lt: tomorrow },
            status: 'paid'
        });

        const todayRevenue = todayOrders.reduce((sum, order) => sum + order.total, 0);
        const todayOrderCount = todayOrders.length;

        const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
        const monthOrders = await Order.find({
            createdAt: { $gte: monthStart },
            status: 'paid'
        });

        const monthRevenue = monthOrders.reduce((sum, order) => sum + order.total, 0);
        const monthOrderCount = monthOrders.length;

        const pendingOrders = await Order.countDocuments({
            status: { $in: ['pending', 'confirmed', 'preparing', 'ready'] }
        });

        res.json({
            today: { revenue: todayRevenue, orders: todayOrderCount },
            month: { revenue: monthRevenue, orders: monthOrderCount },
            pendingOrders
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

// Get revenue chart data
router.get('/revenue', protect, admin, async (req, res) => {
    try {
        const { period = 'week' } = req.query;
        const startDate = getDateRange(period);

        // Get profit margin from settings (default to 30%)
        const profitMargin = await Settings.getSetting('profit_margin', 30) / 100;

        const orders = await Order.aggregate([
            { $match: { createdAt: { $gte: startDate }, status: 'paid' } },
            {
                $group: {
                    _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
                    revenue: { $sum: '$total' },
                    orders: { $sum: 1 },
                    profit: { $sum: { $multiply: ['$total', profitMargin] } }
                }
            },
            { $sort: { _id: 1 } }
        ]);

        res.json(orders);
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

// Get category-wise sales
router.get('/category-sales', protect, admin, async (req, res) => {
    try {
        const { period = 'month' } = req.query;
        const startDate = getDateRange(period);

        const sales = await Order.aggregate([
            { $match: { createdAt: { $gte: startDate }, status: 'paid' } },
            { $unwind: '$items' },
            {
                $lookup: {
                    from: 'menuitems',
                    localField: 'items.menuItem',
                    foreignField: '_id',
                    as: 'menuItemData'
                }
            },
            { $unwind: '$menuItemData' },
            {
                $lookup: {
                    from: 'categories',
                    localField: 'menuItemData.category',
                    foreignField: '_id',
                    as: 'categoryData'
                }
            },
            { $unwind: '$categoryData' },
            {
                $group: {
                    _id: '$categoryData.name',
                    total: { $sum: '$items.total' },
                    count: { $sum: '$items.quantity' }
                }
            }
        ]);

        res.json(sales);
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

// Get top selling items
router.get('/top-items', protect, admin, async (req, res) => {
    try {
        const topItems = await Order.aggregate([
            { $match: { status: 'paid' } },
            { $unwind: '$items' },
            {
                $group: {
                    _id: '$items.menuItem',
                    name: { $first: '$items.name' },
                    totalQuantity: { $sum: '$items.quantity' },
                    totalRevenue: { $sum: '$items.total' }
                }
            },
            { $sort: { totalQuantity: -1 } },
            { $limit: 10 }
        ]);

        res.json(topItems);
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

// Get user analytics
router.get('/users', protect, admin, async (req, res) => {
    try {
        const { period = 'month' } = req.query;
        const startDate = getDateRange(period);

        const totalUsers = await User.countDocuments({ role: 'customer' });
        const newUsers = await User.countDocuments({ role: 'customer', createdAt: { $gte: startDate } });

        const activeUsersData = await Order.aggregate([
            { $match: { createdAt: { $gte: startDate }, status: 'paid' } },
            { $group: { _id: '$user' } }
        ]);
        const activeUsers = activeUsersData.length;

        const returningCustomersData = await Order.aggregate([
            { $match: { status: 'paid' } },
            { $group: { _id: '$user', orderCount: { $sum: 1 } } },
            { $match: { orderCount: { $gt: 1 } } }
        ]);
        const returningCustomers = returningCustomersData.length;

        const userGrowth = await User.aggregate([
            { $match: { role: 'customer', createdAt: { $gte: startDate } } },
            { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } },
            { $sort: { _id: 1 } }
        ]);

        const topCustomers = await Order.aggregate([
            { $match: { status: { $ne: 'cancelled' } } },
            { $group: { _id: '$user', orderCount: { $sum: 1 }, totalSpent: { $sum: '$total' } } },
            { $sort: { totalSpent: -1 } },
            { $limit: 5 },
            { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'userInfo' } },
            { $unwind: '$userInfo' },
            { $project: { name: '$userInfo.name', phone: '$userInfo.phone', orderCount: 1, totalSpent: 1 } }
        ]);

        res.json({
            totalUsers, newUsers, activeUsers, returningCustomers,
            userGrowth: userGrowth.map(u => ({
                date: new Date(u._id).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
                users: u.count
            })),
            topCustomers
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

// Order search
router.get('/orders/search', protect, admin, async (req, res) => {
    try {
        const { search, status, startDate, endDate, minAmount, maxAmount, page = 1, limit = 20 } = req.query;
        let matchQuery = {};

        if (startDate || endDate) {
            matchQuery.createdAt = {};
            if (startDate) matchQuery.createdAt.$gte = new Date(startDate);
            if (endDate) matchQuery.createdAt.$lte = new Date(endDate);
        }
        if (status) matchQuery.status = status;
        if (minAmount || maxAmount) {
            matchQuery.total = {};
            if (minAmount) matchQuery.total.$gte = parseFloat(minAmount);
            if (maxAmount) matchQuery.total.$lte = parseFloat(maxAmount);
        }

        let orders = await Order.find(matchQuery)
            .populate('user', 'name phone email')
            .populate('items.menuItem', 'name')
            .sort({ createdAt: -1 });

        if (search) {
            const searchLower = search.toLowerCase();
            orders = orders.filter(order => {
                const userName = order.user?.name?.toLowerCase() || '';
                const userPhone = order.user?.phone || '';
                const orderId = order._id.toString();
                const orderNum = order.orderNumber?.toString() || '';
                return userName.includes(searchLower) || userPhone.includes(search) || orderId.includes(search) || orderNum.includes(search);
            });
        }

        const total = orders.length;
        const startIndex = (parseInt(page) - 1) * parseInt(limit);
        res.json({
            orders: orders.slice(startIndex, startIndex + parseInt(limit)),
            pagination: { total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) }
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;
