const express = require('express');
const router = express.Router();
const LoyaltySettings = require('../models/LoyaltySettings');
const User = require('../models/User');
const MenuItem = require('../models/MenuItem');
const LoyaltyOffer = require('../models/LoyaltyOffer');
const { protect, admin } = require('../middleware/auth');

// @route   GET /api/loyalty/settings
// @desc    Get loyalty settings
// @access  Public (for displaying in app)
router.get('/settings', async (req, res) => {
    try {
        const settings = await LoyaltySettings.getSettings();
        res.json(settings);
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   PUT /api/loyalty/settings
// @desc    Update loyalty settings
// @access  Private/Admin
router.put('/settings', protect, admin, async (req, res) => {
    try {
        const {
            pointsPerRupee,
            minOrderForPoints,
            pointsToRupeeRatio,
            minPointsToRedeem,
            maxRedemptionPercent,
            isActive
        } = req.body;

        let settings = await LoyaltySettings.findOne();
        if (!settings) {
            settings = new LoyaltySettings();
        }

        if (pointsPerRupee !== undefined) settings.pointsPerRupee = pointsPerRupee;
        if (minOrderForPoints !== undefined) settings.minOrderForPoints = minOrderForPoints;
        if (pointsToRupeeRatio !== undefined) settings.pointsToRupeeRatio = pointsToRupeeRatio;
        if (minPointsToRedeem !== undefined) settings.minPointsToRedeem = minPointsToRedeem;
        if (maxRedemptionPercent !== undefined) settings.maxRedemptionPercent = maxRedemptionPercent;
        if (isActive !== undefined) settings.isActive = isActive;

        await settings.save();
        res.json(settings);
    } catch (error) {
        console.error('Error updating loyalty settings:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   GET /api/loyalty/my-points
// @desc    Get current user's loyalty points
// @access  Private
router.get('/my-points', protect, async (req, res) => {
    try {
        const user = await User.findById(req.user._id).select('loyaltyPoints totalPointsEarned');
        const settings = await LoyaltySettings.getSettings();

        res.json({
            currentPoints: user.loyaltyPoints,
            totalEarned: user.totalPointsEarned,
            pointsValue: user.loyaltyPoints / settings.pointsToRupeeRatio,
            canRedeem: user.loyaltyPoints >= settings.minPointsToRedeem,
            minPointsToRedeem: settings.minPointsToRedeem,
            pointsToRupeeRatio: settings.pointsToRupeeRatio
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   POST /api/loyalty/calculate-redemption
// @desc    Calculate how much discount can be applied with points
// @access  Private
router.post('/calculate-redemption', protect, async (req, res) => {
    try {
        const { orderTotal, pointsToUse } = req.body;
        const user = await User.findById(req.user._id);
        const settings = await LoyaltySettings.getSettings();

        if (!settings.isActive) {
            return res.json({ discount: 0, pointsUsed: 0, message: 'Loyalty program is currently disabled' });
        }

        if (user.loyaltyPoints < settings.minPointsToRedeem) {
            return res.json({
                discount: 0,
                pointsUsed: 0,
                message: `Need at least ${settings.minPointsToRedeem} points to redeem`
            });
        }

        // Calculate max discount allowed (percentage of order)
        const maxDiscountByPercent = (orderTotal * settings.maxRedemptionPercent) / 100;

        // Calculate discount from points
        const maxPointsForDiscount = Math.min(pointsToUse || user.loyaltyPoints, user.loyaltyPoints);
        const discountFromPoints = maxPointsForDiscount / settings.pointsToRupeeRatio;

        // Final discount is minimum of both
        const finalDiscount = Math.min(discountFromPoints, maxDiscountByPercent);
        const pointsUsed = Math.ceil(finalDiscount * settings.pointsToRupeeRatio);

        res.json({
            discount: finalDiscount,
            pointsUsed,
            remainingPoints: user.loyaltyPoints - pointsUsed,
            maxDiscount: maxDiscountByPercent
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   GET /api/loyalty/all-users
// @desc    Get all users with their loyalty points (admin)
// @access  Private/Admin
router.get('/all-users', protect, admin, async (req, res) => {
    try {
        const users = await User.find({ role: 'customer' })
            .select('name phone loyaltyPoints totalPointsEarned createdAt')
            .sort('-loyaltyPoints');
        res.json(users);
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   PUT /api/loyalty/adjust-points/:userId
// @desc    Manually adjust user points (admin)
// @access  Private/Admin
router.put('/adjust-points/:userId', protect, admin, async (req, res) => {
    try {
        const { points, reason } = req.body;
        const user = await User.findById(req.params.userId);

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        user.loyaltyPoints += points;
        if (points > 0) {
            user.totalPointsEarned += points;
        }

        // Prevent negative balance
        if (user.loyaltyPoints < 0) {
            user.loyaltyPoints = 0;
        }

        await user.save();

        res.json({
            message: `Points adjusted by ${points}`,
            newBalance: user.loyaltyPoints
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   PUT /api/loyalty/product/:productId
// @desc    Set bonus loyalty points for a product
// @access  Private/Admin
router.put('/product/:productId', protect, admin, async (req, res) => {
    try {
        const { bonusLoyaltyPoints } = req.body;

        const menuItem = await MenuItem.findByIdAndUpdate(
            req.params.productId,
            { bonusLoyaltyPoints: bonusLoyaltyPoints || 0 },
            { new: true }
        );

        if (!menuItem) {
            return res.status(404).json({ message: 'Product not found' });
        }

        res.json(menuItem);
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

// --- Redemption Offers (New) ---

// @route   GET /api/loyalty/offers
// @desc    Get all loyalty offers (Public/User)
// @access  Public
router.get('/offers', async (req, res) => {
    try {
        const offers = await LoyaltyOffer.find({ isActive: true }).sort('pointsRequired');
        res.json(offers);
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   POST /api/loyalty/offers
// @desc    Create a new loyalty offer
// @access  Private/Admin
router.post('/offers', protect, admin, async (req, res) => {
    try {
        const offer = new LoyaltyOffer(req.body);
        await offer.save();
        res.status(201).json(offer);
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   PUT /api/loyalty/offers/:id
// @desc    Update a loyalty offer
// @access  Private/Admin
router.put('/offers/:id', protect, admin, async (req, res) => {
    try {
        const offer = await LoyaltyOffer.findByIdAndUpdate(req.params.id, req.body, { new: true });
        if (!offer) return res.status(404).json({ message: 'Offer not found' });
        res.json(offer);
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   DELETE /api/loyalty/offers/:id
// @desc    Delete a loyalty offer
// @access  Private/Admin
router.delete('/offers/:id', protect, admin, async (req, res) => {
    try {
        const offer = await LoyaltyOffer.findByIdAndDelete(req.params.id);
        if (!offer) return res.status(404).json({ message: 'Offer not found' });
        res.json({ message: 'Offer deleted' });
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;
