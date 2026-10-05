import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FiShoppingCart, FiUser, FiSearch, FiClock, FiArrowLeft } from 'react-icons/fi';
import { useCart } from '../context/CartContext';
import { useAuth } from '../context/AuthContext';
import { getMenuItems, getMyLoyaltyPoints } from '../utils/api';
import './Header.css';
import { useBrand } from '../context/BrandContext';
import TableChip from './cx/TableChip';

const Header = ({ title, showCart = true, showBack = false }) => {
    const brand = useBrand();
    const { isAuthenticated } = useAuth();
    const { itemCount } = useCart();
    const navigate = useNavigate();
    const [searchTerm, setSearchTerm] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [showDropdown, setShowDropdown] = useState(false);
    const [loyaltyPoints, setLoyaltyPoints] = useState(0);

    // Animated placeholder
    const placeholderTexts = brand.searchHints;
    const [placeholderIndex, setPlaceholderIndex] = useState(0);
    const [displayPlaceholder, setDisplayPlaceholder] = useState('');
    const [isTyping, setIsTyping] = useState(true);

    // Fetch loyalty points
    useEffect(() => {
        if (isAuthenticated) {
            fetchLoyaltyPoints();
        }
    }, [isAuthenticated]);

    const fetchLoyaltyPoints = async () => {
        try {
            const res = await getMyLoyaltyPoints();
            setLoyaltyPoints(res.data.currentPoints || 0);
        } catch (error) {
            console.error('Error fetching loyalty points:', error);
        }
    };

    // Typewriter effect for placeholder
    useEffect(() => {
        const currentText = placeholderTexts[placeholderIndex];
        const charIndex = displayPlaceholder.length;

        const timer = setTimeout(() => {
            if (isTyping) {
                if (charIndex < currentText.length) {
                    setDisplayPlaceholder(currentText.slice(0, charIndex + 1));
                } else {
                    setTimeout(() => setIsTyping(false), 2000);
                }
            } else {
                if (charIndex > 0) {
                    setDisplayPlaceholder(currentText.slice(0, charIndex - 1));
                } else {
                    setPlaceholderIndex((prev) => (prev + 1) % placeholderTexts.length);
                    setIsTyping(true);
                }
            }
        }, isTyping ? 100 : 50);

        return () => clearTimeout(timer);
    }, [displayPlaceholder, isTyping, placeholderIndex]);

    // Search API call
    useEffect(() => {
        const timer = setTimeout(async () => {
            if (searchTerm.trim().length > 1) {
                try {
                    const { data } = await getMenuItems({ search: searchTerm });
                    setSearchResults(data.slice(0, 5));
                    setShowDropdown(true);
                } catch (error) {
                    console.error("Search error", error);
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

    return (
        <header className="header">
            <div className="header-content">
                {showBack ? (
                    <button className="header-back" onClick={() => navigate('/')}>
                        <FiArrowLeft />
                    </button>
                ) : (
                    <Link to="/" className="header-logo">
                        <img src={brand.logo} alt={brand.name} className="logo-image" />
                    </Link>
                )}

                {!title && (
                    <div className="header-search">
                        <FiSearch className="search-icon" />
                        <form onSubmit={handleSearch}>
                            <input
                                type="text"
                                placeholder={displayPlaceholder}
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                onFocus={() => searchTerm.length > 1 && setShowDropdown(true)}
                                onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
                            />
                        </form>

                        {showDropdown && searchResults.length > 0 && (
                            <div className="search-dropdown">
                                {searchResults.map(item => (
                                    <div
                                        key={item._id}
                                        className="search-result-item"
                                        onClick={() => {
                                            setSearchTerm(item.name);
                                            navigate(`/menu?search=${encodeURIComponent(item.name)}`);
                                            setShowDropdown(false);
                                        }}
                                    >
                                        <div className="search-item-info">
                                            <span className="search-item-name">{item.name}</span>
                                            <span className="search-item-category">{item.category?.name}</span>
                                        </div>
                                        <span className="search-item-price">₹{item.price}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {title && <h1 className="header-title">{title}</h1>}

                <div className="header-actions">
                    <TableChip />
                    {/* Loyalty Points Badge */}
                    {isAuthenticated && (
                        <div className="header-points-badge">
                            <span className="points-coin">🪙</span>
                            <span className="points-num">{loyaltyPoints}</span>
                        </div>
                    )}

                    {showCart && (
                        <Link to="/cart" className="header-icon-btn cart-btn" data-cart-target>
                            <FiShoppingCart />
                            {itemCount > 0 && (
                                <span className="cart-badge">{itemCount}</span>
                            )}
                        </Link>
                    )}

                    {/* History Button - Desktop */}
                    {isAuthenticated && (
                        <Link to="/orders" className="header-icon-btn history-btn" title="Order History">
                            <FiClock />
                        </Link>
                    )}

                    {/* Profile Button - Desktop Only */}
                    <Link to="/profile" className="header-icon-btn profile-btn">
                        <FiUser />
                    </Link>
                </div>
            </div>
        </header>
    );
};

export default Header;

