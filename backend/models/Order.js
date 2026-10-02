const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema({
    menuItem: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'MenuItem',
        required: true
    },
    name: String,
    price: Number,
    quantity: {
        type: Number,
        required: true,
        min: 1
    },
    total: Number
});

const orderSchema = new mongoose.Schema({
    orderNumber: {
        type: String,
        required: true,
        unique: true
    },
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    items: [orderItemSchema],
    subtotal: {
        type: Number,
        required: true
    },
    discount: {
        type: Number,
        default: 0
    },
    couponCode: {
        type: String,
        default: ''
    },
    tax: {
        type: Number,
        default: 0
    },
    gstRate: {
        type: Number,
        default: 5
    },
    taxDetails: [{
        name: String,
        rate: Number,
        amount: Number
    }],
    restaurantInfo: {
        name: String,
        address: String,
        phone: String,
        gstNumber: String
    },
    total: {
        type: Number,
        required: true
    },
    status: {
        type: String,
        enum: ['pending', 'confirmed', 'preparing', 'ready', 'served', 'bill_requested', 'bill_generated', 'paid', 'cancelled'],
        default: 'pending'
    },
    paymentMethod: {
        type: String,
        enum: ['cash', 'online', 'pending'],
        default: 'pending'
    },
    amountPaid: {
        type: Number,
        default: 0
    },
    tableNumber: {
        type: String,
        default: ''
    },
    table: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Table',
        default: null
    },
    specialInstructions: {
        type: String,
        default: ''
    },
    loyaltyOffer: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'LoyaltyOffer',
        default: null
    },
    pointsRedeemed: {
        type: Number,
        default: 0
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

orderSchema.pre('save', function () {
    this.updatedAt = Date.now();
});

module.exports = mongoose.model('Order', orderSchema);
