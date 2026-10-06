import React, { useState, useEffect } from 'react';
import { FiPlus, FiEdit2, FiTrash2, FiUsers, FiPrinter, FiRefreshCw } from 'react-icons/fi';
import { QRCodeSVG } from 'qrcode.react';
import { tableQrUrl } from '../lib/qrTable';
import { useBrand } from '../context/BrandContext';
import { getTables, createTable, createBulkTables, updateTable, deleteTable, getTableCodes, reissueTableCode, getTableGroups } from '../utils/api';
import { inr } from './pos/money';
import { useAuth } from '../context/AuthContext';
import './AdminTables.css';

const AdminTables = () => {
    const brand = useBrand();
    const { socket, hasPerm } = useAuth();
    const [codes, setCodes] = useState({});
    const [groups, setGroups] = useState([]);
    const [tables, setTables] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [showBulkModal, setShowBulkModal] = useState(false);
    const [editItem, setEditItem] = useState(null);
    const [formData, setFormData] = useState({ tableNumber: '', capacity: 4 });
    const [bulkData, setBulkData] = useState({ startNumber: 1, endNumber: 10, capacity: 4 });
    // Tables whose QR codes are shown for printing
    const [qrTables, setQrTables] = useState(null);

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
            const [res, c, g] = await Promise.all([getTables(), getTableCodes(), getTableGroups().catch(() => ({ data: [] }))]);
            setTables(res.data);
            setCodes(c.data);
            setGroups(g.data);
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

    // Busy/free follows open bills by itself; this is for a table left marked busy by mistake
    const handleClear = async (table) => {
        const open = groups.filter(g => g.tableId === table._id);
        if (open.length && !window.confirm(`Table ${table.tableNumber} still has ${open.length} open bill${open.length > 1 ? 's' : ''}. Mark it free anyway?`)) return;
        try {
            await updateTable(table._id, { status: 'available', isOccupied: false });
            fetchData();
        } catch {
            alert('Failed to update status');
        }
    };

    const handleReissue = async (table) => {
        if (!window.confirm(`Make a new QR code for Table ${table.tableNumber}? The old printed QR stops working, so print the new one right away.`)) return;
        try {
            const code = (await reissueTableCode(table._id)).data;
            setCodes(c => ({ ...c, [table._id]: code }));
            setQrTables([{ ...table }]);
        } catch (error) {
            alert(error.response?.data?.message || error.message || 'Could not make a new QR code');
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
    const groupsAt = (id) => groups.filter(g => g.tableId === id);

    return (
        <div className="admin-tables">
            <div className="page-header">
                <div>
                    <h1>Tables Management</h1>
                    <div className="table-stats">
                        <span className="stat available">{availableCount} Available</span>
                        <span className="stat occupied">{occupiedCount} Busy</span>
                        {groups.length > 0 && <span className="stat">{groups.length} group{groups.length > 1 ? 's' : ''} seated</span>}
                    </div>
                </div>
                <div className="header-actions">
                    {tables.length > 0 && (
                        <button className="btn btn-secondary" onClick={() => setQrTables(tables)}>
                            <FiPrinter /> QR Codes
                        </button>
                    )}
                    {hasPerm('tables.create') && (
                        <>
                            <button className="btn btn-secondary" onClick={() => setShowBulkModal(true)}>
                                Add Multiple
                            </button>
                            <button className="btn btn-primary" onClick={() => { resetForm(); setShowModal(true); }}>
                                <FiPlus /> Add Table
                            </button>
                        </>
                    )}
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
                            {table.status === 'available' ? '✓ Free' :
                                table.status === 'occupied' ? `● ${groupsAt(table._id).length > 1 ? `${groupsAt(table._id).length} groups` : 'Busy'}` :
                                    table.status === 'reserved' ? '◐ Reserved' : '⚠ Maintenance'}
                        </div>
                        {groupsAt(table._id).length > 0 && (
                            <ul className="table-groups">
                                {groupsAt(table._id).map(g => (
                                    <li key={g.customerId || g.name} className={g.held ? 'held' : g.billRequested ? 'bill' : ''}>
                                        <span>{g.name}{g.orders > 1 ? ` ×${g.orders}` : ''}</span>
                                        <span>{g.held ? 'Accept' : g.billRequested ? 'Bill' : inr(g.due)}</span>
                                    </li>
                                ))}
                            </ul>
                        )}
                        <div className="table-actions">
                            {table.status !== 'available' && (
                                <button onClick={() => handleClear(table)} className={`status-toggle-btn ${table.status}`} title="Mark this table free">
                                    Clear table
                                </button>
                            )}
                            <button onClick={() => setQrTables([table])} className="icon-btn" title="Table QR code"><FiPrinter /></button>
                            {hasPerm('tables.edit') && <button onClick={() => handleReissue(table)} className="icon-btn" title="New QR code (old one stops working)"><FiRefreshCw /></button>}
                            {hasPerm('tables.edit') && <button onClick={() => openEdit(table)} className="icon-btn edit" title="Edit table"><FiEdit2 /></button>}
                            {hasPerm('tables.delete') && (
                                <button
                                    onClick={() => handleDelete(table._id)}
                                    className="icon-btn delete"
                                    title="Delete table"
                                    disabled={table.status === 'occupied'}
                                >
                                    <FiTrash2 />
                                </button>
                            )}
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

            {/* Table QR codes: customers scan to open the menu with their table selected */}
            {qrTables && (
                <div className="modal-overlay qr-print-overlay" onClick={() => setQrTables(null)}>
                    <div className="modal qr-modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header no-print">
                            <h2>Table QR Codes</h2>
                            <button className="modal-close" onClick={() => setQrTables(null)}>×</button>
                        </div>
                        <div className="qr-grid">
                            {qrTables.map(table => (
                                <div key={table._id} className="qr-card">
                                    <div className="qr-cafe">{brand.name}</div>
                                    {codes[table._id]
                                        ? <QRCodeSVG value={tableQrUrl(codes[table._id])} size={180} marginSize={2} />
                                        : <div className="qr-missing">No QR code yet</div>}
                                    <div className="qr-table">Table {table.tableNumber}</div>
                                    <div className="qr-hint">Scan to order · Everyone at the table can scan</div>
                                    {codes[table._id] && <div className="qr-code-text">{codes[table._id]}</div>}
                                </div>
                            ))}
                        </div>
                        <div className="modal-footer no-print">
                            <button className="btn btn-primary" onClick={() => window.print()}>
                                <FiPrinter /> Print
                            </button>
                        </div>
                    </div>
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
