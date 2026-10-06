import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCart } from '../context/CartContext';
import './FloatingCartBtn.css';
import useCxLang, { T } from '../lib/cxLang';

const W = {
    oneItem: T('{n} item', '{n} आइटम', '{n} item'),
    items: T('{n} items', '{n} आइटम', '{n} items'),
    view: T('View cart →', 'कार्ट देखें →', 'Cart dekho →'),
};

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
        <Link to="/cart" className={`floating-cart-btn ${bump ? 'cart-bump' : ''}`} key={bump} data-cart-target>
            <span className="floating-cart-count">{t(itemCount === 1 ? W.oneItem : W.items, { n: itemCount })}</span>
            <span>₹{subtotal.toFixed(0)} · {t(W.view)}</span>
        </Link>
    );
};

export default FloatingCartBtn;
