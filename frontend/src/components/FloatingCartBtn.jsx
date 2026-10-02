import React from 'react';
import { Link } from 'react-router-dom';
import { useCart } from '../context/CartContext';
import './FloatingCartBtn.css';

const FloatingCartBtn = () => {
    const { itemCount } = useCart();

    if (itemCount === 0) return null;

    return (
        <Link to="/cart" className="floating-cart-btn">
            <span>View Cart</span>
            <span className="floating-cart-count">{itemCount} items</span>
        </Link>
    );
};

export default FloatingCartBtn;
