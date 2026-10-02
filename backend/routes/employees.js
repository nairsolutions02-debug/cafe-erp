const express = require('express');
const router = express.Router();
const Employee = require('../models/Employee');
const Attendance = require('../models/Attendance');
const Holiday = require('../models/Holiday');
const { protect, admin } = require('../middleware/auth');

// Get all employees
router.get('/', protect, admin, async (req, res) => {
    try {
        const { role, isActive } = req.query;
        let query = {};
        if (role) query.role = role;
        if (isActive !== undefined) query.isActive = isActive === 'true';
        const employees = await Employee.find(query).sort('name');
        res.json(employees);
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

// Get employee by ID
router.get('/:id', protect, admin, async (req, res) => {
    try {
        const employee = await Employee.findById(req.params.id);
        if (!employee) return res.status(404).json({ message: 'Employee not found' });
        res.json(employee);
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

// Create employee
router.post('/', protect, admin, async (req, res) => {
    try {
        const employee = new Employee(req.body);
        await employee.save();
        res.status(201).json(employee);
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

// Update employee
router.put('/:id', protect, admin, async (req, res) => {
    try {
        const employee = await Employee.findByIdAndUpdate(req.params.id, req.body, { new: true });
        if (!employee) return res.status(404).json({ message: 'Employee not found' });
        res.json(employee);
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

// Delete employee
router.delete('/:id', protect, admin, async (req, res) => {
    try {
        await Employee.findByIdAndDelete(req.params.id);
        await Attendance.deleteMany({ employee: req.params.id });
        res.json({ message: 'Employee deleted' });
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

// Get employee attendance
router.get('/:id/attendance', protect, admin, async (req, res) => {
    try {
        const { month, year } = req.query;
        let query = { employee: req.params.id };
        if (month && year) {
            const startDate = new Date(year, month - 1, 1);
            const endDate = new Date(year, month, 0);
            query.date = { $gte: startDate, $lte: endDate };
        }
        const attendance = await Attendance.find(query).sort('date');
        res.json(attendance);
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

// Mark attendance
router.post('/:id/attendance', protect, admin, async (req, res) => {
    try {
        const { date, status, checkIn, checkOut, notes } = req.body;
        const attendanceDate = new Date(date);
        attendanceDate.setHours(0, 0, 0, 0);
        const holiday = await Holiday.findOne({ date: attendanceDate });

        let attendance = await Attendance.findOne({ employee: req.params.id, date: attendanceDate });
        if (attendance) {
            attendance.status = holiday ? 'holiday' : status;
            attendance.checkIn = checkIn || '';
            attendance.checkOut = checkOut || '';
            attendance.notes = notes || '';
        } else {
            attendance = new Attendance({
                employee: req.params.id,
                date: attendanceDate,
                status: holiday ? 'holiday' : status,
                checkIn: checkIn || '',
                checkOut: checkOut || '',
                notes: notes || ''
            });
        }
        await attendance.save();
        res.json(attendance);
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

// Get holidays
router.get('/holidays/list', protect, admin, async (req, res) => {
    try {
        const holidays = await Holiday.find().sort('date');
        res.json(holidays);
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

// Add holiday
router.post('/holidays', protect, admin, async (req, res) => {
    try {
        const { date, name, description } = req.body;
        const holidayDate = new Date(date);
        holidayDate.setHours(0, 0, 0, 0);
        const holiday = new Holiday({ date: holidayDate, name, description: description || '' });
        await holiday.save();
        await Attendance.updateMany({ date: holidayDate }, { $set: { status: 'holiday' } });
        res.status(201).json(holiday);
    } catch (error) {
        if (error.code === 11000) return res.status(400).json({ message: 'Holiday exists' });
        res.status(500).json({ message: 'Server error' });
    }
});

// Delete holiday
router.delete('/holidays/:id', protect, admin, async (req, res) => {
    try {
        await Holiday.findByIdAndDelete(req.params.id);
        res.json({ message: 'Holiday deleted' });
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;
