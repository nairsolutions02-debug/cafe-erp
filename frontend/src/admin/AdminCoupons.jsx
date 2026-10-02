import React, { useState, useEffect } from 'react';
import { FiPlus, FiEdit2, FiTrash2 } from 'react-icons/fi';
import { getAllCoupons, createCoupon, updateCoupon, deleteCoupon } from '../utils/api';
import './AdminCoupons.css';

const AdminCoupons = () => {
    const [coupons, setCoupons] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [editItem, setEditItem] = useState(null);
    const [formData, setFormData] = useState({
        code: '', description: '', discountType: 'percentage', discountValue: 10,
        minOrderAmount: 0, maxDiscount: '', usageLimit: -1,
        validFrom: '', validUntil: '', isActive: true
    });

    useEffect(() => { fetchData(); }, []);

    const fetchData = async () => {
        try {
            const res = await getAllCoupons();
            setCoupons(res.data);
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
                await updateCoupon(editItem._id, formData);
            } else {
                await createCoupon(formData);
            }
            setShowModal(false);
            resetForm();
            fetchData();
        } catch (error) {
            alert(error.response?.data?.message || 'Failed to save');
        }
    };

    const handleDelete = async (id) => {
        if (window.confirm('Delete this coupon?')) {
            try {
                await deleteCoupon(id);
                fetchData();
            } catch (error) {
                alert('Failed to delete');
            }
        }
    };

    const openEdit = (item) => {
        setEditItem(item);
        setFormData({
            code: item.code, description: item.description || '',
            discountType: item.discountType, discountValue: item.discountValue,
            minOrderAmount: item.minOrderAmount || 0, maxDiscount: item.maxDiscount || '',
            usageLimit: item.usageLimit, isActive: item.isActive,
            validFrom: item.validFrom.split('T')[0], validUntil: item.validUntil.split('T')[0]
        });
        setShowModal(true);
    };

    const resetForm = () => {
        setEditItem(null);
        setFormData({
            code: '', description: '', discountType: 'percentage', discountValue: 10,
            minOrderAmount: 0, maxDiscount: '', usageLimit: -1,
            validFrom: '', validUntil: '', isActive: true
        });
    };

    if (loading) return <div className="admin-loading"><div className="spinner"></div></div>;

    return (
        <div className="admin-coupons">
            <div className="page-header">
                <h1>Coupons & Offers</h1>
                <button className="btn btn-primary" onClick={() => { resetForm(); setShowModal(true); }}>
                    <FiPlus /> Add Coupon
                </button>
            </div>

            <div className="coupons-grid">
                {coupons.map(coupon => (
                    <div key={coupon._id} className={`coupon-card ${!coupon.isActive ? 'inactive' : ''}`}>
                        <div className="coupon-header">
                            <span className="coupon-code">{coupon.code}</span>
                            <div className="coupon-header-right">
                                <span className={`coupon-status ${coupon.isActive ? 'active' : 'inactive'}`}>
                                    {coupon.isActive ? 'Active' : 'Inactive'}
                                </span>
                                <div className="coupon-actions">
                                    <button onClick={() => openEdit(coupon)} className="icon-btn edit"><FiEdit2 /></button>
                                    <button onClick={() => handleDelete(coupon._id)} className="icon-btn delete"><FiTrash2 /></button>
                                </div>
                            </div>
                        </div>
                        <p className="coupon-desc">{coupon.description || 'No description'}</p>
                        <div className="coupon-value">
                            {coupon.discountType === 'percentage' ? `${coupon.discountValue}% OFF` : `₹${coupon.discountValue} OFF`}
                        </div>
                        <div className="coupon-meta">
                            <span>Min: ₹{coupon.minOrderAmount}</span>
                            <span>Used: {coupon.usedCount}/{coupon.usageLimit === -1 ? '∞' : coupon.usageLimit}</span>
                        </div>
                        <div className="coupon-validity">
                            Valid: {new Date(coupon.validFrom).toLocaleDateString()} - {new Date(coupon.validUntil).toLocaleDateString()}
                        </div>
                    </div>
                ))}
            </div>

            {showModal && (
                <div className="modal-overlay" onClick={() => setShowModal(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>{editItem ? 'Edit Coupon' : 'Add Coupon'}</h2>
                            <button className="modal-close" onClick={() => setShowModal(false)}>×</button>
                        </div>
                        <form onSubmit={handleSubmit}>
                            <div className="modal-body">
                                <div className="form-grid">
                                    <div className="input-group">
                                        <label>Code *</label>
                                        <input type="text" className="input" value={formData.code}
                                            onChange={e => setFormData({ ...formData, code: e.target.value.toUpperCase() })} required />
                                    </div>
                                    <div className="input-group">
                                        <label>Discount Type</label>
                                        <select className="input" value={formData.discountType}
                                            onChange={e => setFormData({ ...formData, discountType: e.target.value })}>
                                            <option value="percentage">Percentage</option>
                                            <option value="fixed">Fixed Amount</option>
                                        </select>
                                    </div>
                                    <div className="input-group">
                                        <label>Discount Value *</label>
                                        <input type="number" className="input" value={formData.discountValue}
                                            onChange={e => setFormData({ ...formData, discountValue: parseFloat(e.target.value) })} required />
                                    </div>
                                    <div className="input-group">
                                        <label>Min Order Amount</label>
                                        <input type="number" className="input" value={formData.minOrderAmount}
                                            onChange={e => setFormData({ ...formData, minOrderAmount: parseFloat(e.target.value) })} />
                                    </div>
                                    {formData.discountType === 'percentage' && (
                                        <div className="input-group">
                                            <label>Max Discount (for %)</label>
                                            <input type="number" className="input" value={formData.maxDiscount}
                                                onChange={e => setFormData({ ...formData, maxDiscount: e.target.value ? parseFloat(e.target.value) : '' })} />
                                        </div>
                                    )}
                                    <div className="input-group">
                                        <label>Usage Limit (-1 = unlimited)</label>
                                        <input type="number" className="input" value={formData.usageLimit}
                                            onChange={e => setFormData({ ...formData, usageLimit: parseInt(e.target.value) })} />
                                    </div>
                                    <div className="input-group">
                                        <label>Valid From *</label>
                                        <input type="date" className="input" value={formData.validFrom}
                                            onChange={e => setFormData({ ...formData, validFrom: e.target.value })} required />
                                    </div>
                                    <div className="input-group">
                                        <label>Valid Until *</label>
                                        <input type="date" className="input" value={formData.validUntil}
                                            onChange={e => setFormData({ ...formData, validUntil: e.target.value })} required />
                                    </div>
                                </div>
                                <div className="input-group">
                                    <label>Description</label>
                                    <textarea className="input" value={formData.description}
                                        onChange={e => setFormData({ ...formData, description: e.target.value })} rows={2} />
                                </div>
                                <label className="checkbox-inline">
                                    <input type="checkbox" checked={formData.isActive}
                                        onChange={e => setFormData({ ...formData, isActive: e.target.checked })} /> Active
                                </label>
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

export default AdminCoupons;
