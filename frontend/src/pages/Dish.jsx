import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { FiArrowLeft, FiClock, FiMinus, FiPlus, FiStar, FiShoppingBag, FiChevronRight } from 'react-icons/fi';
import Header from '../components/Header';
import Art from '../components/cx/Art';
import { artFor } from '../components/cx/artKinds';
import FavHeart from '../components/cx/FavHeart';
import ChoicePicker from '../components/cx/ChoicePicker';
import { canonical, cleanSelection, defaultSelection, dishPrice, selectionText, selFromOptions, sizeOf } from '../components/cx/choices';
import { flyToCart } from '../components/cx/fly';
import { useCart } from '../context/CartContext';
import { usePortal } from '../context/PortalContext';
import { getDishDetail, getShopItem } from '../utils/api';
import { getImageUrl } from '../utils/config';
import useCxLang, { T } from '../lib/cxLang';
import './Dish.css';

const W = {
    back: T('Back', 'पीछे', 'Peeche'),
    bestseller: T('Bestseller', 'बेस्टसेलर', 'Bestseller'),
    newItem: T('New', 'नया', 'Naya'),
    chefsPick: T("Chef's pick", 'शेफ़ की पसंद', 'Chef ki pasand'),
    min: T('{n} min', '{n} मिनट', '{n} min'),
    kcal: T('{n} kcal', '{n} कैलोरी', '{n} kcal'),
    veg: T('Veg', 'शाकाहारी', 'Veg'),
    nonVeg: T('Non-veg', 'मांसाहारी', 'Non-veg'),
    reviews: T('{n} reviews', '{n} रिव्यू', '{n} reviews'),
    usual: T('Your usual is picked. Change anything you like.', 'आपकी हमेशा वाली पसंद चुनी है। जो चाहें बदलें।', 'Aapki usual choice lagi hai. Jo chahe badlo.'),
    editing: T('Changing the one in your cart', 'कार्ट वाला बदल रहे हैं', 'Cart wala badal rahe ho'),
    noteLabel: T('Anything else?', 'कुछ और?', 'Kuch aur?'),
    notePh: T('e.g. less ice, extra hot', 'जैसे कम बर्फ़, ज़्यादा गरम', 'jaise kam ice, extra garam'),
    comboTitle: T('Make it a combo', 'कॉम्बो बनाएँ', 'Combo banao'),
    comboLine: T('{name} for ₹{price}', '{name} ₹{price} में', '{name} ₹{price} mein'),
    save: T('Save ₹{n}', '₹{n} बचाएँ', '₹{n} bachao'),
    pairs: T('Goes well with', 'इसके साथ अच्छा लगेगा', 'Iske saath badhiya'),
    addPair: T('Add {name}', '{name} जोड़ें', '{name} add karo'),
    know: T('Good to know', 'जानने लायक', 'Jaanne layak'),
    caffeine: T('Caffeine', 'कैफ़ीन', 'Caffeine'),
    allergens: T('Allergens', 'एलर्जी', 'Allergens'),
    served: T('Served', 'कैसे परोसा जाता है', 'Kaise serve hota hai'),
    ingredients: T('Made with', 'किससे बना', 'Kis se bana'),
    less: T('One less', 'एक कम', 'Ek kam'),
    more: T('One more', 'एक और', 'Ek aur'),
    add: T('Add · ₹{n}', 'जोड़ें · ₹{n}', 'Add karo · ₹{n}'),
    update: T('Update · ₹{n}', 'बदलें · ₹{n}', 'Update karo · ₹{n}'),
    soldOut: T('Out of stock right now', 'अभी ख़त्म है', 'Abhi khatam hai'),
    soldOutText: T('Back soon. Have a look at something else on the menu.', 'जल्द वापस आएगा। मेन्यू में कुछ और देखें।', 'Jaldi wapas aayega. Menu mein kuch aur dekho.'),
    notFound: T('This dish is not on the menu', 'यह डिश मेन्यू में नहीं है', 'Yeh dish menu mein nahi hai'),
    toMenu: T('See the menu', 'मेन्यू देखें', 'Menu dekho'),
    added: T('Added to your cart', 'कार्ट में जुड़ गया', 'Cart mein add ho gaya'),
    viewCart: T('View cart', 'कार्ट देखें', 'Cart dekho'),
    loading: T('Loading…', 'लोड हो रहा है…', 'Load ho raha hai…'),
};

