const express = require('express');
const router = express.Router();
const Order = require('../models/Order');
const MenuItem = require('../models/MenuItem');
const Coupon = require('../models/Coupon');
const Table = require('../models/Table');
const Settings = require('../models/Settings');
const User = require('../models/User');
const LoyaltySettings = require('../models/LoyaltySettings');
const LoyaltyOffer = require('../models/LoyaltyOffer');
const { protect, admin } = require('../middleware/auth');
const { generateOrderNumber } = require('../utils/helpers');

// @route   GET /api/orders
// @desc    Get user's orders
// @access  Private
router.get('/', protect, async (req, res) => {
    try {
        const orders = await Order.find({ user: req.user._id })
            .populate('items.menuItem', 'name image')
            .sort('-createdAt');
        res.json(orders);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   GET /api/orders/all
// @desc    Get all orders (admin)
// @access  Private/Admin
router.get('/all', protect, admin, async (req, res) => {
    try {
        const { status, date } = req.query;
        let query = {};

        if (status) query.status = status;
        if (date) {
            const startDate = new Date(date);
            startDate.setHours(0, 0, 0, 0);
            const endDate = new Date(date);
            endDate.setHours(23, 59, 59, 999);
            query.createdAt = { $gte: startDate, $lte: endDate };
        }

        const orders = await Order.find(query)
            .populate('user', 'phone name')
            .populate('items.menuItem', 'name image')
            .sort('-createdAt');
        res.json(orders);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   GET /api/orders/active
// @desc    Get active orders for admin
// @access  Private/Admin
router.get('/active', protect, admin, async (req, res) => {
    try {
        const orders = await Order.find({
            status: { $nin: ['paid', 'cancelled'] }
        })
            .populate('user', 'phone name')
            .populate('items.menuItem', 'name image')
            .sort('-createdAt');
        res.json(orders);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   GET /api/orders/current
// @desc    Get current active order for user
// @access  Private
router.get('/current', protect, async (req, res) => {
    try {
        const order = await Order.findOne({
            user: req.user._id,
            status: { $nin: ['paid', 'cancelled'] }
        })
            .populate('items.menuItem', 'name image price')
            .sort('-createdAt');
        res.json(order);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   GET /api/orders/:id
// @desc    Get order by ID
// @access  Private
router.get('/:id', protect, async (req, res) => {
    try {
        const order = await Order.findById(req.params.id)
            .populate('user', 'phone name')
            .populate('items.menuItem', 'name image price');

        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
        }

        // Check if user owns the order or is admin, or it's a guest order
        if (order.user && order.user._id.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
            return res.status(403).json({ message: 'Not authorized' });
        }

        res.json(order);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   POST /api/orders
// @desc    Create new order
// @access  Private
router.post('/', protect, async (req, res) => {
    try {
        const { items, couponCode, tableId, specialInstructions } = req.body;

        if (!items || items.length === 0) {
            return res.status(400).json({ message: 'No items in order' });
        }

        // Validate table if provided
        let table = null;
        if (tableId) {
            table = await Table.findById(tableId);
            if (!table) {
                return res.status(400).json({ message: 'Invalid table selected' });
            }
            if (table.status !== 'available') {
                return res.status(400).json({ message: 'This table is currently occupied' });
            }
        }

        // Calculate totals
        let subtotal = 0;
        const orderItems = [];

        for (const item of items) {
            const menuItem = await MenuItem.findById(item.menuItem);
            if (!menuItem) {
                return res.status(400).json({ message: `Menu item not found: ${item.menuItem}` });
            }
            if (!menuItem.isAvailable) {
                return res.status(400).json({ message: `${menuItem.name} is not available` });
            }

            const itemTotal = menuItem.price * item.quantity;
            subtotal += itemTotal;

            orderItems.push({
                menuItem: menuItem._id,
                name: menuItem.name,
                price: menuItem.price,
                quantity: item.quantity,
                total: itemTotal
            });
        }

        // Apply coupon if provided
        let discount = 0;
        if (couponCode) {
            const coupon = await Coupon.findOne({
                code: couponCode.toUpperCase(),
                isActive: true,
                validFrom: { $lte: new Date() },
                validUntil: { $gte: new Date() }
            });

            if (coupon) {
                if (coupon.usageLimit !== -1 && coupon.usedCount >= coupon.usageLimit) {
                    return res.status(400).json({ message: 'Coupon usage limit reached' });
                }

                if (subtotal >= coupon.minOrderAmount) {
                    if (coupon.discountType === 'percentage') {
                        discount = (subtotal * coupon.discountValue) / 100;
                        if (coupon.maxDiscount && discount > coupon.maxDiscount) {
                            discount = coupon.maxDiscount;
                        }
                    } else {
                        discount = coupon.discountValue;
                    }

                    // Update coupon usage
                    coupon.usedCount += 1;
                    await coupon.save();
                }
            }
        }

        // Apply loyalty redemption if provided (New)
        let pointsDiscount = 0;
        const { pointsUsed, loyaltyOfferId } = req.body;
        if (pointsUsed && loyaltyOfferId) {
            const offer = await LoyaltyOffer.findById(loyaltyOfferId);
            const user = await User.findById(req.user._id);

            if (offer && offer.isActive && user.loyaltyPoints >= offer.pointsRequired) {
                if (subtotal >= offer.minOrderValue) {
                    pointsDiscount = offer.discountValue;

                    // Deduct points
                    user.loyaltyPoints -= offer.pointsRequired;
                    await user.save();

                    // Add to total discount
                    discount += pointsDiscount;
                }
            }
        }

        // Get tax settings
        const gstRate = await Settings.getSetting('gst_rate', 5);
        const taxConfig = await Settings.getSetting('tax_config', [{ name: 'GST', rate: gstRate }]);

        // Get restaurant info
        const restaurantInfo = {
            name: await Settings.getSetting('restaurant_name', process.env.CAFE_NAME || 'Cafe ERP'),
            address: await Settings.getSetting('restaurant_address', ''),
            phone: await Settings.getSetting('restaurant_phone', ''),
            gstNumber: await Settings.getSetting('gst_number', '')
        };

        const taxableAmount = subtotal - discount;
        const taxDetails = taxConfig.map(t => ({
            name: t.name,
            rate: t.rate,
            amount: taxableAmount * (t.rate / 100)
        }));

        const totalTax = taxDetails.reduce((sum, t) => sum + t.amount, 0);
        const total = taxableAmount + totalTax;

        const order = new Order({
            orderNumber: generateOrderNumber(),
            user: req.user._id,
            items: orderItems,
            subtotal,
            discount,
            couponCode: couponCode || '',
            tax: totalTax,
            gstRate,
            taxDetails,
            restaurantInfo,
            total,
            tableNumber: table ? table.tableNumber : '',
            table: table ? table._id : null,
            specialInstructions: specialInstructions || '',
            loyaltyOffer: (pointsUsed && loyaltyOfferId) ? loyaltyOfferId : null,
            pointsRedeemed: (pointsUsed && loyaltyOfferId) ? pointsUsed : 0,
            status: 'pending'
        });

        await order.save();

        // Occupy the table if selected
        if (table) {
            table.status = 'occupied';
            table.isOccupied = true;
            table.currentOrder = order._id;
            await table.save();

            // Emit table status update
            const io = req.app.get('io');
            if (io) {
                io.emit('table-occupied', table);
            }
        }

        const populatedOrder = await Order.findById(order._id)
            .populate('user', 'phone name')
            .populate('items.menuItem', 'name image');

        // Emit socket event for real-time update
        const io = req.app.get('io');
        if (io) {
            io.emit('new-order', populatedOrder);
        }

        res.status(201).json(populatedOrder);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   PUT /api/orders/:id/status
// @desc    Update order status
// @access  Private/Admin
router.put('/:id/status', protect, admin, async (req, res) => {
    try {
        const { status } = req.body;

        const validStatuses = ['pending', 'confirmed', 'preparing', 'ready', 'served', 'bill_requested', 'bill_generated', 'paid', 'cancelled'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ message: 'Invalid status' });
        }

        const order = await Order.findById(req.params.id);
        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
        }

        order.status = status;
        await order.save();

        // Free the table if order is completed or cancelled
        if ((status === 'paid' || status === 'cancelled') && order.table) {
            await Table.findByIdAndUpdate(order.table, {
                status: 'available',
                isOccupied: false,
                currentOrder: null
            });
        }

        const populatedOrder = await Order.findById(order._id)
            .populate('user', 'phone name')
            .populate('items.menuItem', 'name image');

        // Emit socket event for real-time update
        const io = req.app.get('io');
        if (io) {
            io.emit('order-updated', populatedOrder);
            io.to(`user-${order.user}`).emit('my-order-updated', populatedOrder);
        }

        res.json(populatedOrder);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   PUT /api/orders/:id/request-bill
// @desc    Request bill for order
// @access  Private
// @route   PUT /api/orders/:id/request-bill
// @desc    Request bill for order (and all associated active orders for that table/user)
// @access  Private
router.put('/:id/request-bill', protect, async (req, res) => {
    try {
        const currentOrder = await Order.findById(req.params.id);
        if (!currentOrder) {
            return res.status(404).json({ message: 'Order not found' });
        }

        console.log('Bill Request:', {
            orderId: currentOrder._id,
            orderUser: currentOrder.user,
            currentUser: req.user._id
        });

        // Find query for all associated orders
        let query = {
            status: { $nin: ['paid', 'cancelled', 'bill_requested'] }
        };

        if (currentOrder.table) {
            query.table = currentOrder.table;
        } else {
            query.user = currentOrder.user;
        }

        // Find all orders to update
        const ordersToUpdate = await Order.find(query);

        // Also include the current order if it wasn't picked up (though it should be)
        if (!ordersToUpdate.find(o => o._id.toString() === currentOrder._id.toString())) {
            // If current order status was already bill_requested/generated, we might still want to trigger socket
            ordersToUpdate.push(currentOrder);
        }

        const io = req.app.get('io');
        const updatedOrders = [];

        // Update all identified orders
        for (const order of ordersToUpdate) {
            order.status = 'bill_requested';
            await order.save();

            const populatedOrder = await Order.findById(order._id)
                .populate('user', 'phone name')
                .populate('items.menuItem', 'name image');

            updatedOrders.push(populatedOrder);

            if (io) {
                io.emit('order-updated', populatedOrder);
                io.emit('bill-requested', populatedOrder);
                io.to(`user-${order.user}`).emit('my-order-updated', populatedOrder);
            }
        }

        // Return the current order (updated)
        const finalCurrentOrder = updatedOrders.find(o => o._id.toString() === req.params.id) || await Order.findById(req.params.id).populate('user', 'phone name').populate('items.menuItem', 'name image');

        res.json(finalCurrentOrder);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   PUT /api/orders/:id/payment
// @desc    Update order payment (method and amount)
// @access  Private/Admin
router.put('/:id/payment', protect, admin, async (req, res) => {
    try {
        const { paymentMethod, amountPaid } = req.body;
        const order = await Order.findById(req.params.id).populate('items.menuItem');

        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
        }

        const wasPaid = order.status === 'paid';

        if (paymentMethod) order.paymentMethod = paymentMethod;
        if (amountPaid !== undefined) order.amountPaid = parseFloat(amountPaid);

        // If amount paid is equal or more than total, mark as paid
        if (order.amountPaid >= order.total) {
            order.status = 'paid';
        }

        await order.save();

        // Award loyalty points ONLY if it just transitioned to paid
        if (order.status === 'paid' && !wasPaid) {
            try {
                const loyaltySettings = await LoyaltySettings.getSettings();
                if (loyaltySettings.isActive && order.total >= loyaltySettings.minOrderForPoints) {
                    let pointsEarned = Math.floor(order.total * loyaltySettings.pointsPerRupee);

                    for (const item of order.items) {
                        if (item.menuItem && item.menuItem.bonusLoyaltyPoints) {
                            pointsEarned += item.menuItem.bonusLoyaltyPoints * item.quantity;
                        }
                    }

                    if (pointsEarned > 0) {
                        await User.findByIdAndUpdate(order.user, {
                            $inc: {
                                loyaltyPoints: pointsEarned,
                                totalPointsEarned: pointsEarned
                            }
                        });
                    }
                }
            } catch (loyaltyError) {
                console.error('Error awarding loyalty points:', loyaltyError);
            }

            // Free the table if order had one
            if (order.table) {
                const table = await Table.findById(order.table);
                if (table) {
                    table.status = 'available';
                    table.isOccupied = false;
                    table.currentOrder = null;
                    await table.save();

                    const io = req.app.get('io');
                    if (io) io.emit('table-freed', table);
                }
            }
        }

        const populatedOrder = await Order.findById(order._id)
            .populate('user', 'phone name')
            .populate('items.menuItem', 'name image');

        // Emit socket event
        const io = req.app.get('io');
        if (io) {
            io.emit('order-updated', populatedOrder);
            io.to(`user-${order.user}`).emit('my-order-updated', populatedOrder);
        }

        res.json(populatedOrder);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;
