import React from 'react';
import { FiPlus, FiMinus } from 'react-icons/fi';
import { useCart } from '../context/CartContext';
import { usePortal } from '../context/PortalContext';
import { getImageUrl } from '../utils/config';
import { flyToCart } from './cx/fly';
import './MenuCard.css';
import useCxLang, { T } from '../lib/cxLang';

const W = {
    bestseller: T('Bestseller', 'बेस्टसेलर', 'Bestseller'),
    newItem: T('New', 'नया', 'New'),
    soldOut: T('Out of Stock', 'ख़त्म', 'Khatam'),
    less: T('One less', 'एक कम', 'Ek kam'),
    more: T('One more', 'एक और', 'Ek aur'),
    add: T('ADD', 'जोड़ें', 'ADD'),
};

const MenuCard = ({ item, onOpen }) => {
    const { items, addItem, incrementQuantity, decrementQuantity } = useCart();
    const { show } = usePortal();
    const { lang, t } = useCxLang();
    const cartItem = items.find(i => i._id === item._id);
    const quantity = cartItem?.quantity || 0;
    const badges = show('badges');

    const imageUrl = getImageUrl(item.image) || '/placeholder-food.svg';
    const add = (e) => { addItem(item); flyToCart(e.currentTarget); };

    return (
        <div className="menu-card">
            <div className={`menu-card-image-container ${onOpen ? 'tappable' : ''}`} onClick={onOpen ? () => onOpen(item) : undefined}>
                <img src={imageUrl} alt={item.name} className="menu-card-image" loading="lazy" />
                {badges && item.isBestSeller && <span className="menu-badge bestseller">{t(W.bestseller)}</span>}
                {badges && item.isNewItem && <span className="menu-badge new">{t(W.newItem)}</span>}
                {!item.isAvailable && <div className="out-of-stock-overlay">{t(W.soldOut)}</div>}
            </div>

            <div className="menu-card-content">
                <div className="menu-card-header" onClick={onOpen ? () => onOpen(item) : undefined}>
                    <span className={`veg-badge ${item.isVeg ? 'badge-veg' : 'badge-non-veg'}`}></span>
                    <h3 className="menu-card-name">{item.name}</h3>
                </div>
                {lang === 'hi' && item.nameHi && <span className="dish-name-hi">{item.nameHi}</span>}

                {item.description && (
                    <p className="menu-card-description">{item.description}</p>
                )}

                <div className="menu-card-footer">
                    <span className="menu-card-price">₹{item.price}</span>

                    {item.isAvailable && (
                        quantity > 0 ? (
                            <div className="quantity-control">
                                <button onClick={() => decrementQuantity(item._id)} className="qty-btn" aria-label={t(W.less)}>
                                    <FiMinus />
                                </button>
                                <span className="qty-value">{quantity}</span>
                                <button onClick={(e) => { incrementQuantity(item._id); flyToCart(e.currentTarget); }} className="qty-btn" aria-label={t(W.more)}>
                                    <FiPlus />
                                </button>
                            </div>
                        ) : (
                            <button onClick={add} className="add-btn">
                                {t(W.add)}
                            </button>
                        )
                    )}
                </div>
            </div>
        </div>
    );
};

export default MenuCard;
