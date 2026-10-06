import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { FiHome, FiGrid, FiHeart, FiShoppingBag, FiUser } from 'react-icons/fi';
import { useCart } from '../context/CartContext';
import './BottomNav.css';
import useCxLang, { T } from '../lib/cxLang';

const W = {
    home: T('Home', 'होम', 'Home'),
    menu: T('Menu', 'मेन्यू', 'Menu'),
    saved: T('Saved', 'पसंदीदा', 'Saved'),
    cart: T('Cart', 'कार्ट', 'Cart'),
    me: T('Me', 'मैं', 'Me'),
    nav: T('Main', 'मुख्य', 'Main'),
};

// Which tab lights up for a page
const TABS = [
    { path: '/', icon: FiHome, word: W.home, match: (p) => p === '/' },
    { path: '/menu', icon: FiGrid, word: W.menu, match: (p) => /^\/(menu|categories)/.test(p) },
    { path: '/saved', icon: FiHeart, word: W.saved, match: (p) => p.startsWith('/saved') },
    { path: '/cart', icon: FiShoppingBag, word: W.cart, match: (p) => p.startsWith('/cart'), cart: true },
    { path: '/profile', icon: FiUser, word: W.me, match: (p) => /^\/(profile|look|history|rewards|order)/.test(p) },
];
// The dish and combo pages have their own Add bar at the bottom
const HIDE_ON = /^\/(item|combo)\//;

// Phone bottom bar: a floating glass pill, or a classic bar when the owner picks it (Look & themes → bottom bar)
const BottomNav = () => {
    const { pathname } = useLocation();
    const { t } = useCxLang();
    const { itemCount } = useCart();
    if (HIDE_ON.test(pathname)) return null;

    return (
        <nav className="bottom-nav cx-glass" aria-label={t(W.nav)}>
            {TABS.map(item => {
                const on = item.match(pathname);
                return (
                    <Link key={item.path} to={item.path} className={`nav-item ${on ? 'active' : ''}`}
                        aria-current={on ? 'page' : undefined} {...(item.cart ? { 'data-cart-target': true } : {})}>
                        <span className="nav-icon-wrap">
                            <item.icon className="nav-icon" aria-hidden="true" />
                            {item.cart && itemCount > 0 && <span className="cx-count">{itemCount}</span>}
                        </span>
                        <span className="nav-label">{t(item.word)}</span>
                    </Link>
                );
            })}
        </nav>
    );
};

export default BottomNav;
