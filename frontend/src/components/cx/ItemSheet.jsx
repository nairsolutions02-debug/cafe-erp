import React, { useEffect } from 'react';
import { FiMinus, FiPlus, FiX } from 'react-icons/fi';
import { useCart } from '../../context/CartContext';
import { usePortal } from '../../context/PortalContext';
import { getImageUrl } from '../../utils/config';
import { flyToCart } from './fly';
import useCxLang, { T } from '../../lib/cxLang';

const W = {
    bestseller: T('Bestseller', 'बेस्टसेलर', 'Bestseller'),
    newItem: T('New', 'नया', 'New'),
    chefsPick: T("Chef's pick", 'शेफ़ की पसंद', 'Chef ki pasand'),
    close: T('Close', 'बंद करें', 'Band karo'),
    soldOut: T('Out of stock', 'ख़त्म', 'Khatam'),
    less: T('One less', 'एक कम', 'Ek kam'),
    more: T('One more', 'एक और', 'Ek aur'),
    add: T('Add to cart', 'कार्ट में जोड़ें', 'Cart mein daalo'),
};

// Bottom sheet with an item's picture, description and add button
const ItemSheet = ({ item, onClose }) => {
    const { items, addItem, incrementQuantity, decrementQuantity } = useCart();
    const { show } = usePortal();
    const { lang, t } = useCxLang();
    const qty = items.find(i => i._id === item._id)?.quantity || 0;
    useEffect(() => {
        const esc = (e) => e.key === 'Escape' && onClose();
        document.addEventListener('keydown', esc);
        return () => document.removeEventListener('keydown', esc);
    }, [onClose]);
    const badges = show('badges') ? [item.isBestSeller && t(W.bestseller), item.isNewItem && t(W.newItem), item.isRecommended && t(W.chefsPick)].filter(Boolean) : [];
    return (
        <>
            <div className="sheet-scrim" onClick={onClose} />
            <div className="item-sheet" role="dialog" aria-label={item.name}>
                {show('photos') && item.image
                    ? <img className="item-sheet-img" src={getImageUrl(item.image)} alt={item.name} />
                    : <div className="item-sheet-grab" />}
                <button className="sheet-close" aria-label={t(W.close)} onClick={onClose}><FiX /></button>
                <div className="item-sheet-body">
                    {badges.length > 0 && <div className="item-sheet-badges">{badges.map(b => <span key={b}>{b}</span>)}</div>}
                    <h2><span className={`veg-badge ${item.isVeg ? 'badge-veg' : 'badge-non-veg'}`} />{item.name}</h2>
                    {lang === 'hi' && item.nameHi && <span className="dish-name-hi">{item.nameHi}</span>}
                    {item.description && <p>{item.description}</p>}
                </div>
                <div className="item-sheet-foot">
                    <span className="price">₹{item.price}</span>
                    {!item.isAvailable ? <span className="muted">{t(W.soldOut)}</span> : qty > 0 ? (
                        <div className="quantity-control">
                            <button className="qty-btn" aria-label={t(W.less)} onClick={() => decrementQuantity(item._id)}><FiMinus /></button>
                            <span className="qty-value">{qty}</span>
                            <button className="qty-btn" aria-label={t(W.more)} onClick={(e) => { incrementQuantity(item._id); flyToCart(e.currentTarget); }}><FiPlus /></button>
                        </div>
                    ) : (
                        <button className="btn btn-primary" onClick={(e) => { addItem(item); flyToCart(e.currentTarget); }}>{t(W.add)}</button>
                    )}
                </div>
            </div>
        </>
    );
};

export default ItemSheet;
