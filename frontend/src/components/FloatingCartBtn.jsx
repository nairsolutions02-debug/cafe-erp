import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCart } from '../context/CartContext';
import './FloatingCartBtn.css';

const FloatingCartBtn = () => {
    const { itemCount, subtotal } = useCart();
    const [bump, setBump] = useState(0);
    useEffect(() => {
        const on = () => setBump(b => b + 1);
        window.addEventListener('cart-bump', on);
        return () => window.removeEventListener('cart-bump', on);
    }, []);

    if (itemCount === 0) return null;

    return (
        <Link to="/cart" className={`floating-cart-btn ${bump ? 'cart-bump' : ''}`} key={bump} data-cart-target>
            <span className="floating-cart-count">{itemCount} {itemCount === 1 ? 'item' : 'items'}</span>
            <span>₹{subtotal.toFixed(0)} · View cart →</span>
        </Link>
    );
};

export default FloatingCartBtn;
