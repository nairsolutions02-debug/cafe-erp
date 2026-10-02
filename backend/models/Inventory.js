const mongoose = require('mongoose');

const inventorySchema = new mongoose.Schema({
    name: {
        type: String,
        required: true
    },
    category: {
        type: String,
        enum: ['ingredient', 'packaging', 'equipment', 'other'],
        default: 'ingredient'
    },
    unit: {
        type: String,
        required: true // kg, liters, pieces, etc.
    },
    currentStock: {
        type: Number,
        required: true,
        default: 0
    },
    minimumStock: {
        type: Number,
        default: 10
    },
    costPerUnit: {
        type: Number,
        default: 0
    },
    amountPaid: {
        type: Number,
        default: 0
    },
    paymentStatus: {
        type: String,
        enum: ['unpaid', 'partial', 'paid'],
        default: 'unpaid'
    },
    supplier: {
        type: String,
        default: ''
    },
    lastRestocked: {
        type: Date,
        default: Date.now
    },
    isLowStock: {
        type: Boolean,
        default: false
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

inventorySchema.pre('save', function () {
    this.isLowStock = (this.currentStock || 0) <= (this.minimumStock || 0);
});

module.exports = mongoose.model('Inventory', inventorySchema);
