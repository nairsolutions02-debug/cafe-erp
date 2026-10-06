import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { FiHome, FiClock, FiUser, FiGrid, FiGift } from 'react-icons/fi';
import './BottomNav.css';
import useCxLang, { T } from '../lib/cxLang';

const W = {
    home: T('Home', 'होम', 'Home'),
    menu: T('Menu', 'मेन्यू', 'Menu'),
    rewards: T('Rewards', 'रिवॉर्ड', 'Rewards'),
    history: T('History', 'पुराने ऑर्डर', 'Purane order'),
    profile: T('Profile', 'प्रोफ़ाइल', 'Profile'),
};

const BottomNav = () => {
    const location = useLocation();
    const { t } = useCxLang();

    const navItems = [
        { path: '/', icon: FiHome, label: t(W.home) },
        { path: '/categories', icon: FiGrid, label: t(W.menu) },
        { path: '/rewards', icon: FiGift, label: t(W.rewards) },
        { path: '/history', icon: FiClock, label: t(W.history) },
        { path: '/profile', icon: FiUser, label: t(W.profile) },
    ];

    return (
        <nav className="bottom-nav">
            {navItems.map(item => (
                <Link
                    key={item.path}
                    to={item.path}
                    className={`nav-item ${location.pathname === item.path ? 'active' : ''}`}
                >
                    <item.icon className="nav-icon" />
                    <span className="nav-label">{item.label}</span>
                </Link>
            ))}
        </nav>
    );
};

export default BottomNav;