const rupees = (n) => Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });

const Dish = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    const location = useLocation();
    const { lang, t } = useCxLang();
    const { show } = usePortal();
    const { items, addLine, addItem, replaceLine } = useCart();
    const editKey = location.state?.editKey || null;
    const editing = editKey ? items.find(i => i.key === editKey && i._id === id) : null;

    const [item, setItem] = useState(undefined);
    const [detail, setDetail] = useState(null);
    const [sel, setSel] = useState({ size: '', choices: [] });
    const [qty, setQty] = useState(1);
    const [note, setNote] = useState('');
    const [usual, setUsual] = useState(false);
    const [toast, setToast] = useState(false);
    const leaving = useRef(null);

    useEffect(() => {
        let gone = false;
        setItem(undefined);
        setDetail(null);
        Promise.all([getShopItem(id).catch(() => ({ data: null })), getDishDetail(id).catch(() => ({ data: null }))]).then(([a, b]) => {
            if (gone) return;
            const it = a.data;
            const d = b.data;
            setItem(it || null);
            setDetail(d);
            const sizes = d?.sizes || it?.sizes || [];
            const groups = d?.groups || [];
            if (editing) {
                setSel(cleanSelection(sizes, groups, { size: editing.size, choices: editing.choices }));
                setQty(editing.quantity);
                setNote(editing.note || '');
                setUsual(false);
            } else if (d?.last && (d.last.size || d.last.choices?.length)) {
                setSel(cleanSelection(sizes, groups, selFromOptions(d.last)));
                setUsual(true);
                setQty(1);
                setNote('');
            } else {
                setSel(defaultSelection(sizes, groups));
                setUsual(false);
                setQty(1);
                setNote('');
            }
        });
        return () => { gone = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id, editKey]);

    useEffect(() => () => clearTimeout(leaving.current), []);
    useEffect(() => { window.scrollTo(0, 0); }, [id]);
    // The dish page has its own bottom bar: hide the app's bottom tabs while it is open
    useEffect(() => {
        document.documentElement.classList.add('cx-no-tabs');
        return () => document.documentElement.classList.remove('cx-no-tabs');
    }, []);

    const sizes = useMemo(() => detail?.sizes || item?.sizes || [], [detail, item]);
    const groups = useMemo(() => detail?.groups || [], [detail]);
    const unit = item ? dishPrice(item.price, sizes, groups, sel) : 0;
    const details = { ...(item?.details || {}), ...(detail?.details || {}) };
    const shows = (k) => details.show?.[k] !== false;

    const goBack = () => (location.key !== 'default' ? navigate(-1) : navigate('/menu'));

    if (item === undefined) {
        return <div className="dish-page dish-wait"><div className="spinner" aria-label={t(W.loading)} /></div>;
    }
    if (!item) {
        return (
            <div className="dish-page dish-missing">
                <Art kind="plate" className="dish-missing-art" />
                <h2>{t(W.notFound)}</h2>
                <Link to="/menu" className="dish-btn">{t(W.toMenu)}</Link>
            </div>
        );
    }

    const name = (lang === 'hi' && item.nameHi) || item.name;
    const photo = show('photos') && item.image ? getImageUrl(item.image) : '';
    const badge = show('badges') ? (item.isBestSeller ? W.bestseller : item.isNewItem ? W.newItem : item.isRecommended ? W.chefsPick : null) : null;
    const rating = detail?.rating;
    const combo = shows('combo') ? detail?.combos?.[0] : null;
    const pairs = shows('pairs') ? (detail?.pairs || []) : [];
    const facts = [
        shows('caffeine') && details.caffeine && [W.caffeine, details.caffeine],
        shows('allergens') && details.allergens && [W.allergens, details.allergens],
        details.served && [W.served, details.served],
        shows('ingredients') && details.ingredients && [W.ingredients, details.ingredients],
    ].filter(Boolean);
    const sold = item.isAvailable === false;
    const size = sizes.length ? sizeOf(sizes, sel.size) : null;

    const add = (e) => {
        if (sold) return;
        const c = canonical(sizes, groups, sel);
        const line = {
            _id: item._id, name: item.name, nameHi: item.nameHi, image: item.image, art: artFor(item), isVeg: item.isVeg,
            price: unit, quantity: qty, size: c.size, sizeName: c.size && size ? size.name : '', choices: c.choices,
            choiceText: selectionText(sizes, groups, sel, 'en'), choiceTextHi: selectionText(sizes, groups, sel, 'hi'),
            note: note.trim(),
        };
        flyToCart(e.currentTarget);
        if (editing) {
            replaceLine(editing.key, line);
            leaving.current = setTimeout(() => navigate('/cart', { replace: true }), 350);
            return;
        }
        addLine(line);
        if (location.key !== 'default') {
            leaving.current = setTimeout(() => navigate(-1), 650);
        } else {
            setToast(true);
            clearTimeout(leaving.current);
            leaving.current = setTimeout(() => setToast(false), 4000);
        }
    };

    const addPair = (p, e) => {
        if (p.hasChoices) { navigate(`/item/${p._id}`); return; }
        addItem({ _id: p._id, name: p.name, nameHi: p.nameHi, price: p.price, image: p.image, isVeg: p.isVeg, isAvailable: true, art: p.art || artFor(p) });
        flyToCart(e.currentTarget);
    };

    return (
        <div className="dish-page">
            <div className="dish-wide-head"><Header /></div>
            <div className="dish-grid">
                <div className="dish-hero">
                    <div className="dish-top">
                        <button type="button" className="dish-ib" onClick={goBack} aria-label={t(W.back)}><FiArrowLeft /></button>
                        <FavHeart item={item} className="dish-heart" />
                    </div>
                    {photo
                        ? <img src={photo} alt={name} className="dish-photo" />
                        : <Art kind={artFor(item)} className="dish-art" label={name} />}
                </div>

                <div className="dish-body">
                    {badge && <span className="dish-badge">{t(badge)}</span>}
                    <h1 className="dish-name">{name}</h1>
                    {lang === 'hi' && item.nameHi && item.nameHi !== item.name && <div className="dish-alt">{item.name}</div>}
                    <div className="dish-meta">
                        {shows('rating') && rating?.count > 0 && (
                            <span className="dish-star" title={t(W.reviews, { n: rating.count })}><FiStar /><b>{rating.avg}</b>({rating.count})</span>
                        )}
                        {shows('prep') && item.preparationTime > 0 && <span><FiClock />{t(W.min, { n: item.preparationTime })}</span>}
                        {shows('calories') && details.calories && <span><Flame />{t(W.kcal, { n: details.calories })}</span>}
                        {shows('veg') && (
                            <span><i className={`dish-veg ${item.isVeg ? '' : 'non'}`} aria-hidden="true" />{t(item.isVeg ? W.veg : W.nonVeg)}</span>
                        )}
                    </div>
                    {(item.description || item.descriptionHi) && <p className="dish-desc">{lang === 'hi' && item.descriptionHi ? item.descriptionHi : item.description || item.descriptionHi}</p>}

                    {sold && (
                        <div className="dish-note dish-sold"><FiShoppingBag /><span><b>{t(W.soldOut)}</b>{t(W.soldOutText)}</span></div>
                    )}
                    {editing && <div className="dish-note">{t(W.editing)}</div>}
                    {!editing && usual && <div className="dish-note dish-usual"><FiStar />{t(W.usual)}</div>}

                    <ChoicePicker sizes={sizes} groups={groups} value={sel} lang={lang} t={t}
                        onChange={(v) => { setSel(v); setUsual(false); }} />

                    <label className="dish-field">
                        <span>{t(W.noteLabel)}</span>
                        <input type="text" value={note} maxLength={120} placeholder={t(W.notePh)} onChange={(e) => setNote(e.target.value)} />
                    </label>

                    {combo && (
                        <Link to={`/combo/${combo.id}`} className="dish-combo" style={combo.bg ? { background: combo.bg } : undefined}>
                            <span className="dish-combo-arts">
                                {combo.image ? <img src={getImageUrl(combo.image)} alt="" /> : (
                                    <><Art kind={artFor(item)} /><Art kind={combo.art && combo.art !== artFor(item) ? combo.art : 'croissant'} /></>
                                )}
                            </span>
                            <span className="dish-combo-copy">
                                <b>{t(W.comboTitle)}</b>
                                <small>{t(W.comboLine, { name: (lang === 'hi' && combo.nameHi) || combo.name, price: rupees(combo.price) })}</small>
                            </span>
                            {combo.save > 0 && <span className="dish-save">{t(W.save, { n: rupees(combo.save) })}</span>}
                            <FiChevronRight className="dish-combo-go" />
                        </Link>
                    )}

                    {pairs.length > 0 && (
                        <div className="dish-sec">
                            <h5>{t(W.pairs)}</h5>
                            <div className="dish-pairs">
                                {pairs.map(p => {
                                    const pn = (lang === 'hi' && p.nameHi) || p.name;
                                    return (
                                        <div key={p._id} className="dish-pair">
                                            <Link to={`/item/${p._id}`} className="dish-pair-ph">
                                                {show('photos') && p.image ? <img src={getImageUrl(p.image)} alt="" /> : <Art kind={artFor(p)} />}
                                            </Link>
                                            <Link to={`/item/${p._id}`} className="dish-pair-name">{pn}</Link>
                                            <div className="dish-pair-row">
                                                <span>₹{rupees(p.price)}</span>
                                                <button type="button" className="dish-plus" aria-label={t(W.addPair, { name: pn })} onClick={(e) => addPair(p, e)}><FiPlus /></button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {facts.length > 0 && (
                        <div className="dish-sec">
                            <h5>{t(W.know)}</h5>
                            <div className="dish-facts">
                                {facts.map(([k, v]) => <div key={k.en} className="dish-fact"><b>{v}</b><small>{t(k)}</small></div>)}
                            </div>
                        </div>
                    )}

                    <div className="dish-bar">
                        <div className="dish-qty">
                            <button type="button" onClick={() => setQty(q => Math.max(1, q - 1))} aria-label={t(W.less)} disabled={qty <= 1}><FiMinus /></button>
                            <span aria-live="polite">{qty}</span>
                            <button type="button" onClick={() => setQty(q => Math.min(99, q + 1))} aria-label={t(W.more)}><FiPlus /></button>
                        </div>
                        <button type="button" className="dish-add" onClick={add} disabled={sold}>
                            {sold ? t(W.soldOut) : t(editing ? W.update : W.add, { n: rupees(unit * qty) })}
                        </button>
                    </div>
                </div>
            </div>

            {toast && (
                <div className="dish-toast" role="status">
                    <span>{t(W.added)}</span>
                    <Link to="/cart" data-cart-target>{t(W.viewCart)}</Link>
                </div>
            )}
        </div>
    );
};

const Flame = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 22c4 0 7-3 7-7 0-4-3-6-4-10-2 2-3 4-3 6-1-1-2-2-2-4-2 2-5 5-5 8 0 4 3 7 7 7z" />
    </svg>
);

export default Dish;
