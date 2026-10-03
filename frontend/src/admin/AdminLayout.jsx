import React, { useState, useEffect } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { FiLogOut, FiMenu, FiX } from 'react-icons/fi';
import { ADMIN_NAV } from './adminNav';
import GlobalSearch from './GlobalSearch';
import Notifications from './Notifications';
import Presence from './staffapp/Presence';
import { useAuth } from '../context/AuthContext';
import './AdminLayout.css';
import brand from '../brand';

const AdminLayout = () => {
    const { user, logout, socket, hasPerm } = useAuth();
    const location = useLocation();
    const navigate = useNavigate();
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [notifications, setNotifications] = useState([]);

    useEffect(() => {
        if (socket) {
            socket.on('new-order', (order) => {
                setNotifications(prev => [...prev, { type: 'order', message: `New order #${order.orderNumber}`, id: order._id }]);
                playNotificationSound();
            });

            socket.on('bill-requested', (order) => {
                setNotifications(prev => [...prev, { type: 'bill', message: `Bill requested for #${order.orderNumber}`, id: order._id }]);
                playNotificationSound();
            });

            return () => {
                socket.off('new-order');
                socket.off('bill-requested');
            };
        }
    }, [socket]);

    const playNotificationSound = () => {
        const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2teleQkSZ6Hl/J1dFgxTpfX/oGcbGFGq+v+gaBwYT6r6/59pGxlOq/r/nmsbGUyr+v+eaxsZTKv6/55rGxlMq/r/nmsbGUyr+v+eaxsZTKv6/55rGxlMq/r/nmsbGUyr+v+eaxsZTKv6/55rGxlMq/r/nmsbGUyr+v+eaxsZTKv6/55rGxlMq/r/nmsbGUyr+v+eaxsZTKv6/55rGxlMq/r/nmsbGUyr');
        audio.play().catch(() => { });
    };

    const handleLogout = () => {
        logout();
        navigate('/admin/login');
    };

    const menuItems = ADMIN_NAV.filter(item => !item.perm || hasPerm(item.perm));

    const isActive = (path, exact) => {
        if (exact) return location.pathname === path;
        return location.pathname.startsWith(path);
    };

    return (
        <div className="admin-layout">
            {/* Sidebar */}
            <aside className={`admin-sidebar ${sidebarOpen ? 'open' : ''}`}>
                <div className="sidebar-header">
                    <span className="sidebar-logo">🍽️</span>
                    <h2>{brand.name}</h2>
                    <button className="sidebar-close" onClick={() => setSidebarOpen(false)}>
                        <FiX />
                    </button>
                </div>

                <nav className="sidebar-nav">
                    {menuItems.map(item => (
                        <Link
                            key={item.path}
                            to={item.path}
                            className={`nav-link ${isActive(item.path, item.exact) ? 'active' : ''}`}
                            onClick={() => setSidebarOpen(false)}
                        >
                            <item.icon />
                            <span>{item.label}</span>
                        </Link>
                    ))}
                </nav>

                <div className="sidebar-footer">
                    <button onClick={handleLogout} className="logout-link">
                        <FiLogOut />
                        <span>Logout</span>
                    </button>
                </div>
            </aside>

            {/* Main Content */}
            <div className="admin-main">
                <header className="admin-header">
                    <button className="menu-toggle" onClick={() => setSidebarOpen(true)}>
                        <FiMenu />
                    </button>
                    <GlobalSearch />
                    <div className="header-right">
                        <Notifications />
                        <div className="admin-user">
                            <span className="admin-name">{user?.name || 'Admin'}</span>
                            <span className="admin-role">{user?.roleName}</span>
                        </div>
                    </div>
                </header>

                {user?.tenant?.status === 'grace' && (
                    <div className="billing-banner">
                        Subscription payment is overdue{user.tenant.paidUntil ? ` since ${new Date(user.tenant.paidUntil).toLocaleDateString('en-IN')}` : ''}.
                        The account will be locked after the grace period. Please contact N.A.I.R. Solutions.
                    </div>
                )}

                {/* Notifications */}
                {notifications.length > 0 && (
                    <div className="notifications-bar">
                        {notifications.slice(-3).map((notif, index) => (
                            <div
                                key={index}
                                className={`notification ${notif.type}`}
                                onClick={() => {
                                    navigate(`/admin/orders`);
                                    setNotifications(prev => prev.filter((_, i) => i !== index));
                                }}
                            >
                                {notif.message}
                                <button onClick={(e) => {
                                    e.stopPropagation();
                                    setNotifications(prev => prev.filter((_, i) => i !== index));
                                }}>✕</button>
                            </div>
                        ))}
                    </div>
                )}

                <Presence />
                <main className="admin-content">
                    <Outlet />
                </main>
            </div>

            {/* Overlay */}
            {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}
        </div>
    );
};

export default AdminLayout;
