const mongoose = require('mongoose');

const employeeSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true
    },
    phone: {
        type: String,
        required: true
    },
    email: {
        type: String,
        default: ''
    },
    role: {
        type: String,
        enum: ['chef', 'waiter', 'cashier', 'manager', 'cleaner', 'other'],
        default: 'waiter'
    },
    salary: {
        type: Number,
        default: 0
    },
    joiningDate: {
        type: Date,
        default: Date.now
    },
    isActive: {
        type: Boolean,
        default: true
    },
    address: {
        type: String,
        default: ''
    },
    emergencyContact: {
        type: String,
        default: ''
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('Employee', employeeSchema);
