import React from 'react';
import { useNavigate } from 'react-router-dom';
import { FiPlus, FiMinus, FiStar, FiClock } from 'react-icons/fi';
import { useCart } from '../context/CartContext';
import { usePortal } from '../context/PortalContext';
import { getImageUrl } from '../utils/config';
import { flyToCart } from './cx/fly';
import Art from './cx/Art';
import { artFor } from './cx/artKinds';
import FavHeart from './cx/FavHeart';
import { useDishChoices, needsChoice, fromPrice } from '../lib/dishChoices';
import './MenuCard.css';
import useCxLang, { T } from '../lib/cxLang';

const W = {
    bestseller: T('Bestseller', 'बेस्टसेलर', 'Bestseller'),
    newItem: T('New', 'नया', 'New'),
    soldOut: T('Sold out', 'ख़त्म', 'Khatam'),
    less: T('One less', 'एक कम', 'Ek kam'),
    more: T('One more', 'एक और', 'Ek aur'),
    add: T('Add {name}', '{name} जोड़ें', '{name} add karo'),
    pick: T('Pick size and choices for {name}', '{name} का साइज़ और पसंद चुनें', '{name} ka size aur choice chuno'),
    from: T('from', 'से शुरू', 'from'),
    min: T('{n} min', '{n} मिनट', '{n} min'),
};

// One dish on Home and Menu: picture (or a drawn one), heart, veg mark, price and a round + button.
// Tapping the card opens the dish page; + adds it straight away, or opens the page when it needs a size or choice.
const MenuCard = ({ item, layout = 'grid' }) => {
    const { qtyOf, addItem, incrementQuantity, decrementQuantity } = useCart();
    const { show } = usePortal();
    const { lang, t } = useCxLang();
    const navigate = useNavigate();
    const choices = useDishChoices();
    const choose = needsChoice(item, choices);
    const from = fromPrice(item, choices);
    // How many of a plain dish are in the cart (dishes with sizes or choices are changed on their page / the cart)
    const quantity = choose ? 0 : (qtyOf?.(item._id) || 0);
    const badges = show('badges');
    const photos = show('photos');
    const name = lang === 'hi' && item.nameHi ? item.nameHi : item.name;
    const rating = Number(item.rating ?? item.details?.rating);
    const art = artFor({ ...item, art: item.details?.art || choices[item._id]?.art });

    const open = () => navigate(`/item/${item._id}`);
    const stop = (e) => e.stopPropagation();
    const add = (e) => {
        e.stopPropagation();
        if (choose) { open(); return; }
        addItem(item);
        flyToCart(e.currentTarget);
    };
    const tag = badges && (item.isBestSeller ? t(W.bestseller) : item.isNewItem ? t(W.newItem) : (item.tags || [])[0]);

    return (
        <div className={`menu-card cx-glass ${layout === 'list' ? 'is-list' : ''} ${item.isAvailable === false ? 'is-out' : ''}`}
            onClick={open} role="link" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') open(); }} aria-label={name}>
            {photos && (
                <div className="mc-ph">
                    {item.image ? <img src={getImageUrl(item.image)} alt="" className="mc-img" loading="lazy" />
                        : <Art kind={art} className="mc-art" />}
                    {tag && <span className={`mc-tag ${item.isNewItem && !item.isBestSeller ? 'new' : ''}`}>{tag}</span>}
                    {item.isAvailable === false && <div className="mc-out">{t(W.soldOut)}</div>}
                </div>
            )}
            <span className="mc-heart" onClick={stop}><FavHeart item={item} /></span>

            <div className="mc-body">
                <h3 className="mc-name">{name}</h3>
                {lang === 'hi' && item.nameHi && <span className="dish-name-hi">{item.name}</span>}
                {layout === 'list' && item.description && <p className="mc-desc">{item.description}</p>}
                <div className="mc-meta">
                    <span className={item.isVeg ? 'cx-veg' : 'cx-nonveg'} aria-label={item.isVeg ? 'Veg' : 'Non-veg'} role="img" />
                    {rating > 0 && <span className="mc-star"><FiStar aria-hidden="true" />{rating.toFixed(1)}</span>}
                    {item.preparationTime > 0 && <span className="mc-prep"><FiClock aria-hidden="true" />{t(W.min, { n: item.preparationTime })}</span>}
                </div>
                <div className="mc-bot">
                    <span className="mc-price">
                        {from != null && <small>{t(W.from)} </small>}
                        <b>₹{from ?? item.price}</b>
                        {item.mrp > item.price && from == null && <s>₹{item.mrp}</s>}
                    </span>
                    {item.isAvailable !== false && (
                        quantity > 0 ? (
                            <span className="mc-qty" onClick={stop}>
                                <button onClick={() => decrementQuantity(item._id)} aria-label={t(W.less)}><FiMinus /></button>
                                <b>{quantity}</b>
                                <button className="cx-pri" onClick={(e) => { incrementQuantity(item._id); flyToCart(e.currentTarget); }} aria-label={t(W.more)}><FiPlus /></button>
                            </span>
                        ) : (
                            <button onClick={add} className="mc-add cx-pri add-btn" aria-label={t(choose ? W.pick : W.add, { name })}>
                                <FiPlus />
                            </button>
                        )
                    )}
                </div>
            </div>
        </div>
    );
};

export default MenuCard;
