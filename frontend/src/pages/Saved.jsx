import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FiPlus, FiRepeat } from 'react-icons/fi';
import Header from '../components/Header';
import Art from '../components/cx/Art';
import { artFor } from '../components/cx/artKinds';
import FavHeart from '../components/cx/FavHeart';
import { optionsText, ownNote } from '../components/cx/choices';
import { checkLines, lineFromFavourite, lineFromOrderItem } from '../components/cx/reorder';
import { flyToCart } from '../components/cx/fly';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
import { usePortal } from '../context/PortalContext';
import { getMyFavourites, getMyOrders } from '../utils/api';
import { getImageUrl } from '../utils/config';
import useCxLang, { T } from '../lib/cxLang';
import './Saved.css';

const W = {
    title: T('Saved', 'सेव किए', 'Saved'),
    sub: T('Your favourites and last orders', 'आपके पसंदीदा और पिछले ऑर्डर', 'Aapke favourites aur pichhle order'),
    favs: T('Favourites', 'पसंदीदा', 'Favourites'),
    again: T('Order again', 'फिर से ऑर्डर', 'Dobara order'),
    yourWay: T('Your way: {x}', 'आपके तरीके से: {x}', 'Aapke tareeke se: {x}'),
    add: T('Add {name}', '{name} जोड़ें', '{name} add karo'),
    soldOut: T('Out of stock', 'ख़त्म', 'Khatam'),
    noFavs: T('No favourites yet', 'अभी कोई पसंदीदा नहीं', 'Abhi koi favourite nahi'),
    noFavsText: T('Tap the heart on any dish to keep it here, the way you like it.', 'किसी भी डिश पर दिल दबाएँ, वह यहाँ आपके तरीके से रहेगी।', 'Kisi bhi dish pe dil dabao, woh yahan aapke tareeke se rahegi.'),
    noOrders: T('No orders yet', 'अभी कोई ऑर्डर नहीं', 'Abhi koi order nahi'),
    noOrdersText: T('After your first order you can repeat it here in one tap.', 'पहले ऑर्डर के बाद यहाँ एक टैप में दोबारा मँगा सकते हैं।', 'Pehle order ke baad yahan ek tap mein dobara mangwa sakte ho.'),
    menu: T('See the menu', 'मेन्यू देखें', 'Menu dekho'),
    visit: T('{date}', '{date}', '{date}'),
    lastVisit: T('Last visit · {date}', 'पिछली बार · {date}', 'Pichhli baar · {date}'),
    same: T('Order the same again · ₹{n}', 'वही फिर से मँगाएँ · ₹{n}', 'Same dobara mangao · ₹{n}'),
    adding: T('Adding…', 'जोड़ रहे हैं…', 'Add ho raha hai…'),
    added: T('Added to your cart', 'कार्ट में जुड़ गया', 'Cart mein add ho gaya'),
    skipped: T('Not available today: {names}', 'आज नहीं मिलेगा: {names}', 'Aaj nahi milega: {names}'),
    noneLeft: T('None of these are available today.', 'इनमें से आज कुछ नहीं मिलेगा।', 'Inmein se aaj kuch nahi milega.'),
    viewCart: T('View cart', 'कार्ट देखें', 'Cart dekho'),
    loading: T('Loading…', 'लोड हो रहा है…', 'Load ho raha hai…'),
};

const rupees = (n) => Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const TAB_KEY = 'cx-saved-tab';

