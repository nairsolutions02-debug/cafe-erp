import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FiShoppingBag, FiArrowRight } from 'react-icons/fi';
import { useCart } from '../context/CartContext';
import './FloatingCartBtn.css';
import useCxLang, { T } from '../lib/cxLang';

const W = {
    oneItem: T('{n} item', '{n} आइटम', '{n} item'),
    items: T('{n} items', '{n} आइटम', '{n} items'),
    view: T('View cart', 'कार्ट देखें', 'Cart dekho'),
};

// "2 items · ₹440 · View cart" just above the bottom bar (phones; laptops have the cart in the top bar)
const FloatingCartBtn = () => {
    const { itemCount, subtotal } = useCart();
    const { t } = useCxLang();
    const [bump, setBump] = useState(0);
    useEffect(() => {
        const on = () => setBump(b => b + 1);
        window.addEventListener('cart-bump', on);
        return () => window.removeEventListener('cart-bump', on);
    }, []);

    if (itemCount === 0) return null;

    return (
        <Link to="/cart" className={`floating-cart-btn cx-pri ${bump ? 'cart-bump' : ''}`} key={bump}>
            <span className="floating-cart-count"><FiShoppingBag aria-hidden="true" /> {t(itemCount === 1 ? W.oneItem : W.items, { n: itemCount })}</span>
            <span className="floating-cart-go">₹{Number(subtotal || 0).toFixed(0)} · {t(W.view)} <FiArrowRight aria-hidden="true" /></span>
        </Link>
    );
};

export default FloatingCartBtn;
