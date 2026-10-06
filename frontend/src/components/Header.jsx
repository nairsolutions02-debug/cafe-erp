import React, { useState, useEffect } from 'react';
import { Link, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { FiShoppingBag, FiSearch, FiClock, FiArrowLeft, FiHeart } from 'react-icons/fi';
import { useCart } from '../context/CartContext';
import { useAuth } from '../context/AuthContext';
import { getMenuItems, getMyLoyaltyPoints } from '../utils/api';
import { getImageUrl } from '../utils/config';
import './Header.css';
import { useBrand, useCxLook } from '../context/BrandContext';
import TableChip from './cx/TableChip';
import Coin from './cx/Coin';
import { LangButton } from './cx/LangPicker';
import Art from './cx/Art';
import { artFor } from './cx/artKinds';
import useCxLang, { T } from '../lib/cxLang';

const HINTS = {
    hi: ['मसाला डोसा खोजें…', 'चाय, कॉफ़ी, नाश्ता…', 'मेन्यू में खोजें…'],
    hg: ['Masala Dosa dhoondho…', 'Chai, coffee, nashta…', 'Menu mein dhoondho…'],
};
const W = {
    home: T('Home', 'होम', 'Home'), menu: T('Menu', 'मेन्यू', 'Menu'), combos: T('Combos', 'कॉम्बो', 'Combos'),
    rewards: T('Rewards', 'रिवॉर्ड', 'Rewards'), history: T('Order history', 'पुराने ऑर्डर', 'Purane order'),
    profile: T('Me', 'मैं', 'Me'), back: T('Back', 'पीछे', 'Peeche'), search: T('Search the menu', 'मेन्यू में खोजें', 'Menu mein dhoondho'),
    saved: T('Saved', 'पसंदीदा', 'Saved'), cart: T('Cart', 'कार्ट', 'Cart'), points: T('{n} points', '{n} पॉइंट', '{n} points'),
};

// Customer app top bar.
//   Phone: a slim bar with back / logo, the page title, table, language and order history (Home has its own greeting
//   instead, so the bar is hidden there). Laptop (1024 px and up): logo, Home · Menu · Combos · Rewards, search,
//   saved, cart and the customer's letter.
const Header = ({ title, showCart = true, showBack = false, home = false }) => {
    const brand = useBrand();
    const { hasCombos } = useCxLook();
    const { lang, t } = useCxLang();
    const { isAuthenticated, user } = useAuth();
    const { itemCount } = useCart();
    const navigate = useNavigate();
    const { pathname, search } = useLocation();
    const [searchTerm, setSearchTerm] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [showDropdown, setShowDropdown] = useState(false);
    const [loyaltyPoints, setLoyaltyPoints] = useState(null);

    // Animated placeholder
    const placeholderTexts = HINTS[lang] || brand.searchHints;
    const [placeholderIndex, setPlaceholderIndex] = useState(0);
    const [displayPlaceholder, setDisplayPlaceholder] = useState('');
    const [isTyping, setIsTyping] = useState(true);

    useEffect(() => {
        if (!isAuthenticated || user?.role !== 'customer') return;
        getMyLoyaltyPoints().then(res => setLoyaltyPoints(res.data.currentPoints || 0)).catch(() => {});
    }, [isAuthenticated, user?.role]);

    // Typewriter effect for placeholder
    useEffect(() => {
        const currentText = placeholderTexts[placeholderIndex % placeholderTexts.length] || '';
        const charIndex = displayPlaceholder.length;
        const timer = setTimeout(() => {
            if (isTyping) {
                if (charIndex < currentText.length) setDisplayPlaceholder(currentText.slice(0, charIndex + 1));
                else setTimeout(() => setIsTyping(false), 2000);
            } else if (charIndex > 0) {
                setDisplayPlaceholder(currentText.slice(0, charIndex - 1));
            } else {
                setPlaceholderIndex((prev) => (prev + 1) % placeholderTexts.length);
                setIsTyping(true);
            }
        }, isTyping ? 100 : 50);
        return () => clearTimeout(timer);
    }, [displayPlaceholder, isTyping, placeholderIndex]); // eslint-disable-line react-hooks/exhaustive-deps

    // Search as you type
    useEffect(() => {
        const timer = setTimeout(async () => {
            if (searchTerm.trim().length > 1) {
                try {
                    const { data } = await getMenuItems({ search: searchTerm });
                    setSearchResults(data.slice(0, 6));
                    setShowDropdown(true);
                } catch (error) {
                    console.error('Search error', error);
                }
            } else {
                setSearchResults([]);
                setShowDropdown(false);
            }
        }, 300);
        return () => clearTimeout(timer);
    }, [searchTerm]);

    const handleSearch = (e) => {
        e.preventDefault();
        if (searchTerm.trim()) {
            setShowDropdown(false);
            navigate(`/menu?search=${encodeURIComponent(searchTerm)}`);
        }
    };

    const initial = (user?.role === 'customer' && user?.name ? user.name.trim().charAt(0) : '').toUpperCase();
    const combosOn = pathname === '/menu' && /view=combos/.test(search);

    return (
        <header className={`header ${home ? 'header-home' : ''}`}>
            <div className="header-content">
                {showBack ? (
                    <button className="cx-ib cx-glass header-back" aria-label={t(W.back)}
                        onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))}>
                        <FiArrowLeft />
                    </button>
                ) : null}
                <Link to="/" className={`header-logo ${showBack ? 'has-back' : ''}`} aria-label={brand.name}>
                    {brand.logo ? <img src={brand.logo} alt="" className="logo-image" />
                        : <span className="logo-mark cx-pri" aria-hidden="true">{(brand.name || 'C').charAt(0)}</span>}
                    <span className="logo-name">{brand.name}</span>
                </Link>

                {title && <h1 className="header-title">{title}</h1>}

                {/* Laptops: the phone's bottom bar is hidden, so its pages sit here */}
                <nav className="header-desk-nav" aria-label={t(W.menu)}>
                    <NavLink to="/" end>{t(W.home)}</NavLink>
                    <NavLink to="/menu" className={({ isActive }) => (isActive && !combosOn ? 'active' : '')}>{t(W.menu)}</NavLink>
                    {hasCombos && <NavLink to="/menu?view=combos" className={() => (combosOn ? 'active' : '')}>{t(W.combos)}</NavLink>}
                    <NavLink to="/rewards">{t(W.rewards)}</NavLink>
                </nav>

                <span className="header-gap" />

                <div className="header-search cx-glass" onClick={e => e.currentTarget.querySelector('input')?.focus()}>
                    <FiSearch className="search-icon" aria-hidden="true" />
                    <form onSubmit={handleSearch} role="search">
                        <input
                            type="search"
                            aria-label={t(W.search)}
                            placeholder={displayPlaceholder || t(W.search)}
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            onFocus={() => searchTerm.length > 1 && setShowDropdown(true)}
                            onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
                        />
                    </form>
                    {showDropdown && searchResults.length > 0 && (
                        <div className="search-dropdown">
                            {searchResults.map(item => (
                                <button type="button" key={item._id} className="search-result-item"
                                    onClick={() => { setShowDropdown(false); setSearchTerm(''); navigate(`/item/${item._id}`); }}>
                                    <span className="search-item-pic">
                                        {item.image ? <img src={getImageUrl(item.image)} alt="" /> : <Art kind={artFor(item)} />}
                                    </span>
                                    <span className="search-item-info">
                                        <span className="search-item-name">{lang === 'hi' && item.nameHi ? item.nameHi : item.name}</span>
                                        <span className="search-item-category">{item.category?.name}</span>
                                    </span>
                                    <span className="search-item-price">₹{item.price}</span>
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                <div className="header-actions">
                    <TableChip />
                    <LangButton />
                    {loyaltyPoints != null && (
                        <Link to="/rewards" className="header-points-badge cx-glass" aria-label={t(W.points, { n: loyaltyPoints })}>
                            <Coin /><span className="points-num">{loyaltyPoints}</span>
                        </Link>
                    )}
                    {isAuthenticated && (
                        <Link to="/history" className="cx-ib cx-glass history-btn" title={t(W.history)} aria-label={t(W.history)}>
                            <FiClock />
                        </Link>
                    )}
                    <Link to="/saved" className="cx-ib cx-glass desk-only" title={t(W.saved)} aria-label={t(W.saved)}>
                        <FiHeart />
                    </Link>
                    {showCart && (
                        <Link to="/cart" className="cx-ib cx-glass desk-only cart-btn" data-cart-target title={t(W.cart)} aria-label={t(W.cart)}>
                            <FiShoppingBag />
                            {itemCount > 0 && <span className="cx-count">{itemCount}</span>}
                        </Link>
                    )}
                    <Link to="/profile" className="cx-av desk-only header-avatar" title={t(W.profile)} aria-label={t(W.profile)}>
                        {initial || <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></svg>}
                    </Link>
                </div>
            </div>
        </header>
    );
};

export default Header;
