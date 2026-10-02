import React, { useState, useEffect } from 'react';
import {
    getLoyaltySettings,
    updateLoyaltySettings,
    getLoyaltyUsers,
    adjustUserPoints,
    getAllMenuItems,
    setProductBonusPoints,
    getLoyaltyOffers,
    createLoyaltyOffer,
    updateLoyaltyOffer,
    deleteLoyaltyOffer
} from '../utils/api';
import { getImageUrl } from '../utils/config';
import { FiStar, FiSettings, FiUsers, FiGift, FiPlus, FiMinus, FiSave, FiTag, FiEdit, FiTrash2 } from 'react-icons/fi';

import Loader from '../components/Loader';
import './AdminLoyalty.css';

const AdminLoyalty = () => {
    const [activeTab, setActiveTab] = useState('settings');
    const [settings, setSettings] = useState(null);
    const [users, setUsers] = useState([]);
    const [menuItems, setMenuItems] = useState([]);
    const [offers, setOffers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [adjustModal, setAdjustModal] = useState(null);
    const [adjustAmount, setAdjustAmount] = useState(0);

    const [offerModal, setOfferModal] = useState(false);
    const [editOffer, setEditOffer] = useState(null);
    const [offerFormData, setOfferFormData] = useState({
        name: '', description: '', pointsRequired: 100, discountValue: 10, minOrderValue: 0, isActive: true
    });

    useEffect(() => {
        fetchData();
    }, []);

    const fetchData = async () => {
        try {
            const [settingsRes, usersRes, menuRes, offersRes] = await Promise.all([
                getLoyaltySettings(),
                getLoyaltyUsers(),
                getAllMenuItems(),
                getLoyaltyOffers()
            ]);
            setSettings(settingsRes.data);
            setUsers(usersRes.data);
            setMenuItems(menuRes.data);
            setOffers(offersRes.data);
        } catch (error) {
            console.error('Error:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleSaveSettings = async () => {
        setSaving(true);
        try {
            await updateLoyaltySettings(settings);
            alert('Settings saved successfully!');
        } catch (error) {
            alert('Error saving settings');
        } finally {
            setSaving(false);
        }
    };

    const handleAdjustPoints = async () => {
        if (!adjustModal || adjustAmount === 0) return;

        try {
            await adjustUserPoints(adjustModal._id, adjustAmount, 'Manual adjustment by admin');
            fetchData();
            setAdjustModal(null);
            setAdjustAmount(0);
        } catch (error) {
            alert('Error adjusting points');
        }
    };

    const handleBonusPointsChange = async (productId, points) => {
        try {
            await setProductBonusPoints(productId, points);
            setMenuItems(prev => prev.map(item =>
                item._id === productId ? { ...item, bonusLoyaltyPoints: points } : item
            ));
        } catch (error) {
            console.error('Error updating bonus points:', error);
        }
    };

    const handleOfferSubmit = async (e) => {
        e.preventDefault();
        try {
            if (editOffer) {
                await updateLoyaltyOffer(editOffer._id, offerFormData);
            } else {
                await createLoyaltyOffer(offerFormData);
            }
            setOfferModal(false);
            setEditOffer(null);
            setOfferFormData({ name: '', description: '', pointsRequired: 100, discountValue: 10, minOrderValue: 0, isActive: true });
            fetchData();
        } catch (error) {
            alert('Error saving offer');
        }
    };

    const handleDeleteOffer = async (id) => {
        if (!window.confirm('Are you sure you want to delete this offer?')) return;
        try {
            await deleteLoyaltyOffer(id);
            fetchData();
        } catch (error) {
            alert('Error deleting offer');
        }
    };

    const openEditOffer = (offer) => {
        setEditOffer(offer);
        setOfferFormData({ ...offer });
        setOfferModal(true);
    };

    if (loading) return <Loader message="Loading loyalty settings..." />;

    return (
        <div className="admin-loyalty">
            <div className="page-header">
                <div>
                    <h1>🪙 Loyalty Points</h1>
                    <p>Manage customer rewards and loyalty program</p>
                </div>
            </div>

            {/* Tabs */}
            <div className="loyalty-tabs">
                <button
                    className={`tab-btn ${activeTab === 'settings' ? 'active' : ''}`}
                    onClick={() => setActiveTab('settings')}
                >
                    <FiSettings /> Settings
                </button>
                <button
                    className={`tab-btn ${activeTab === 'users' ? 'active' : ''}`}
                    onClick={() => setActiveTab('users')}
                >
                    <FiUsers /> Users ({users.length})
                </button>
                <button
                    className={`tab-btn ${activeTab === 'products' ? 'active' : ''}`}
                    onClick={() => setActiveTab('products')}
                >
                    <FiGift /> Bonus Points
                </button>
                <button
                    className={`tab-btn ${activeTab === 'offers' ? 'active' : ''}`}
                    onClick={() => setActiveTab('offers')}
                >
                    <FiTag /> Deals/Offers
                </button>
            </div>

            {/* Settings Tab */}
            {activeTab === 'settings' && settings && (
                <div className="settings-section">
                    <div className="settings-card">
                        <h2>⚙️ Earning Rules</h2>
                        <div className="settings-grid">
                            <div className="setting-item">
                                <label>Points per ₹1 spent</label>
                                <input
                                    type="number"
                                    value={settings.pointsPerRupee}
                                    onChange={e => setSettings({ ...settings, pointsPerRupee: Number(e.target.value) })}
                                    min="0"
                                    step="0.1"
                                />
                                <small>e.g., 1 = 1 point per ₹1</small>
                            </div>
                            <div className="setting-item">
                                <label>Minimum Order for Points</label>
                                <input
                                    type="number"
                                    value={settings.minOrderForPoints}
                                    onChange={e => setSettings({ ...settings, minOrderForPoints: Number(e.target.value) })}
                                    min="0"
                                />
                                <small>Minimum order value to earn points</small>
                            </div>
                        </div>
                    </div>

                    <div className="settings-card">
                        <h2>🎁 Redemption Rules</h2>
                        <div className="settings-grid">
                            <div className="setting-item">
                                <label>Points to ₹ Ratio</label>
                                <input
                                    type="number"
                                    value={settings.pointsToRupeeRatio}
                                    onChange={e => setSettings({ ...settings, pointsToRupeeRatio: Number(e.target.value) })}
                                    min="1"
                                />
                                <small>e.g., 10 = 10 points = ₹1 discount</small>
                            </div>
                            <div className="setting-item">
                                <label>Minimum Points to Redeem</label>
                                <input
                                    type="number"
                                    value={settings.minPointsToRedeem}
                                    onChange={e => setSettings({ ...settings, minPointsToRedeem: Number(e.target.value) })}
                                    min="0"
                                />
                                <small>Minimum points needed to redeem</small>
                            </div>
                            <div className="setting-item">
                                <label>Max Redemption %</label>
                                <input
                                    type="number"
                                    value={settings.maxRedemptionPercent}
                                    onChange={e => setSettings({ ...settings, maxRedemptionPercent: Number(e.target.value) })}
                                    min="0"
                                    max="100"
                                />
                                <small>Max % of order payable with points</small>
                            </div>
                        </div>
                    </div>

                    <div className="settings-card">
                        <h2>🔘 Program Status</h2>
                        <label className="toggle-setting">
                            <input
                                type="checkbox"
                                checked={settings.isActive}
                                onChange={e => setSettings({ ...settings, isActive: e.target.checked })}
                            />
                            <span>Loyalty Program Active</span>
                        </label>
                    </div>

                    <button className="btn btn-primary save-btn" onClick={handleSaveSettings} disabled={saving}>
                        <FiSave /> {saving ? 'Saving...' : 'Save Settings'}
                    </button>
                </div>
            )}

            {/* Users Tab */}
            {activeTab === 'users' && (
                <div className="users-section">
                    <div className="users-table">
                        <table>
                            <thead>
                                <tr>
                                    <th>Customer</th>
                                    <th>Phone</th>
                                    <th>Current Points</th>
                                    <th>Total Earned</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {users.map(user => (
                                    <tr key={user._id}>
                                        <td>{user.name || 'Customer'}</td>
                                        <td>{user.phone}</td>
                                        <td className="points-cell">
                                            <span className="points-badge">🪙 {user.loyaltyPoints || 0}</span>
                                        </td>
                                        <td>{user.totalPointsEarned || 0}</td>
                                        <td>
                                            <button
                                                className="btn btn-sm btn-primary"
                                                onClick={() => setAdjustModal(user)}
                                            >
                                                Adjust Points
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                                {users.length === 0 && (
                                    <tr>
                                        <td colSpan="5" className="no-data">No users found</td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Products Tab */}
            {activeTab === 'products' && (
                <div className="products-section">
                    <p className="section-info">
                        Set bonus loyalty points for specific products. These are <strong>extra</strong> points
                        customers earn when ordering these items (in addition to regular points).
                    </p>
                    <div className="products-grid">
                        {menuItems.map(item => (
                            <div key={item._id} className="product-points-card">
                                <div className="product-info">
                                    {item.image ? (
                                        <img src={getImageUrl(item.image)} alt={item.name} />
                                    ) : (
                                        <div className="no-image">🍽️</div>
                                    )}
                                    <div>
                                        <h4>{item.name}</h4>
                                        <span>₹{item.price}</span>
                                    </div>
                                </div>
                                <div className="bonus-input">
                                    <label>Bonus Points</label>
                                    <div className="points-adjuster">
                                        <button
                                            onClick={() => handleBonusPointsChange(item._id, Math.max(0, (item.bonusLoyaltyPoints || 0) - 1))}
                                        >
                                            <FiMinus />
                                        </button>
                                        <span>{item.bonusLoyaltyPoints || 0}</span>
                                        <button
                                            onClick={() => handleBonusPointsChange(item._id, (item.bonusLoyaltyPoints || 0) + 1)}
                                        >
                                            <FiPlus />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Offers Tab */}
            {activeTab === 'offers' && (
                <div className="offers-section">
                    <div className="section-header-with-action">
                        <p className="section-info">
                            Create specific rewards that customers can redeem with their points.
                        </p>
                        <button className="btn btn-primary" onClick={() => { setEditOffer(null); setOfferFormData({ name: '', description: '', pointsRequired: 100, discountValue: 50, minOrderValue: 0, isActive: true }); setOfferModal(true); }}>
                            <FiPlus /> Add Offer
                        </button>
                    </div>

                    <div className="offers-grid">
                        {offers.map(offer => (
                            <div key={offer._id} className={`offer-card ${!offer.isActive ? 'inactive' : ''}`}>
                                <div className="offer-badge">🪙 {offer.pointsRequired} pts</div>
                                <h3>{offer.name}</h3>
                                <p className="offer-desc">{offer.description}</p>
                                <div className="offer-value">Discount: ₹{offer.discountValue}</div>
                                <div className="offer-actions">
                                    <button className="icon-btn edit" onClick={() => openEditOffer(offer)}><FiEdit /></button>
                                    <button className="icon-btn delete" onClick={() => handleDeleteOffer(offer._id)}><FiTrash2 /></button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Adjust Points Modal */}
            {adjustModal && (
                <div className="modal-overlay" onClick={() => setAdjustModal(null)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <h2>Adjust Points for {adjustModal.name || adjustModal.phone}</h2>
                        <p>Current Balance: <strong>🪙 {adjustModal.loyaltyPoints || 0}</strong></p>

                        <div className="adjust-controls">
                            <button onClick={() => setAdjustAmount(prev => prev - 50)}>-50</button>
                            <button onClick={() => setAdjustAmount(prev => prev - 10)}>-10</button>
                            <input
                                type="number"
                                value={adjustAmount}
                                onChange={e => setAdjustAmount(Number(e.target.value))}
                            />
                            <button onClick={() => setAdjustAmount(prev => prev + 10)}>+10</button>
                            <button onClick={() => setAdjustAmount(prev => prev + 50)}>+50</button>
                        </div>

                        <p className="new-balance">
                            New Balance: <strong>🪙 {(adjustModal.loyaltyPoints || 0) + adjustAmount}</strong>
                        </p>

                        <div className="modal-actions">
                            <button className="btn btn-secondary" onClick={() => setAdjustModal(null)}>Cancel</button>
                            <button className="btn btn-primary" onClick={handleAdjustPoints}>
                                {adjustAmount >= 0 ? 'Add Points' : 'Deduct Points'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Offer Modal */}
            {offerModal && (
                <div className="modal-overlay" onClick={() => setOfferModal(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <h2>{editOffer ? 'Edit Offer' : 'Add New Offer'}</h2>
                        <form onSubmit={handleOfferSubmit} className="offer-form">
                            <div className="input-group">
                                <label>Offer Name (e.g., ₹50 Discount)</label>
                                <input
                                    type="text"
                                    required
                                    className="input"
                                    value={offerFormData.name}
                                    onChange={e => setOfferFormData({ ...offerFormData, name: e.target.value })}
                                />
                            </div>
                            <div className="input-group">
                                <label>Description</label>
                                <input
                                    type="text"
                                    className="input"
                                    value={offerFormData.description}
                                    onChange={e => setOfferFormData({ ...offerFormData, description: e.target.value })}
                                />
                            </div>
                            <div className="flex-row">
                                <div className="input-group">
                                    <label>Points Required</label>
                                    <input
                                        type="number"
                                        required
                                        className="input"
                                        value={offerFormData.pointsRequired}
                                        onChange={e => setOfferFormData({ ...offerFormData, pointsRequired: Number(e.target.value) })}
                                    />
                                </div>
                                <div className="input-group">
                                    <label>Discount Value (₹)</label>
                                    <input
                                        type="number"
                                        required
                                        className="input"
                                        value={offerFormData.discountValue}
                                        onChange={e => setOfferFormData({ ...offerFormData, discountValue: Number(e.target.value) })}
                                    />
                                </div>
                            </div>
                            <div className="input-group">
                                <label>Minimum Order Value (Optional)</label>
                                <input
                                    type="number"
                                    className="input"
                                    value={offerFormData.minOrderValue}
                                    onChange={e => setOfferFormData({ ...offerFormData, minOrderValue: Number(e.target.value) })}
                                />
                            </div>
                            <label className="toggle-setting">
                                <input
                                    type="checkbox"
                                    checked={offerFormData.isActive}
                                    onChange={e => setOfferFormData({ ...offerFormData, isActive: e.target.checked })}
                                />
                                <span>Offer Active</span>
                            </label>

                            <div className="modal-actions">
                                <button type="button" className="btn btn-secondary" onClick={() => setOfferModal(false)}>Cancel</button>
                                <button type="submit" className="btn btn-primary">Save Offer</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AdminLoyalty;
