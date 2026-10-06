import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FiUser, FiPhone, FiMail, FiLogOut, FiSettings, FiDroplet, FiHeart, FiClock, FiGift, FiChevronRight } from 'react-icons/fi';
import { useCxLook } from '../context/BrandContext';
import { themeOf } from '../lib/cxThemes';
import Header from '../components/Header';
import { useAuth } from '../context/AuthContext';
import './Profile.css';
import { useBrand } from '../context/BrandContext';
import useCxLang, { T } from '../lib/cxLang';
import { LangChips } from '../components/cx/LangPicker';

const W = {
    profile: T('Profile', 'प्रोफ़ाइल', 'Profile'),
    updateFailed: T('Failed to update profile', 'प्रोफ़ाइल अपडेट नहीं हो पाई', 'Profile update nahi ho payi'),
    welcome: T('Welcome to {name}', '{name} में स्वागत है', '{name} mein welcome!'),
    loginSub: T('Login to manage your profile and track orders', 'प्रोफ़ाइल और ऑर्डर देखने के लिए लॉग इन करें', 'Profile aur order dekhne ke liye login karo'),
    loginBtn: T('Login / Sign Up', 'लॉग इन / साइन अप', 'Login / Sign up'),
    foodie: T('Foodie', 'फ़ूडी', 'Foodie'),
    personal: T('Personal Information', 'आपकी जानकारी', 'Aapki jaankari'),
    name: T('Name', 'नाम', 'Naam'),
    namePh: T('Your name', 'आपका नाम', 'Aapka naam'),
    email: T('Email', 'ईमेल', 'Email'),
    emailPh: T('Your email', 'आपका ईमेल', 'Aapka email'),
    cancel: T('Cancel', 'रद्द करें', 'Cancel'),
    saving: T('Saving...', 'सेव हो रहा है...', 'Save ho raha hai...'),
    save: T('Save', 'सेव करें', 'Save karo'),
    phone: T('Phone', 'फ़ोन', 'Phone'),
    notSet: T('Not set', 'नहीं डाला', 'Nahi daala'),
    edit: T('Edit Profile', 'प्रोफ़ाइल बदलें', 'Profile badlo'),
    language: T('Language', 'भाषा', 'Bhasha'),
    admin: T('Admin Dashboard', 'एडमिन डैशबोर्ड', 'Admin dashboard'),
    logout: T('Logout', 'लॉग आउट', 'Logout'),
    look: T('Look', 'रूप-रंग', 'Look'),
    lookSub: T('Theme, light or dark', 'थीम, हल्का या गहरा', 'Theme, light ya dark'),
    saved: T('Saved', 'पसंदीदा', 'Saved'),
    savedSub: T('Your favourite dishes', 'आपके पसंदीदा आइटम', 'Aapki favourite dishes'),
    orders: T('Your orders', 'आपके ऑर्डर', 'Aapke order'),
    ordersSub: T('Past orders and bills', 'पुराने ऑर्डर और बिल', 'Purane order aur bill'),
    rewards: T('Rewards', 'रिवॉर्ड', 'Rewards'),
    rewardsSub: T('Points, coupons and gifts', 'पॉइंट, कूपन और गिफ़्ट', 'Points, coupon aur gift'),
};

const Profile = () => {
    const brand = useBrand();
    const { lang, t } = useCxLang();
    const cx = useCxLook();
    const themeName = themeOf(cx.key, cx.look).name;
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
            alert(t(W.updateFailed));
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
                <Header title={t(W.profile)} />
                <div className="login-prompt">
                    <div className="login-prompt-icon cx-av"><FiUser /></div>
                    <h2>{t(W.welcome, { name: brand.name })}</h2>
                    <p>{t(W.loginSub)}</p>
                    <Link to="/login" className="btn btn-primary">{t(W.loginBtn)}</Link>
                </div>
            </div>
        );
    }

    return (
        <div className="profile-page">
            <Header title={t(W.profile)} showCart={false} />

            <div className="profile-wrap">
            <div className="profile-header">
                <div className="profile-avatar cx-av">
                    {user.name ? user.name.charAt(0).toUpperCase() : <FiUser />}
                </div>
                <div className="profile-who">
                    <h2>{user.name || t(W.foodie)}</h2>
                    <p>{user.phone}</p>
                </div>
            </div>

            <nav className="profile-section profile-rows cx-glass">
                {[
                    ['/look', FiDroplet, W.look, themeName?.[lang] || themeName?.en || t(W.lookSub)],
                    ['/saved', FiHeart, W.saved, t(W.savedSub)],
                    ['/history', FiClock, W.orders, t(W.ordersSub)],
                    ['/rewards', FiGift, W.rewards, t(W.rewardsSub)],
                ].map(([to, Icon, word, sub]) => (
                    <Link key={to} to={to} className="profile-row">
                        <span className="profile-row-ic">{Icon && <Icon aria-hidden="true" />}</span>
                        <span className="profile-row-t"><b>{t(word)}</b><small>{sub}</small></span>
                        <FiChevronRight className="profile-row-go" aria-hidden="true" />
                    </Link>
                ))}
            </nav>

            <div className="profile-section cx-glass">
                <h3>{t(W.personal)}</h3>

                {editing ? (
                    <div className="edit-form">
                        <div className="input-group">
                            <label>{t(W.name)}</label>
                            <input
                                type="text"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                className="input"
                                placeholder={t(W.namePh)}
                            />
                        </div>
                        <div className="input-group">
                            <label>{t(W.email)}</label>
                            <input
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                className="input"
                                placeholder={t(W.emailPh)}
                            />
                        </div>
                        <div className="edit-actions">
                            <button onClick={() => setEditing(false)} className="btn btn-ghost">
                                {t(W.cancel)}
                            </button>
                            <button onClick={handleSave} className="btn btn-primary" disabled={loading}>
                                {loading ? t(W.saving) : t(W.save)}
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="info-list">
                        <div className="info-item">
                            <FiPhone className="info-icon" />
                            <div className="info-content">
                                <span className="info-label">{t(W.phone)}</span>
                                <span className="info-value">{user.phone}</span>
                            </div>
                        </div>
                        <div className="info-item">
                            <FiUser className="info-icon" />
                            <div className="info-content">
                                <span className="info-label">{t(W.name)}</span>
                                <span className="info-value">{user.name || t(W.notSet)}</span>
                            </div>
                        </div>
                        <div className="info-item">
                            <FiMail className="info-icon" />
                            <div className="info-content">
                                <span className="info-label">{t(W.email)}</span>
                                <span className="info-value">{user.email || t(W.notSet)}</span>
                            </div>
                        </div>
                        <button onClick={() => setEditing(true)} className="btn btn-secondary edit-btn">
                            {t(W.edit)}
                        </button>
                    </div>
                )}
            </div>

            <div className="profile-section cx-glass">
                <h3>{t(W.language)}</h3>
                <LangChips />
            </div>

            {user.role === 'admin' && (
                <div className="profile-section">
                    <Link to="/admin" className="admin-link">
                        <FiSettings />
                        <span>{t(W.admin)}</span>
                    </Link>
                </div>
            )}

            <div className="profile-section">
                <button onClick={handleLogout} className="logout-btn">
                    <FiLogOut />
                    <span>{t(W.logout)}</span>
                </button>
            </div>
            </div>
        </div>
    );
};

export default Profile;
