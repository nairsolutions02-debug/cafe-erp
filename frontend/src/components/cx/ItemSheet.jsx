import React, { useEffect } from 'react';
import { FiMinus, FiPlus, FiX } from 'react-icons/fi';
import { useCart } from '../../context/CartContext';
import { usePortal } from '../../context/PortalContext';
import { getImageUrl } from '../../utils/config';
import { flyToCart } from './fly';

// Bottom sheet with an item's picture, description and add button
const ItemSheet = ({ item, onClose }) => {
    const { items, addItem, incrementQuantity, decrementQuantity } = useCart();
    const { show } = usePortal();
    const qty = items.find(i => i._id === item._id)?.quantity || 0;
    useEffect(() => {
        const esc = (e) => e.key === 'Escape' && onClose();
        document.addEventListener('keydown', esc);
        return () => document.removeEventListener('keydown', esc);
    }, [onClose]);
    const badges = show('badges') ? [item.isBestSeller && 'Bestseller', item.isNewItem && 'New', item.isRecommended && "Chef's pick"].filter(Boolean) : [];
    return (
        <>
            <div className="sheet-scrim" onClick={onClose} />
            <div className="item-sheet" role="dialog" aria-label={item.name}>
                {show('photos') && item.image
                    ? <img className="item-sheet-img" src={getImageUrl(item.image)} alt={item.name} />
                    : <div className="item-sheet-grab" />}
                <button className="sheet-close" aria-label="Close" onClick={onClose}><FiX /></button>
                <div className="item-sheet-body">
                    {badges.length > 0 && <div className="item-sheet-badges">{badges.map(b => <span key={b}>{b}</span>)}</div>}
                    <h2><span className={`veg-badge ${item.isVeg ? 'badge-veg' : 'badge-non-veg'}`} />{item.name}</h2>
                    {item.description && <p>{item.description}</p>}
                </div>
                <div className="item-sheet-foot">
                    <span className="price">₹{item.price}</span>
                    {!item.isAvailable ? <span className="muted">Out of stock</span> : qty > 0 ? (
                        <div className="quantity-control">
                            <button className="qty-btn" aria-label="One less" onClick={() => decrementQuantity(item._id)}><FiMinus /></button>
                            <span className="qty-value">{qty}</span>
                            <button className="qty-btn" aria-label="One more" onClick={(e) => { incrementQuantity(item._id); flyToCart(e.currentTarget); }}><FiPlus /></button>
                        </div>
                    ) : (
                        <button className="btn btn-primary" onClick={(e) => { addItem(item); flyToCart(e.currentTarget); }}>Add to cart</button>
                    )}
                </div>
            </div>
        </>
    );
};

export default ItemSheet;
