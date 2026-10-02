import React, { useState, useEffect } from 'react';
import { FiPlus, FiEdit2, FiTrash2, FiUsers } from 'react-icons/fi';
import { getTables, createTable, createBulkTables, updateTable, deleteTable } from '../utils/api';
import { useAuth } from '../context/AuthContext';
import './AdminTables.css';

const AdminTables = () => {
    const { socket } = useAuth();
    const [tables, setTables] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [showBulkModal, setShowBulkModal] = useState(false);
    const [editItem, setEditItem] = useState(null);
    const [formData, setFormData] = useState({ tableNumber: '', capacity: 4 });
    const [bulkData, setBulkData] = useState({ startNumber: 1, endNumber: 10, capacity: 4 });

    useEffect(() => { fetchData(); }, []);

    useEffect(() => {
        if (socket) {
            socket.on('table-occupied', () => fetchData());
            socket.on('table-freed', () => fetchData());
            return () => {
                socket.off('table-occupied');
                socket.off('table-freed');
            };
        }
    }, [socket]);

    const fetchData = async () => {
        try {
            const res = await getTables();
            setTables(res.data);
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
                await updateTable(editItem._id, formData);
            } else {
                await createTable(formData);
            }
            setShowModal(false);
            resetForm();
            fetchData();
        } catch (error) {
            alert(error.response?.data?.message || 'Failed to save');
        }
    };

    const handleBulkCreate = async (e) => {
        e.preventDefault();
        try {
            await createBulkTables(bulkData);
            setShowBulkModal(false);
            setBulkData({ startNumber: 1, endNumber: 10, capacity: 4 });
            fetchData();
        } catch (error) {
            alert(error.response?.data?.message || 'Failed to create tables');
        }
    };

    const handleDelete = async (id) => {
        if (window.confirm('Delete this table?')) {
            try {
                await deleteTable(id);
                fetchData();
            } catch (error) {
                alert('Failed to delete');
            }
        }
    };

    const handleToggleStatus = async (table) => {
        try {
            const newStatus = table.status === 'available' ? 'occupied' : 'available';
            await updateTable(table._id, {
                ...table,
                status: newStatus,
                isOccupied: newStatus === 'occupied',
                currentOrder: newStatus === 'available' ? null : table.currentOrder
            });
            fetchData();
        } catch (error) {
            alert('Failed to update status');
        }
    };

    const openEdit = (item) => {
        setEditItem(item);
        setFormData({ tableNumber: item.tableNumber, capacity: item.capacity });
        setShowModal(true);
    };

    const resetForm = () => {
        setEditItem(null);
        setFormData({ tableNumber: '', capacity: 4 });
    };

    if (loading) return <div className="admin-loading"><div className="spinner"></div></div>;

    const availableCount = tables.filter(t => t.status === 'available').length;
    const occupiedCount = tables.filter(t => t.status === 'occupied').length;

    return (
        <div className="admin-tables">
            <div className="page-header">
                <div>
                    <h1>Tables Management</h1>
                    <div className="table-stats">
                        <span className="stat available">{availableCount} Available</span>
                        <span className="stat occupied">{occupiedCount} Occupied</span>
                    </div>
                </div>
                <div className="header-actions">
                    <button className="btn btn-secondary" onClick={() => setShowBulkModal(true)}>
                        Add Multiple
                    </button>
                    <button className="btn btn-primary" onClick={() => { resetForm(); setShowModal(true); }}>
                        <FiPlus /> Add Table
                    </button>
                </div>
            </div>

            <div className="tables-grid">
                {tables.map(table => (
                    <div key={table._id} className={`table-card ${table.status}`}>
                        <div className="table-number">Table {table.tableNumber}</div>
                        <div className="table-capacity">
                            <FiUsers /> {table.capacity} seats
                        </div>
                        <div className={`table-status ${table.status}`}>
                            {table.status === 'available' ? '✓ Available' :
                                table.status === 'occupied' ? '● Occupied' :
                                    table.status === 'reserved' ? '◐ Reserved' : '⚠ Maintenance'}
                        </div>
                        {table.currentOrder && (
                            <div className="table-order">
                                Order: #{table.currentOrder.orderNumber}
                            </div>
                        )}
                        <div className="table-actions">
                            <button
                                onClick={() => handleToggleStatus(table)}
                                className={`status-toggle-btn ${table.status}`}
                                title={table.status === 'available' ? 'Mark as Occupied' : 'Mark as Available'}
                            >
                                {table.status === 'available' ? 'Mark Occupied' : 'Free Table'}
                            </button>
                            <button onClick={() => openEdit(table)} className="icon-btn edit"><FiEdit2 /></button>
                            <button
                                onClick={() => handleDelete(table._id)}
                                className="icon-btn delete"
                                disabled={table.status === 'occupied'}
                            >
                                <FiTrash2 />
                            </button>
                        </div>
                    </div>
                ))}
            </div>

            {tables.length === 0 && (
                <div className="no-tables">
                    <FiUsers size={48} />
                    <h3>No tables configured</h3>
                    <p>Add tables for your restaurant</p>
                </div>
            )}

            {/* Add/Edit Modal */}
            {showModal && (
                <div className="modal-overlay" onClick={() => setShowModal(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>{editItem ? 'Edit Table' : 'Add Table'}</h2>
                            <button className="modal-close" onClick={() => setShowModal(false)}>×</button>
                        </div>
                        <form onSubmit={handleSubmit}>
                            <div className="modal-body">
                                <div className="input-group">
                                    <label>Table Number *</label>
                                    <input
                                        type="text"
                                        className="input"
                                        value={formData.tableNumber}
                                        onChange={e => setFormData({ ...formData, tableNumber: e.target.value })}
                                        required
                                        placeholder="e.g., 1, A1, VIP1"
                                    />
                                </div>
                                <div className="input-group">
                                    <label>Seating Capacity</label>
                                    <input
                                        type="number"
                                        className="input"
                                        value={formData.capacity}
                                        onChange={e => setFormData({ ...formData, capacity: parseInt(e.target.value) })}
                                        min="1"
                                        max="20"
                                    />
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

            {/* Bulk Create Modal */}
            {showBulkModal && (
                <div className="modal-overlay" onClick={() => setShowBulkModal(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Add Multiple Tables</h2>
                            <button className="modal-close" onClick={() => setShowBulkModal(false)}>×</button>
                        </div>
                        <form onSubmit={handleBulkCreate}>
                            <div className="modal-body">
                                <p className="bulk-info">Create numbered tables from start to end</p>
                                <div className="form-row">
                                    <div className="input-group">
                                        <label>Start Number</label>
                                        <input
                                            type="number"
                                            className="input"
                                            value={bulkData.startNumber}
                                            onChange={e => setBulkData({ ...bulkData, startNumber: parseInt(e.target.value) })}
                                            min="1"
                                        />
                                    </div>
                                    <div className="input-group">
                                        <label>End Number</label>
                                        <input
                                            type="number"
                                            className="input"
                                            value={bulkData.endNumber}
                                            onChange={e => setBulkData({ ...bulkData, endNumber: parseInt(e.target.value) })}
                                            min="1"
                                        />
                                    </div>
                                </div>
                                <div className="input-group">
                                    <label>Seating Capacity (all)</label>
                                    <input
                                        type="number"
                                        className="input"
                                        value={bulkData.capacity}
                                        onChange={e => setBulkData({ ...bulkData, capacity: parseInt(e.target.value) })}
                                        min="1"
                                        max="20"
                                    />
                                </div>
                                <p className="bulk-preview">
                                    Will create {bulkData.endNumber - bulkData.startNumber + 1} tables
                                    (Table {bulkData.startNumber} to Table {bulkData.endNumber})
                                </p>
                            </div>
                            <div className="modal-footer">
                                <button type="button" className="btn btn-ghost" onClick={() => setShowBulkModal(false)}>Cancel</button>
                                <button type="submit" className="btn btn-primary">Create Tables</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AdminTables;
