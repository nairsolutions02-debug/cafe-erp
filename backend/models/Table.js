const mongoose = require('mongoose');

const tableSchema = new mongoose.Schema({
    tableNumber: {
        type: String,
        required: true,
        unique: true
    },
    capacity: {
        type: Number,
        default: 4
    },
    isOccupied: {
        type: Boolean,
        default: false
    },
    currentOrder: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Order',
        default: null
    },
    status: {
        type: String,
        enum: ['available', 'occupied', 'reserved', 'maintenance'],
        default: 'available'
    },
    isActive: {
        type: Boolean,
        default: true
    }
}, { timestamps: true });

module.exports = mongoose.model('Table', tableSchema);
