import React, { useState, useEffect } from 'react';
import { FiPlus, FiEdit2, FiTrash2, FiCalendar } from 'react-icons/fi';
import Calendar from 'react-calendar';
import { getEmployees, createEmployee, updateEmployee, deleteEmployee, getEmployeeAttendance, markAttendance, getHolidays, addHoliday } from '../utils/api';
import 'react-calendar/dist/Calendar.css';
import './AdminEmployees.css';

const AdminEmployees = () => {
    const [employees, setEmployees] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [showAttendance, setShowAttendance] = useState(null);
    const [attendance, setAttendance] = useState([]);
    const [selectedDate, setSelectedDate] = useState(new Date());
    const [editItem, setEditItem] = useState(null);
    const [formData, setFormData] = useState({
        name: '', phone: '', email: '', role: 'waiter', salary: 0, address: '', emergencyContact: ''
    });

    useEffect(() => { fetchData(); }, []);

    const fetchData = async () => {
        try {
            const res = await getEmployees();
            setEmployees(res.data);
        } catch (error) {
            console.error('Error:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            if (editItem) {
                await updateEmployee(editItem._id, formData);
            } else {
                await createEmployee(formData);
            }
            setShowModal(false);
            resetForm();
            fetchData();
        } catch (error) {
            alert('Failed to save');
        }
    };

    const handleDelete = async (id) => {
        if (window.confirm('Delete this employee?')) {
            try {
                await deleteEmployee(id);
                fetchData();
            } catch (error) {
                alert('Failed to delete');
            }
        }
    };

    const openAttendance = async (emp) => {
        setShowAttendance(emp);
        try {
            const res = await getEmployeeAttendance(emp._id);
            setAttendance(res.data);
        } catch (error) {
            console.error('Error:', error);
        }
    };

    const handleMarkAttendance = async (status) => {
        try {
            // Create a safe date at noon to prevent timezone shifts
            // This ensures 12th Jan IST (UTC+5.5) stays 12th Jan in UTC
            const safeDate = new Date(selectedDate);
            safeDate.setHours(12, 0, 0, 0);

            await markAttendance(showAttendance._id, {
                date: safeDate.toISOString(),
                status
            });
            const res = await getEmployeeAttendance(showAttendance._id);
            setAttendance(res.data);
        } catch (error) {
            alert('Failed to mark attendance');
        }
    };

    const getAttendanceForDate = (date) => {
        const dateStr = date.toISOString().split('T')[0];
        return attendance.find(a => a.date.split('T')[0] === dateStr);
    };

    const tileClassName = ({ date }) => {
        const att = getAttendanceForDate(date);
        if (!att) return '';
        return `tile-${att.status}`;
    };

    const openEdit = (item) => {
        setEditItem(item);
        setFormData({ ...item });
        setShowModal(true);
    };

    const resetForm = () => {
        setEditItem(null);
        setFormData({
            name: '', phone: '', email: '', role: 'waiter', salary: 0, address: '', emergencyContact: ''
        });
    };

    if (loading) return <div className="admin-loading"><div className="spinner"></div></div>;

    return (
        <div className="admin-employees">
            <div className="page-header">
                <h1>Employee Management</h1>
                <button className="btn btn-primary" onClick={() => { resetForm(); setShowModal(true); }}>
                    <FiPlus /> Add Employee
                </button>
            </div>

            <div className="employees-grid">
                {employees.map(emp => (
                    <div key={emp._id} className={`employee-card ${!emp.isActive ? 'inactive' : ''}`}>
                        <div className="employee-avatar">{emp.name.charAt(0).toUpperCase()}</div>
                        <div className="employee-info">
                            <h3>{emp.name}</h3>
                            <span className="employee-role">{emp.role}</span>
                            <p>{emp.phone}</p>
                        </div>
                        <div className="employee-actions">
                            <button onClick={() => openAttendance(emp)} className="icon-btn calendar"><FiCalendar /></button>
                            <button onClick={() => openEdit(emp)} className="icon-btn edit"><FiEdit2 /></button>
                            <button onClick={() => handleDelete(emp._id)} className="icon-btn delete"><FiTrash2 /></button>
                        </div>
                    </div>
                ))}
            </div>

            {/* Add/Edit Modal */}
            {showModal && (
                <div className="modal-overlay" onClick={() => setShowModal(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>{editItem ? 'Edit Employee' : 'Add Employee'}</h2>
                            <button className="modal-close" onClick={() => setShowModal(false)}>×</button>
                        </div>
                        <form onSubmit={handleSubmit}>
                            <div className="modal-body">
                                <div className="form-grid">
                                    <div className="input-group">
                                        <label>Name *</label>
                                        <input type="text" className="input" value={formData.name}
                                            onChange={e => setFormData({ ...formData, name: e.target.value })} required />
                                    </div>
                                    <div className="input-group">
                                        <label>Phone *</label>
                                        <input type="tel" className="input" value={formData.phone}
                                            onChange={e => setFormData({ ...formData, phone: e.target.value })} required />
                                    </div>
                                    <div className="input-group">
                                        <label>Email</label>
                                        <input type="email" className="input" value={formData.email}
                                            onChange={e => setFormData({ ...formData, email: e.target.value })} />
                                    </div>
                                    <div className="input-group">
                                        <label>Role</label>
                                        <select className="input" value={formData.role}
                                            onChange={e => setFormData({ ...formData, role: e.target.value })}>
                                            <option value="chef">Chef</option>
                                            <option value="waiter">Waiter</option>
                                            <option value="cashier">Cashier</option>
                                            <option value="manager">Manager</option>
                                            <option value="cleaner">Cleaner</option>
                                            <option value="other">Other</option>
                                        </select>
                                    </div>
                                    <div className="input-group">
                                        <label>Salary</label>
                                        <input type="number" className="input" value={formData.salary}
                                            onChange={e => setFormData({ ...formData, salary: parseFloat(e.target.value) })} />
                                    </div>
                                    <div className="input-group">
                                        <label>Emergency Contact</label>
                                        <input type="tel" className="input" value={formData.emergencyContact}
                                            onChange={e => setFormData({ ...formData, emergencyContact: e.target.value })} />
                                    </div>
                                </div>
                                <div className="input-group">
                                    <label>Address</label>
                                    <textarea className="input" value={formData.address}
                                        onChange={e => setFormData({ ...formData, address: e.target.value })} rows={2} />
                                </div>
                            </div>
                            <div className="modal-footer">
                                <button type="button" className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
                                <button type="submit" className="btn btn-primary">Save</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Attendance Modal */}
            {showAttendance && (
                <div className="modal-overlay" onClick={() => setShowAttendance(null)}>
                    <div className="modal attendance-modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Attendance - {showAttendance.name}</h2>
                            <button className="modal-close" onClick={() => setShowAttendance(null)}>×</button>
                        </div>
                        <div className="modal-body">
                            <Calendar
                                onChange={setSelectedDate}
                                value={selectedDate}
                                tileClassName={tileClassName}
                                maxDate={new Date()}
                            />
                            <div className="attendance-info">
                                <p>Selected: {selectedDate.toLocaleDateString()}</p>
                                <p>Status: {getAttendanceForDate(selectedDate)?.status || 'Not marked'}</p>
                            </div>
                            <div className="attendance-actions">
                                <button onClick={() => handleMarkAttendance('present')} className="btn btn-success btn-sm">Present</button>
                                <button onClick={() => handleMarkAttendance('absent')} className="btn btn-danger btn-sm">Absent</button>
                                <button onClick={() => handleMarkAttendance('half-day')} className="btn btn-warning btn-sm">Half Day</button>
                                <button onClick={() => handleMarkAttendance('leave')} className="btn btn-secondary btn-sm">Leave</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AdminEmployees;
