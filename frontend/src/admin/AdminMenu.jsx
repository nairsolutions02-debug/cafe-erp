import React, { useState, useEffect } from 'react';
import { FiPlus, FiEdit2, FiTrash2, FiImage } from 'react-icons/fi';
import { getAllMenuItems, getAllCategories, createMenuItem, updateMenuItem, deleteMenuItem, updateStock } from '../utils/api';
import { getImageUrl } from '../utils/config';
import './AdminMenu.css';

const AdminMenu = () => {
    const [items, setItems] = useState([]);
    const [categories, setCategories] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [editItem, setEditItem] = useState(null);
    const [formData, setFormData] = useState({
        name: '', description: '', price: '', category: '',
        isVeg: true, isBestSeller: false, isNewItem: false, isRecommended: false,
        preparationTime: 15, stockQuantity: -1
    });
    const [image, setImage] = useState(null);

    useEffect(() => {
        fetchData();
    }, []);

    const fetchData = async () => {
        try {
            const [itemsRes, catRes] = await Promise.all([getAllMenuItems(), getAllCategories()]);
            setItems(itemsRes.data);
            setCategories(catRes.data);
        } catch (error) {
            console.error('Error:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        const data = new FormData();
        Object.keys(formData).forEach(key => data.append(key, formData[key]));
        if (image) data.append('image', image);

        try {
            if (editItem) {
                await updateMenuItem(editItem._id, data);
            } else {
                await createMenuItem(data);
            }
            setShowModal(false);
            resetForm();
            fetchData();
        } catch (error) {
            alert('Failed to save item');
        }
    };

    const handleDelete = async (id) => {
        if (window.confirm('Delete this item?')) {
            try {
                await deleteMenuItem(id);
                fetchData();
            } catch (error) {
                alert('Failed to delete');
            }
        }
    };

    const handleStockToggle = async (item) => {
        try {
            await updateStock(item._id, { isAvailable: !item.isAvailable });
            fetchData();
        } catch (error) {
            alert('Failed to update stock');
        }
    };

    const openEdit = (item) => {
        setEditItem(item);
        setFormData({
            name: item.name, description: item.description || '', price: item.price,
            category: item.category?._id || '', isVeg: item.isVeg,
            isBestSeller: item.isBestSeller, isNewItem: item.isNewItem, isRecommended: item.isRecommended, isUpsell: item.isUpsell,
            preparationTime: item.preparationTime, stockQuantity: item.stockQuantity
        });
        setShowModal(true);
    };

    const resetForm = () => {
        setEditItem(null);
        setFormData({
            name: '', description: '', price: '', category: '',
            isVeg: true, isBestSeller: false, isNewItem: false, isRecommended: false,
            preparationTime: 15, stockQuantity: -1
        });
        setImage(null);
    };

    if (loading) return <div className="admin-loading"><div className="spinner"></div></div>;

    return (
        <div className="admin-menu">
            <div className="page-header">
                <h1>Menu Management</h1>
                <button className="btn btn-primary" onClick={() => { resetForm(); setShowModal(true); }}>
                    <FiPlus /> Add Item
                </button>
            </div>

            <div className="items-grid">
                {items.map(item => (
                    <div key={item._id} className={`item-card ${!item.isAvailable ? 'out-of-stock' : ''}`}>
                        <div className="item-image">
                            {item.image ? (
                                <img src={getImageUrl(item.image)} alt={item.name} />
                            ) : (
                                <div className="no-image"><FiImage /></div>
                            )}
                            {item.isBestSeller && <span className="badge bestseller">Bestseller</span>}
                            {item.isNewItem && <span className="badge new">New</span>}
                        </div>
                        <div className="item-content">
                            <div className="item-header">
                                <span className={item.isVeg ? 'badge-veg' : 'badge-non-veg'}></span>
                                <h3>{item.name}</h3>
                            </div>
                            <p className="item-category">{item.category?.name}</p>
                            <div className="item-footer">
                                <span className="item-price">₹{item.price}</span>
                                <div className="item-actions">
                                    <button onClick={() => handleStockToggle(item)} className={`stock-btn ${item.isAvailable ? 'in' : 'out'}`}>
                                        {item.isAvailable ? 'In Stock' : 'Out of Stock'}
                                    </button>
                                    <button onClick={() => openEdit(item)} className="icon-btn edit"><FiEdit2 /></button>
                                    <button onClick={() => handleDelete(item._id)} className="icon-btn delete"><FiTrash2 /></button>
                                </div>
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            {/* Modal */}
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
                                        <label>Price *</label>
                                        <input type="number" className="input" value={formData.price}
                                            onChange={e => setFormData({ ...formData, price: e.target.value })} required />
                                    </div>
                                    <div className="input-group">
                                        <label>Category *</label>
                                        <select className="input" value={formData.category}
                                            onChange={e => setFormData({ ...formData, category: e.target.value })} required>
                                            <option value="">Select Category</option>
                                            {categories.map(c => <option key={c._id} value={c._id}>{c.name}</option>)}
                                        </select>
                                    </div>
                                    <div className="input-group image-upload-group">
                                        <label>Image</label>
                                        <input type="file" accept="image/*" onChange={e => setImage(e.target.files[0])} />
                                        {/* Image Preview */}
                                        {(image || (editItem && editItem.image)) && (
                                            <div className="image-preview-container">
                                                <img
                                                    src={image ? URL.createObjectURL(image) : getImageUrl(editItem.image)}
                                                    alt="Preview"
                                                    className="image-preview"
                                                />
                                                {image && (
                                                    <button
                                                        type="button"
                                                        className="remove-preview-btn"
                                                        onClick={() => setImage(null)}
                                                    >
                                                        ×
                                                    </button>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>
                                <div className="input-group">
                                    <label>Description</label>
                                    <textarea className="input" value={formData.description}
                                        onChange={e => setFormData({ ...formData, description: e.target.value })} rows={2} />
                                </div>
                                {/* Veg/Non-Veg Toggle */}
                                <div className="veg-toggle-group">
                                    <label className="toggle-label">Food Type *</label>
                                    <div className="veg-toggle-container">
                                        <button
                                            type="button"
                                            className={`veg-toggle-btn ${formData.isVeg ? 'active veg' : ''}`}
                                            onClick={() => setFormData({ ...formData, isVeg: true })}
                                        >
                                            <span className="veg-indicator veg"></span>
                                            Veg
                                        </button>
                                        <button
                                            type="button"
                                            className={`veg-toggle-btn ${!formData.isVeg ? 'active non-veg' : ''}`}
                                            onClick={() => setFormData({ ...formData, isVeg: false })}
                                        >
                                            <span className="veg-indicator non-veg"></span>
                                            Non-Veg
                                        </button>
                                    </div>
                                </div>

                                <div className="checkbox-group">
                                    <label><input type="checkbox" checked={formData.isNewItem}
                                        onChange={e => setFormData({ ...formData, isNewItem: e.target.checked })} /> New</label>
                                    <label><input type="checkbox" checked={formData.isRecommended}
                                        onChange={e => setFormData({ ...formData, isRecommended: e.target.checked })} /> Recommended</label>
                                    <label><input type="checkbox" checked={formData.isUpsell}
                                        onChange={e => setFormData({ ...formData, isUpsell: e.target.checked })} /> Show as Cart Suggestion</label>
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
        </div>
    );
};

export default AdminMenu;
