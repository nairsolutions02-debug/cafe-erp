const mongoose = require('mongoose');

const loyaltyOfferSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    description: {
        type: String,
        trim: true
    },
    pointsRequired: {
        type: Number,
        required: true,
        min: 1
    },
    discountValue: {
        type: Number, // Flat discount in ₹
        required: true,
        min: 0
    },
    minOrderValue: {
        type: Number,
        default: 0
    },
    isActive: {
        type: Boolean,
        default: true
    }
}, { timestamps: true });

module.exports = mongoose.model('LoyaltyOffer', loyaltyOfferSchema);
