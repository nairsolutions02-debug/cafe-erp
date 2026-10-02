import React, { useState, useEffect } from 'react';
import { FiPlus, FiEdit2, FiTrash2 } from 'react-icons/fi';
import { getAllCategories, createCategory, updateCategory, deleteCategory, getStockLocations } from '../utils/api';
import { getImageUrl } from '../utils/config';
import { useAuth } from '../context/AuthContext';
import './AdminCategories.css';

const AdminCategories = () => {
    const { hasPerm } = useAuth();
    const [categories, setCategories] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [editItem, setEditItem] = useState(null);
    const [formData, setFormData] = useState({ name: '', description: '', order: 1, parentId: '', stockLocationId: '' });
    const [image, setImage] = useState(null);
    const [locations, setLocations] = useState([]);

    useEffect(() => { fetchData(); }, []);
    useEffect(() => {
        if (hasPerm('inventory.view')) getStockLocations().then(r => setLocations(r.data)).catch(() => {});
    }, [hasPerm]);

    const fetchData = async () => {
        try {
            const res = await getAllCategories();
            setCategories(res.data);
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
                await updateCategory(editItem._id, data);
            } else {
                await createCategory(data);
            }
            setShowModal(false);
            resetForm();
            fetchData();
        } catch (error) {
            alert(error.response?.data?.message || 'Failed to save');
        }
    };

    const handleDelete = async (id) => {
        if (window.confirm('Delete this category?')) {
            try {
                await deleteCategory(id);
                fetchData();
            } catch (error) {
                alert('Failed to delete');
            }
        }
    };

    const openEdit = (item) => {
        setEditItem(item);
        setFormData({ name: item.name, description: item.description || '', order: item.order || 1, parentId: item.parentId || '',
            stockLocationId: item.stockLocationId || '' });
        setShowModal(true);
    };

    const resetForm = () => {
        setEditItem(null);
        setFormData({ name: '', description: '', order: 1, parentId: '', stockLocationId: '' });
        setImage(null);
    };

    if (loading) return <div className="admin-loading"><div className="spinner"></div></div>;

    return (
        <div className="admin-categories">
            <div className="page-header">
                <h1>Categories Management</h1>
                {hasPerm('menu.create') && (
                    <button className="btn btn-primary" onClick={() => { resetForm(); setShowModal(true); }}>
                        <FiPlus /> Add Category
                    </button>
                )}
            </div>

            <div className="categories-grid">
                {[...categories.filter(c => !c.parentId), ...categories.filter(c => c.parentId && !categories.some(p => p._id === c.parentId))]
                    .flatMap(parent => [parent, ...categories.filter(c => c.parentId === parent._id)])
                    .map(cat => (
                    <div key={cat._id} className={`category-item ${cat.parentId ? 'sub' : ''}`}>
                        <div className="category-image">
                            {cat.image ? (
                                <img src={getImageUrl(cat.image)} alt={cat.name} />
                            ) : (
                                <span>🍴</span>
                            )}
                        </div>
                        <div className="category-info">
                            <h3>{cat.parentId && <span className="sub-mark">↳ </span>}{cat.name}</h3>
                            {cat.parentId && <small className="muted">in {categories.find(p => p._id === cat.parentId)?.name}</small>}
                            <p>{cat.description || 'No description'}</p>
                        </div>
                        <div className="category-actions">
                            {hasPerm('menu.edit') && <button onClick={() => openEdit(cat)} className="icon-btn edit" aria-label="Edit"><FiEdit2 /></button>}
                            {hasPerm('menu.delete') && <button onClick={() => handleDelete(cat._id)} className="icon-btn delete" aria-label="Delete"><FiTrash2 /></button>}
                        </div>
                    </div>
                ))}
            </div>

            {showModal && (
                <div className="modal-overlay" onClick={() => setShowModal(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>{editItem ? 'Edit Category' : 'Add Category'}</h2>
                            <button className="modal-close" onClick={() => setShowModal(false)}>×</button>
                        </div>
                        <form onSubmit={handleSubmit}>
                            <div className="modal-body">
                                <div className="input-group">
                                    <label>Name *</label>
                                    <input type="text" className="input" value={formData.name}
                                        onChange={e => setFormData({ ...formData, name: e.target.value })} required />
                                </div>
                                <div className="input-group">
                                    <label>Parent category</label>
                                    <select className="input" value={formData.parentId}
                                        onChange={e => setFormData({ ...formData, parentId: e.target.value })}>
                                        <option value="">None (top level)</option>
                                        {categories.filter(c => !c.parentId && c._id !== editItem?._id)
                                            .map(c => <option key={c._id} value={c._id}>{c.name}</option>)}
                                    </select>
                                </div>
                                {locations.length > 0 && (
                                    <div className="input-group">
                                        <label>Sales take stock from</label>
                                        <select className="input" value={formData.stockLocationId} aria-label="Stock location"
                                            onChange={e => setFormData({ ...formData, stockLocationId: e.target.value })}>
                                            <option value="">{formData.parentId ? 'Same as parent category' : 'Cafe sales location'}</option>
                                            {locations.filter(l => l.isActive).map(l => <option key={l._id} value={l._id}>{l.name}</option>)}
                                        </select>
                                    </div>
                                )}
                                <div className="input-group">
                                    <label>Description</label>
                                    <textarea className="input" value={formData.description}
                                        onChange={e => setFormData({ ...formData, description: e.target.value })} rows={2} />
                                </div>
                                <div className="input-group">
                                    <label>Display Order</label>
                                    <input type="number" className="input" value={formData.order}
                                        onChange={e => setFormData({ ...formData, order: parseInt(e.target.value) })} />
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

export default AdminCategories;
