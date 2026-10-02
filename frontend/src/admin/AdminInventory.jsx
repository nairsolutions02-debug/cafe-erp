import React, { useState, useEffect } from 'react';
import { FiPlus, FiEdit2, FiTrash2, FiAlertTriangle } from 'react-icons/fi';
import { getInventory, createInventoryItem, updateInventoryItem, deleteInventoryItem, restockItem } from '../utils/api';
import './AdminInventory.css';

const AdminInventory = () => {
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [showRestock, setShowRestock] = useState(null);
    const [restockQty, setRestockQty] = useState(0);
    const [editItem, setEditItem] = useState(null);
    const [formData, setFormData] = useState({
        name: '', category: 'ingredient', unit: 'kg', currentStock: 0, minimumStock: 10, costPerUnit: 0, amountPaid: 0, supplier: ''
    });

    const [searchTerm, setSearchTerm] = useState('');
    const [paymentFilter, setPaymentFilter] = useState('all');

    useEffect(() => { fetchData(); }, []);

    const fetchData = async () => {
        try {
            const res = await getInventory();
            setItems(res.data);
        } catch (error) {
            console.error('Error:', error);
        } finally {
            setLoading(false);
        }
    };

    // ... (restored functions here)
    const resetForm = () => {
        setFormData({
            name: '', category: 'ingredient', unit: 'kg', currentStock: 0, minimumStock: 10, costPerUnit: 0, amountPaid: 0, supplier: ''
        });
        setEditItem(null);
    };

    const openEdit = (item) => {
        setEditItem(item);
        setFormData({
            name: item.name,
            category: item.category,
            unit: item.unit,
            currentStock: item.currentStock,
            minimumStock: item.minimumStock,
            costPerUnit: item.costPerUnit,
            amountPaid: item.amountPaid || 0,
            supplier: item.supplier || ''
        });
        setShowModal(true);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            if (editItem) {
                await updateInventoryItem(editItem._id, formData);
            } else {
                await createInventoryItem(formData);
            }
            setShowModal(false);
            resetForm();
            fetchData();
        } catch (error) {
            console.error('Error saving item:', error);
            alert('Failed to save item');
        }
    };

    const handleDelete = async (id) => {
        if (!window.confirm('Are you sure you want to delete this item?')) return;
        try {
            await deleteInventoryItem(id);
            fetchData();
        } catch (error) {
            console.error('Error deleting item:', error);
        }
    };

    const handleRestock = async () => {
        try {
            await restockItem(showRestock._id, restockQty);
            setShowRestock(null);
            fetchData();
        } catch (error) {
            console.error('Error restocking:', error);
            alert('Failed to restock');
        }
    };

    const lowStockCount = items.filter(i => i.isLowStock).length;
    const totalInventoryValue = items.reduce((sum, item) => sum + (item.currentStock * item.costPerUnit), 0);

    const filteredItems = items.filter(item => {
        const matchesSearch = item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            item.category.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (item.supplier && item.supplier.toLowerCase().includes(searchTerm.toLowerCase()));

        const matchesPayment = paymentFilter === 'all' ||
            (paymentFilter === 'unpaid' && (!item.paymentStatus || item.paymentStatus === 'pending' || item.paymentStatus === 'unpaid')) ||
            item.paymentStatus === paymentFilter;

        return matchesSearch && matchesPayment;
    });

    return (
        <div className="admin-inventory">
            <div className="page-header">
                <div className="header-content">
                    <div>
                        <h1>Inventory Management</h1>
                        <div className="inventory-stats">
                            {lowStockCount > 0 && (
                                <span className="low-stock-alert"><FiAlertTriangle /> {lowStockCount} items low on stock</span>
                            )}
                            <span className="value-badge">Total Stock Value: ₹{totalInventoryValue.toLocaleString()}</span>
                        </div>
                    </div>

                    <div className="header-actions">
                        <select
                            className="inventory-filter-select"
                            value={paymentFilter}
                            onChange={(e) => setPaymentFilter(e.target.value)}
                        >
                            <option value="all">All Payments</option>
                            <option value="paid">Paid</option>
                            <option value="partial">Partial</option>
                            <option value="unpaid">Unpaid / Pending</option>
                        </select>

                        <input
                            type="text"
                            placeholder="Search inventory..."
                            className="inventory-search"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                        <button className="btn btn-primary" onClick={() => { resetForm(); setShowModal(true); }}>
                            <FiPlus /> Add Item
                        </button>
                    </div>
                </div>
            </div>

            <div className="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>Category</th>
                            <th>Stock</th>
                            <th>Unit</th>
                            <th>Cost/Unit</th>
                            <th>Value</th>
                            <th>Paid</th>
                            <th>Status</th>
                            <th>Supplier</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredItems.map(item => (
                            <tr key={item._id} className={item.isLowStock ? 'low-stock' : ''}>
                                <td>
                                    {item.name}
                                    {item.isLowStock && <span className="low-badge">Low</span>}
                                </td>
                                <td className="capitalize">{item.category}</td>
                                <td className={item.isLowStock ? 'stock-low' : 'stock-ok'}>
                                    {item.currentStock}
                                </td>
                                <td>{item.unit}</td>
                                <td>₹{item.costPerUnit}</td>
                                <td className="font-semibold">₹{(item.currentStock * item.costPerUnit).toLocaleString()}</td>
                                <td>₹{item.amountPaid || 0}</td>
                                <td>
                                    <span className={`status-badge ${item.paymentStatus}`}>
                                        {item.paymentStatus}
                                    </span>
                                </td>
                                <td>{item.supplier || '-'}</td>
                                <td>
                                    <div className="table-actions">
                                        <button onClick={() => { setShowRestock(item); setRestockQty(0); }} className="btn btn-sm btn-success">
                                            Restock
                                        </button>
                                        <button onClick={() => openEdit(item)} className="icon-btn edit"><FiEdit2 /></button>
                                        <button onClick={() => handleDelete(item._id)} className="icon-btn delete"><FiTrash2 /></button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Add/Edit Modal */}
            {showModal && (
                <div className="modal-overlay" onClick={() => setShowModal(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>{editItem ? 'Edit Item' : 'Add Item'}</h2>
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
                                        <label>Category</label>
                                        <select className="input" value={formData.category}
                                            onChange={e => setFormData({ ...formData, category: e.target.value })}>
                                            <option value="ingredient">Ingredient</option>
                                            <option value="packaging">Packaging</option>
                                            <option value="equipment">Equipment</option>
                                            <option value="other">Other</option>
                                        </select>
                                    </div>
                                    <div className="input-group">
                                        <label>Unit</label>
                                        <input type="text" className="input" value={formData.unit}
                                            onChange={e => setFormData({ ...formData, unit: e.target.value })} />
                                    </div>
                                    <div className="input-group">
                                        <label>Current Stock</label>
                                        <input type="number" className="input" value={formData.currentStock}
                                            onChange={e => setFormData({ ...formData, currentStock: parseFloat(e.target.value) || 0 })} />
                                    </div>
                                    <div className="input-group">
                                        <label>Minimum Stock</label>
                                        <input type="number" className="input" value={formData.minimumStock}
                                            onChange={e => setFormData({ ...formData, minimumStock: parseFloat(e.target.value) || 0 })} />
                                    </div>
                                    <div className="input-group">
                                        <label>Cost per Unit</label>
                                        <input type="number" className="input" value={formData.costPerUnit}
                                            onChange={e => setFormData({ ...formData, costPerUnit: parseFloat(e.target.value) || 0 })} />
                                    </div>
                                </div>
                                <div className="input-group">
                                    <label>Amount Paid to Supplier</label>
                                    <input type="number" className="input" value={formData.amountPaid}
                                        onChange={e => setFormData({ ...formData, amountPaid: parseFloat(e.target.value) || 0 })} />
                                </div>
                                <div className="input-group">
                                    <label>Supplier</label>
                                    <input type="text" className="input" value={formData.supplier}
                                        onChange={e => setFormData({ ...formData, supplier: e.target.value })} />
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

            {/* Restock Modal */}
            {showRestock && (
                <div className="modal-overlay" onClick={() => setShowRestock(null)}>
                    <div className="modal small" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Restock {showRestock.name}</h2>
                            <button className="modal-close" onClick={() => setShowRestock(null)}>×</button>
                        </div>
                        <div className="modal-body">
                            <p>Current: {showRestock.currentStock} {showRestock.unit}</p>
                            <div className="input-group">
                                <label>Add Quantity</label>
                                <input type="number" className="input" value={restockQty}
                                    onChange={e => setRestockQty(parseFloat(e.target.value))} min="0" />
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-ghost" onClick={() => setShowRestock(null)}>Cancel</button>
                            <button className="btn btn-success" onClick={handleRestock}>Confirm Restock</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AdminInventory;
