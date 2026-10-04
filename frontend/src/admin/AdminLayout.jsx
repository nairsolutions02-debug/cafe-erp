import React, { useState, useEffect } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { FiLogOut, FiMenu, FiX, FiChevronDown, FiHelpCircle } from 'react-icons/fi';
import { NAV_SECTIONS, QUICK_BAR, LANGS, tr, sectionFor, navItem } from './adminNav';
import GlobalSearch from './GlobalSearch';
import Notifications from './Notifications';
import Presence from './staffapp/Presence';
import { useAuth } from '../context/AuthContext';
import './AdminLayout.css';
import brand from '../brand';

// Menu language (English / हिन्दी / Hinglish), remembered on this device
const readLang = () => {
    try { return localStorage.getItem('menuLang') || 'en'; } catch { return 'en'; }
};

const AdminLayout = () => {
    const { user, logout, socket, hasPerm } = useAuth();
    const location = useLocation();
    const navigate = useNavigate();
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [notifications, setNotifications] = useState([]);
    const [lang, setLang] = useState(readLang);
    const current = sectionFor(location.pathname);
    const [openSection, setOpenSection] = useState(current?.section.key || 'home');
    useEffect(() => { if (current) setOpenSection(current.section.key); }, [current?.section.key]); // eslint-disable-line react-hooks/exhaustive-deps
    const chooseLang = (key) => {
        setLang(key);
        try { localStorage.setItem('menuLang', key); } catch { /* private mode */ }
        window.dispatchEvent(new Event('menulang'));
    };
    // The Help page has its own language switch; keep the menu in step with it
    useEffect(() => {
        const sync = () => setLang(readLang());
        window.addEventListener('menulang', sync);
        return () => window.removeEventListener('menulang', sync);
    }, []);

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

    const allowed = (item) => !item.perm || hasPerm(item.perm);
    const sections = NAV_SECTIONS.map(sec => ({ ...sec, items: sec.items.filter(allowed) })).filter(sec => sec.items.length > 0);

    const isActive = (path, exact) => {
        if (exact) return location.pathname === path;
        return location.pathname === path || location.pathname.startsWith(path + '/');
    };
    // The sidebar line to highlight: the page itself, or for a tab-only page (e.g. Order history) its parent
    const activeSidebarPath = (() => {
        if (!current) return null;
        if (!current.item.tab) return current.item.path;
        const list = current.section.items;
        for (let i = list.indexOf(current.item) - 1; i >= 0; i--) if (!list[i].tab) return list[i].path;
        return null;
    })();

    // Pages of the current section, shown as tabs above the page (Counter and Kiosk keep the whole screen)
    const fullScreen = ['/admin/pos', '/admin/kiosk'].some(p => location.pathname.startsWith(p));
    const sectionTabs = current && !fullScreen ? current.section.items.filter(allowed) : [];
    const quick = QUICK_BAR.map(navItem).filter(i => i && allowed(i));

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
                    {sections.map(sec => {
                        const open = openSection === sec.key;
                        const sidebarItems = sec.items.filter(i => !i.tab);
                        // A section with a single page opens that page directly
                        if (sidebarItems.length === 1) {
                            const item = sidebarItems[0];
                            return (
                                <Link key={sec.key} to={item.path} onClick={() => setSidebarOpen(false)}
                                    className={`nav-link nav-section${current?.section.key === sec.key ? ' active' : ''}`}>
                                    <sec.icon /><span>{tr(sec.label, lang)}</span>
                                </Link>
                            );
                        }
                        return (
                            <div key={sec.key} className={`nav-group${open ? ' open' : ''}`}>
                                <button type="button" className={`nav-link nav-section${current?.section.key === sec.key ? ' current' : ''}`}
                                    aria-expanded={open} onClick={() => setOpenSection(open ? '' : sec.key)}>
                                    <sec.icon /><span>{tr(sec.label, lang)}</span><FiChevronDown className="nav-chevron" />
                                </button>
                                {open && (
                                    <div className="nav-sub">
                                        {sidebarItems.map(item => (
                                            <Link key={item.path} to={item.path} onClick={() => setSidebarOpen(false)}
                                                className={`nav-sublink${activeSidebarPath === item.path ? ' active' : ''}`}>
                                                {tr(item.label, lang)}
                                            </Link>
                                        ))}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </nav>

                <div className="lang-switch" role="group" aria-label="Menu language">
                    {LANGS.map(l => (
                        <button key={l.key} type="button" className={lang === l.key ? 'on' : ''} aria-pressed={lang === l.key}
                            onClick={() => chooseLang(l.key)}>{l.label}</button>
                    ))}
                </div>

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
                        <Link className="header-help" to={location.pathname === '/admin/help' ? '/admin/help?tab=tickets' : `/admin/help?from=${encodeURIComponent(location.pathname + location.search)}`}
                            aria-label="Help and report a problem" title="Help · report a problem"><FiHelpCircle /></Link>
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
                <main className={`admin-content${quick.length && !fullScreen ? ' with-quickbar' : ''}`}>
                    {sectionTabs.length > 1 && (
                        <nav className="section-tabs" aria-label={tr(current.section.label, lang)}>
                            <span className="section-name">{tr(current.section.label, lang)}</span>
                            <div className="section-tab-row">
                                {sectionTabs.map(item => (
                                    <Link key={item.path} to={item.path}
                                        className={`section-tab${current.item.path === item.path ? ' active' : ''}`}
                                        aria-current={current.item.path === item.path ? 'page' : undefined}>
                                        {tr(item.label, lang)}
                                    </Link>
                                ))}
                            </div>
                        </nav>
                    )}
                    <Outlet />
                </main>

                {/* Phone quick bar: the screens staff use all day */}
                {quick.length > 0 && !fullScreen && (
                    <nav className="quick-bar" aria-label="Quick">
                        {quick.map(item => (
                            <Link key={item.path} to={item.path} className={`quick-link${isActive(item.path, item.exact) ? ' active' : ''}`}>
                                <item.icon /><span>{tr(item.label, lang)}</span>
                            </Link>
                        ))}
                    </nav>
                )}
            </div>

            {/* Overlay */}
            {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}
        </div>
    );
};

export default AdminLayout;
