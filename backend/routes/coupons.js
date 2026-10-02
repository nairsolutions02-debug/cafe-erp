const express = require('express');
const router = express.Router();
const Coupon = require('../models/Coupon');
const { protect, admin } = require('../middleware/auth');

// @route   GET /api/coupons
// @desc    Get all active coupons (public)
// @access  Public
router.get('/', async (req, res) => {
    try {
        const coupons = await Coupon.find({
            isActive: true,
            validFrom: { $lte: new Date() },
            validUntil: { $gte: new Date() }
        }).select('code description discountType discountValue minOrderAmount maxDiscount');
        res.json(coupons);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   GET /api/coupons/all
// @desc    Get all coupons (admin)
// @access  Private/Admin
router.get('/all', protect, admin, async (req, res) => {
    try {
        const coupons = await Coupon.find()
            .populate('applicableItems', 'name')
            .populate('applicableCategories', 'name');
        res.json(coupons);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   POST /api/coupons/validate
// @desc    Validate coupon code
// @access  Private
router.post('/validate', protect, async (req, res) => {
    try {
        const { code, orderTotal } = req.body;

        const coupon = await Coupon.findOne({
            code: code.toUpperCase(),
            isActive: true,
            validFrom: { $lte: new Date() },
            validUntil: { $gte: new Date() }
        });

        if (!coupon) {
            return res.status(404).json({ message: 'Invalid coupon code' });
        }

        if (coupon.usageLimit !== -1 && coupon.usedCount >= coupon.usageLimit) {
            return res.status(400).json({ message: 'Coupon usage limit reached' });
        }

        if (orderTotal < coupon.minOrderAmount) {
            return res.status(400).json({
                message: `Minimum order amount is ₹${coupon.minOrderAmount}`
            });
        }

        let discount = 0;
        if (coupon.discountType === 'percentage') {
            discount = (orderTotal * coupon.discountValue) / 100;
            if (coupon.maxDiscount && discount > coupon.maxDiscount) {
                discount = coupon.maxDiscount;
            }
        } else {
            discount = Math.min(coupon.discountValue, orderTotal);
        }

        res.json({
            valid: true,
            coupon: {
                code: coupon.code,
                description: coupon.description,
                discountType: coupon.discountType,
                discountValue: coupon.discountValue
            },
            discount
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   POST /api/coupons
// @desc    Create coupon
// @access  Private/Admin
router.post('/', protect, admin, async (req, res) => {
    try {
        const {
            code, description, discountType, discountValue,
            minOrderAmount, maxDiscount, applicableItems,
            applicableCategories, usageLimit, validFrom, validUntil
        } = req.body;

        const coupon = new Coupon({
            code: code.toUpperCase(),
            description,
            discountType,
            discountValue,
            minOrderAmount: minOrderAmount || 0,
            maxDiscount: maxDiscount || null,
            applicableItems: applicableItems || [],
            applicableCategories: applicableCategories || [],
            usageLimit: usageLimit || -1,
            validFrom: new Date(validFrom),
            validUntil: new Date(validUntil)
        });

        await coupon.save();
        res.status(201).json(coupon);
    } catch (error) {
        console.error(error);
        if (error.code === 11000) {
            return res.status(400).json({ message: 'Coupon code already exists' });
        }
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   PUT /api/coupons/:id
// @desc    Update coupon
// @access  Private/Admin
router.put('/:id', protect, admin, async (req, res) => {
    try {
        const coupon = await Coupon.findById(req.params.id);
        if (!coupon) {
            return res.status(404).json({ message: 'Coupon not found' });
        }

        const fields = [
            'code', 'description', 'discountType', 'discountValue',
            'minOrderAmount', 'maxDiscount', 'applicableItems',
            'applicableCategories', 'usageLimit', 'validFrom', 'validUntil', 'isActive'
        ];

        fields.forEach(field => {
            if (req.body[field] !== undefined) {
                if (field === 'code') {
                    coupon[field] = req.body[field].toUpperCase();
                } else if (field === 'validFrom' || field === 'validUntil') {
                    coupon[field] = new Date(req.body[field]);
                } else {
                    coupon[field] = req.body[field];
                }
            }
        });

        await coupon.save();
        res.json(coupon);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   DELETE /api/coupons/:id
// @desc    Delete coupon
// @access  Private/Admin
router.delete('/:id', protect, admin, async (req, res) => {
    try {
        const coupon = await Coupon.findByIdAndDelete(req.params.id);
        if (!coupon) {
            return res.status(404).json({ message: 'Coupon not found' });
        }
        res.json({ message: 'Coupon deleted' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;
