import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { FiHome, FiClock, FiUser, FiGrid } from 'react-icons/fi';
import './BottomNav.css';

const BottomNav = () => {
    const location = useLocation();

    const navItems = [
        { path: '/', icon: FiHome, label: 'Home' },
        { path: '/categories', icon: FiGrid, label: 'Menu' },
        { path: '/history', icon: FiClock, label: 'History' },
        { path: '/profile', icon: FiUser, label: 'Profile' },
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
