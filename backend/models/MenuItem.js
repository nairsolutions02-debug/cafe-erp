const mongoose = require('mongoose');

const menuItemSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true
    },
    description: {
        type: String,
        default: ''
    },
    price: {
        type: Number,
        required: true
    },
    image: {
        type: String,
        default: ''
    },
    category: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Category',
        required: true
    },
    isVeg: {
        type: Boolean,
        default: true
    },
    isAvailable: {
        type: Boolean,
        default: true
    },
    isBestSeller: {
        type: Boolean,
        default: false
    },
    isNewItem: {
        type: Boolean,
        default: false
    },
    isRecommended: {
        type: Boolean,
        default: false
    },
    isUpsell: {
        type: Boolean,
        default: false
    },
    tags: [{
        type: String
    }],
    preparationTime: {
        type: Number, // in minutes
        default: 15
    },
    stockQuantity: {
        type: Number,
        default: -1 // -1 means unlimited
    },
    // Loyalty Points bonus for this specific item
    bonusLoyaltyPoints: {
        type: Number,
        default: 0 // Extra points earned when ordering this item
    },
    // Inventory tracking
    initialStock: {
        type: Number,
        default: 0
    },
    lowStockThreshold: {
        type: Number,
        default: 10
    },
    costPrice: {
        type: Number,
        default: 0
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('MenuItem', menuItemSchema);
