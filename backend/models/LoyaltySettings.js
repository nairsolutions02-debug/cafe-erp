const mongoose = require('mongoose');

const loyaltySettingsSchema = new mongoose.Schema({
    // Points earning rules
    pointsPerRupee: {
        type: Number,
        default: 1 // 1 point per ₹1 spent
    },
    minOrderForPoints: {
        type: Number,
        default: 100 // Minimum order value to earn points
    },

    // Points redemption rules
    pointsToRupeeRatio: {
        type: Number,
        default: 10 // 10 points = ₹1 discount
    },
    minPointsToRedeem: {
        type: Number,
        default: 100 // Minimum points required to redeem
    },
    maxRedemptionPercent: {
        type: Number,
        default: 50 // Max 50% of order can be paid with points
    },

    // Status
    isActive: {
        type: Boolean,
        default: true
    }
}, { timestamps: true });

// Ensure only one settings document
loyaltySettingsSchema.statics.getSettings = async function () {
    let settings = await this.findOne();
    if (!settings) {
        settings = await this.create({});
    }
    return settings;
};

module.exports = mongoose.model('LoyaltySettings', loyaltySettingsSchema);