const Saved = () => {
    const navigate = useNavigate();
    const { lang, t } = useCxLang();
    const { show } = usePortal();
    const { user } = useAuth();
    const { addLine } = useCart();
    const [tab, setTab] = useState(() => { try { return sessionStorage.getItem(TAB_KEY) || 'favs'; } catch { return 'favs'; } });
    const [favs, setFavs] = useState(null);
    const [orders, setOrders] = useState(null);
    const [busy, setBusy] = useState(null);
    const [msg, setMsg] = useState(null);
    const customer = user?.role === 'customer' ? user._id : null;

    useEffect(() => { try { sessionStorage.setItem(TAB_KEY, tab); } catch { /* storage blocked */ } }, [tab]);
    useEffect(() => {
        if (!customer) return;
        getMyFavourites().then(r => setFavs(r.data || [])).catch(() => setFavs([]));
        getMyOrders().then(r => setOrders((r.data || []).filter(o => o.status !== 'cancelled' && (o.items || []).length).slice(0, 6))).catch(() => setOrders([]));
    }, [customer]);

    const dateOf = (d) => new Date(d).toLocaleDateString(lang === 'hi' ? 'hi-IN' : 'en-IN', { day: 'numeric', month: 'short' });
    const say = (text) => { setMsg(text); };

    const addFav = async (f, e) => {
        const target = e.currentTarget;
        const hasWay = f.last?.options && (f.last.options.size || f.last.options.choices?.length);
        if (f.hasChoices && !hasWay) { navigate(`/item/${f._id}`); return; }
        setBusy(f._id);
        const { ok, skipped } = await checkLines([lineFromFavourite(f)]);
        setBusy(null);
        if (ok.length) { ok.forEach(addLine); flyToCart(target); say({ ok: true, skipped }); } else say({ ok: false, skipped });
    };

    const again = async (o) => {
        setBusy(o._id);
        const { ok, skipped } = await checkLines((o.items || []).filter(i => !i.isRestricted).map(lineFromOrderItem));
        setBusy(null);
        if (!ok.length) { say({ ok: false, skipped }); return; }
        ok.forEach(addLine);
        if (!skipped.length) navigate('/cart');
        else say({ ok: true, skipped });
    };

    const empty = (kind) => (
        <div className="saved-empty">
            <Art kind={kind === 'favs' ? 'latte' : 'croissant'} className="saved-empty-art" />
            <h3>{t(kind === 'favs' ? W.noFavs : W.noOrders)}</h3>
            <p>{t(kind === 'favs' ? W.noFavsText : W.noOrdersText)}</p>
            <Link to="/menu" className="saved-btn">{t(W.menu)}</Link>
        </div>
    );

    const list = !customer ? [] : tab === 'favs' ? favs : orders;

    return (
        <div className="saved-page">
            <div className="saved-wide-head"><Header /></div>
            <div className="saved-wrap">
                <div className="saved-head">
                    <h1>{t(W.title)}</h1>
                    <small>{t(W.sub)}</small>
                </div>
                <div className="saved-tabs" role="tablist">
                    <button type="button" role="tab" aria-selected={tab === 'favs'} className={tab === 'favs' ? 'on' : ''} onClick={() => setTab('favs')}>{t(W.favs)}</button>
                    <button type="button" role="tab" aria-selected={tab === 'again'} className={tab === 'again' ? 'on' : ''} onClick={() => setTab('again')}>{t(W.again)}</button>
                </div>

                {msg && (
                    <div className={`saved-msg ${msg.ok ? '' : 'bad'}`} role="status">
                        <span>
                            {msg.ok ? t(W.added) : t(W.noneLeft)}
                            {msg.skipped?.length > 0 && <small>{t(W.skipped, { names: msg.skipped.join(', ') })}</small>}
                        </span>
                        {msg.ok && <Link to="/cart">{t(W.viewCart)}</Link>}
                        <button type="button" className="saved-msg-x" onClick={() => setMsg(null)} aria-label="OK">×</button>
                    </div>
                )}

                {list === null ? <div className="saved-wait">{t(W.loading)}</div> : list.length === 0 ? empty(tab) : tab === 'favs' ? (
                    <div className="saved-grid">
                        {favs.map(f => {
                            const name = (lang === 'hi' && f.nameHi) || f.name;
                            const way = [optionsText(f.last?.options), f.last ? ownNote(f.last.note, f.last.options) : ''].filter(Boolean).join(' · ');
                            const off = f.isAvailable === false;
                            return (
                                <div key={f._id} className="saved-card" onClick={() => navigate(`/item/${f._id}`)} role="link" tabIndex={0}
                                    onKeyDown={(e) => e.key === 'Enter' && navigate(`/item/${f._id}`)}>
                                    <div className="saved-ph">
                                        {show('photos') && f.image ? <img src={getImageUrl(f.image)} alt="" /> : <Art kind={artFor(f)} />}
                                    </div>
                                    <div className="saved-copy">
                                        <b>{name}</b>
                                        {way && <small>{t(W.yourWay, { x: way })}</small>}
                                        <span className="saved-price">{off ? t(W.soldOut) : `₹${rupees(f.last?.price || f.price)}`}</span>
                                    </div>
                                    <div className="saved-side">
                                        <FavHeart item={f} onChange={(on) => !on && setFavs(x => x.filter(y => y._id !== f._id))} />
                                        {!off && (
                                            <button type="button" className="saved-plus" disabled={busy === f._id} aria-label={t(W.add, { name })}
                                                onClick={(e) => { e.stopPropagation(); addFav(f, e); }}><FiPlus /></button>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <div className="saved-grid">
                        {orders.map((o, n) => {
                            const lines = o.items || [];
                            const total = lines.reduce((s, i) => s + Number(i.price) * i.quantity, 0);
                            const first = lines[0];
                            return (
                                <div key={o._id} className="saved-again">
                                    <div className="saved-again-top">
                                        <span className="saved-ph small">
                                            <Art kind={artFor({ name: first?.menuItem?.name || first?.name })} />
                                        </span>
                                        <div>
                                            <b>{n === 0 ? t(W.lastVisit, { date: dateOf(o.createdAt) }) : t(W.visit, { date: dateOf(o.createdAt) })}</b>
                                            <p>{lines.map(i => `${i.name}${i.quantity > 1 ? ` ×${i.quantity}` : ''}`).join(', ')}</p>
                                            {lines.some(i => i.note) && <small>{lines.filter(i => i.note).map(i => i.note).join(' · ')}</small>}
                                        </div>
                                    </div>
                                    <button type="button" className="saved-btn wide" disabled={busy === o._id} onClick={() => again(o)}>
                                        <FiRepeat /> {busy === o._id ? t(W.adding) : t(W.same, { n: rupees(total) })}
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
};

export default Saved;
