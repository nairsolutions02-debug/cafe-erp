import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FiUser, FiPhone, FiMail, FiLogOut, FiSettings } from 'react-icons/fi';
import Header from '../components/Header';
import { useAuth } from '../context/AuthContext';
import './Profile.css';
import { useBrand } from '../context/BrandContext';

const Profile = () => {
    const brand = useBrand();
    const { user, isAuthenticated, logout, updateProfile } = useAuth();
    const navigate = useNavigate();
    const [editing, setEditing] = useState(false);
    const [name, setName] = useState(user?.name || '');
    const [email, setEmail] = useState(user?.email || '');
    const [loading, setLoading] = useState(false);

    const handleSave = async () => {
        setLoading(true);
        try {
            await updateProfile({ name, email });
            setEditing(false);
        } catch (error) {
            alert('Failed to update profile');
        } finally {
            setLoading(false);
        }
    };

    const handleLogout = () => {
        logout();
        navigate('/');
    };

    if (!isAuthenticated) {
        return (
            <div className="profile-page">
                <Header title="Profile" />
                <div className="login-prompt">
                    <div className="login-prompt-icon">👤</div>
                    <h2>Welcome to {brand.name}</h2>
                    <p>Login to manage your profile and track orders</p>
                    <Link to="/login" className="btn btn-primary">Login / Sign Up</Link>
                </div>
            </div>
        );
    }

    return (
        <div className="profile-page">
            <Header title="Profile" showCart={false} />

            <div className="profile-header">
                <div className="profile-avatar">
                    {user.name ? user.name.charAt(0).toUpperCase() : '👤'}
                </div>
                <h2>{user.name || 'Foodie'}</h2>
                <p>{user.phone}</p>
            </div>

            <div className="profile-section">
                <h3>Personal Information</h3>

                {editing ? (
                    <div className="edit-form">
                        <div className="input-group">
                            <label>Name</label>
                            <input
                                type="text"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                className="input"
                                placeholder="Your name"
                            />
                        </div>
                        <div className="input-group">
                            <label>Email</label>
                            <input
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                className="input"
                                placeholder="Your email"
                            />
                        </div>
                        <div className="edit-actions">
                            <button onClick={() => setEditing(false)} className="btn btn-ghost">
                                Cancel
                            </button>
                            <button onClick={handleSave} className="btn btn-primary" disabled={loading}>
                                {loading ? 'Saving...' : 'Save'}
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="info-list">
                        <div className="info-item">
                            <FiPhone className="info-icon" />
                            <div className="info-content">
                                <span className="info-label">Phone</span>
                                <span className="info-value">{user.phone}</span>
                            </div>
                        </div>
                        <div className="info-item">
                            <FiUser className="info-icon" />
                            <div className="info-content">
                                <span className="info-label">Name</span>
                                <span className="info-value">{user.name || 'Not set'}</span>
                            </div>
                        </div>
                        <div className="info-item">
                            <FiMail className="info-icon" />
                            <div className="info-content">
                                <span className="info-label">Email</span>
                                <span className="info-value">{user.email || 'Not set'}</span>
                            </div>
                        </div>
                        <button onClick={() => setEditing(true)} className="btn btn-secondary edit-btn">
                            Edit Profile
                        </button>
                    </div>
                )}
            </div>

            {user.role === 'admin' && (
                <div className="profile-section">
                    <Link to="/admin" className="admin-link">
                        <FiSettings />
                        <span>Admin Dashboard</span>
                    </Link>
                </div>
            )}

            <div className="profile-section">
                <button onClick={handleLogout} className="logout-btn">
                    <FiLogOut />
                    <span>Logout</span>
                </button>
            </div>
        </div>
    );
};

export default Profile;
