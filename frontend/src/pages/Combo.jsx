import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { FiArrowLeft, FiCheck, FiMinus, FiPlus, FiGift } from 'react-icons/fi';
import Header from '../components/Header';
import Art from '../components/cx/Art';
import { artFor } from '../components/cx/artKinds';
import ChoicePicker from '../components/cx/ChoicePicker';
import { canonical, cleanSelection, defaultSelection, dishPrice, selectionText, sizeOf } from '../components/cx/choices';
import { flyToCart } from '../components/cx/fly';
import { useCart } from '../context/CartContext';
import { usePortal } from '../context/PortalContext';
import { getCombosOnSale, getDishDetail, getMenuItems } from '../utils/api';
import { getImageUrl } from '../utils/config';
import useCxLang, { T } from '../lib/cxLang';
import './Dish.css';
import './Combo.css';

const W = {
    back: T('Back', 'पीछे', 'Peeche'),
    combo: T('Combo', 'कॉम्बो', 'Combo'),
    saveUpTo: T('save up to ₹{n}', '₹{n} तक बचाएँ', '₹{n} tak bachao'),
    included: T('Included', 'शामिल', 'Included'),
    yours: T('Make the {name} yours', '{name} अपने हिसाब से', '{name} apne hisaab se'),
    noteLabel: T('Anything else?', 'कुछ और?', 'Kuch aur?'),
    notePh: T('e.g. less ice, cookie warm', 'जैसे कम बर्फ़, कुकी गरम', 'jaise kam ice, cookie garam'),
    double: T('Members earn 2× points on this combo.', 'इस कॉम्बो पर मेंबर को 2 गुना पॉइंट मिलते हैं।', 'Is combo pe members ko 2x points milte hain.'),
    add: T('Add combo · ₹{n}', 'कॉम्बो जोड़ें · ₹{n}', 'Combo add karo · ₹{n}'),
    update: T('Update combo · ₹{n}', 'कॉम्बो बदलें · ₹{n}', 'Combo update karo · ₹{n}'),
    youSave: T('Save ₹{n}', '₹{n} बचे', '₹{n} bache'),
    less: T('One less', 'एक कम', 'Ek kam'),
    more: T('One more', 'एक और', 'Ek aur'),
    offTitle: T('This combo is not on right now', 'यह कॉम्बो अभी नहीं मिल रहा', 'Yeh combo abhi nahi mil raha'),
    offText: T('Combos run at set times. Everything on it is still on the menu.', 'कॉम्बो तय समय पर मिलते हैं। इसकी सारी चीज़ें मेन्यू में हैं।', 'Combo fixed time pe milte hain. Iski saari cheezein menu mein hain.'),
    toMenu: T('See the menu', 'मेन्यू देखें', 'Menu dekho'),
    added: T('Combo added to your cart', 'कॉम्बो कार्ट में जुड़ गया', 'Combo cart mein add ho gaya'),
    viewCart: T('View cart', 'कार्ट देखें', 'Cart dekho'),
    loading: T('Loading…', 'लोड हो रहा है…', 'Load ho raha hai…'),
};

const rupees = (n) => Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const nm = (x, lang) => (lang === 'hi' && x?.nameHi) || x?.name || '';
const hhmm = (s) => {
    if (!s) return '';
    const [h, m] = s.split(':').map(Number);
    const ap = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return m ? `${h12}:${String(m).padStart(2, '0')} ${ap}` : `${h12} ${ap}`;
};

const Combo = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    const location = useLocation();
    const { lang, t } = useCxLang();
    const { show } = usePortal();
    const { items, addLine, replaceLine } = useCart();
    const editKey = location.state?.editKey || null;
    const editing = editKey ? items.find(i => i.key === editKey && i.combo === id) : null;

    const [combo, setCombo] = useState(undefined);
    const [prices, setPrices] = useState({});
    const [dishes, setDishes] = useState({});    // menu item id → dish_detail (sizes, groups)
    const [picks, setPicks] = useState([]);       // one per slot: menu item id
    const [sels, setSels] = useState({});         // `${slot}:${menuItem}` → { size, choices }
    const [qty, setQty] = useState(1);
    const [note, setNote] = useState('');
    const [toast, setToast] = useState(false);
    const leaving = useRef(null);
    const asked = useRef(new Set());

    useEffect(() => {
        let gone = false;
        getCombosOnSale().then(r => {
            if (gone) return;
            const c = (r.data || []).find(x => x.id === id) || null;
            setCombo(c);
            if (!c) return;
            const start = (c.slots || []).map((s, i) => {
                const want = editing?.picks?.[i]?.menuItem;
                return (s.items || []).some(x => x.menuItem === want) ? want : s.items?.[0]?.menuItem;
            });
            setPicks(start);
            if (editing) {
                const pre = {};
                editing.picks.forEach((p, i) => { pre[`${i}:${p.menuItem}`] = { size: p.size, choices: p.choices, fromCart: true }; });
                setSels(pre);
                setQty(editing.quantity);
                setNote(editing.note || '');
            }
        }).catch(() => !gone && setCombo(null));
        getMenuItems().then(r => !gone && setPrices(Object.fromEntries((r.data || []).map(m => [m._id, m])))).catch(() => {});
        return () => { gone = true; clearTimeout(leaving.current); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id, editKey]);

    useEffect(() => {
        document.documentElement.classList.add('cx-no-tabs');
        return () => document.documentElement.classList.remove('cx-no-tabs');
    }, []);

    // Sizes and choices of each picked dish that has them (loaded once per dish)
    useEffect(() => {
        if (!combo) return;
        combo.slots.forEach((s, i) => {
            const it = s.items.find(x => x.menuItem === picks[i]);
            if (!it?.hasChoices || asked.current.has(it.menuItem)) return;
            asked.current.add(it.menuItem);
            getDishDetail(it.menuItem).then(r => r.data && setDishes(d => ({ ...d, [it.menuItem]: r.data }))).catch(() => {});
        });
    }, [combo, picks]);

    const selOf = (i, mid) => {
        const d = dishes[mid];
        const s = sels[`${i}:${mid}`];
        if (!d) return s || { size: '', choices: [] };
        if (!s) return defaultSelection(d.sizes, d.groups);
        return s.fromCart ? cleanSelection(d.sizes, d.groups, s) : s;
    };

    const priced = useMemo(() => {
        if (!combo) return { unit: 0, before: 0 };
        let unit = Number(combo.price);
        let before = 0;
        combo.slots.forEach((s, i) => {
            const it = s.items.find(x => x.menuItem === picks[i]);
            if (!it) return;
            unit += Number(it.extra || 0);
            const d = dishes[it.menuItem];
            const base = Number(prices[it.menuItem]?.price || 0);
            if (d) {
                const sel = selOf(i, it.menuItem);
                const mine = dishPrice(base, d.sizes, d.groups, sel);
                const usual = dishPrice(base, d.sizes, d.groups, {});
                unit += Math.max(mine - usual, 0);
                before += mine;
            } else {
                const m = prices[it.menuItem];
                const def = m?.sizes?.length ? sizeOf(m.sizes)?.price : m?.price;
                before += Number(def || 0);
            }
        });
        return { unit, before };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [combo, picks, sels, dishes, prices]);

    const goBack = () => (location.key !== 'default' ? navigate(-1) : navigate('/'));

    if (combo === undefined) return <div className="dish-page dish-wait"><div className="spinner" aria-label={t(W.loading)} /></div>;
    if (!combo) {
        return (
            <div className="dish-page dish-missing">
                <Art kind="croissant" className="dish-missing-art" />
                <h2>{t(W.offTitle)}</h2>
                <p className="combo-off-text">{t(W.offText)}</p>
                <Link to="/menu" className="dish-btn">{t(W.toMenu)}</Link>
            </div>
        );
    }

    const firstArt = (s) => s?.items?.[0] ? artFor({ name: s.items[0].name, art: s.items[0].art }) : 'plate';
    const time = combo.timeFrom && combo.timeTo ? ` · ${hhmm(combo.timeFrom)} – ${hhmm(combo.timeTo)}` : '';
    const total = priced.unit * qty;

    const add = (e) => {
        const linePicks = combo.slots.map((s, i) => {
            const it = s.items.find(x => x.menuItem === picks[i]);
            const d = dishes[it.menuItem];
            const sel = d ? selOf(i, it.menuItem) : { size: '', choices: [] };
            const c = d ? canonical(d.sizes, d.groups, sel) : sel;
            const size = d?.sizes?.length ? sizeOf(d.sizes, sel.size) : null;
            return {
                menuItem: it.menuItem, name: it.name, nameHi: it.nameHi, art: it.art || artFor(it), image: it.image,
                size: c.size, sizeName: c.size && size ? size.name : '', choices: c.choices,
                choiceText: d ? selectionText(d.sizes, d.groups, sel, 'en') : '', choiceTextHi: d ? selectionText(d.sizes, d.groups, sel, 'hi') : '',
            };
        });
        const line = {
            combo: combo.id, name: combo.name, nameHi: combo.nameHi, image: combo.image, art: combo.art || firstArt(combo.slots[0]),
            price: priced.unit, quantity: qty, picks: linePicks, note: note.trim(),
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
            leaving.current = setTimeout(() => setToast(false), 4000);
        }
    };

    return (
        <div className="dish-page combo-page">
            <div className="dish-wide-head"><Header /></div>
            <div className="combo-wrap">
                <div className="combo-top">
                    <button type="button" className="dish-ib" onClick={goBack} aria-label={t(W.back)}><FiArrowLeft /></button>
                    <b>{nm(combo, lang)}</b>
                    <span className="combo-top-gap" />
                </div>

                <div className="combo-banner" style={combo.bg ? { background: combo.bg } : undefined}>
                    <small>{t(W.combo).toUpperCase()}{time}</small>
                    <h1>{nm(combo, lang)}</h1>
                    <p>₹{rupees(combo.price)}{combo.save > 0 && <> · {t(W.saveUpTo, { n: rupees(combo.save) })}</>}</p>
                    {combo.description && <p className="combo-desc">{combo.description}</p>}
                    <span className="combo-banner-art">
                        {combo.image ? <img src={getImageUrl(combo.image)} alt="" /> : <Art kind={combo.art || firstArt(combo.slots[1] || combo.slots[0])} />}
                    </span>
                </div>

                {combo.slots.map((s, i) => {
                    const chosen = s.items.find(x => x.menuItem === picks[i]);
                    const d = chosen ? dishes[chosen.menuItem] : null;
                    return (
                        <div className="combo-step" key={i}>
                            <h5><i>{i + 1}</i>{nm(s, lang)}</h5>
                            <div className="combo-opts" role="radiogroup" aria-label={nm(s, lang)}>
                                {s.items.map(it => {
                                    const on = it.menuItem === picks[i];
                                    return (
                                        <button key={it.menuItem} type="button" role="radio" aria-checked={on} className={`combo-opt ${on ? 'on' : ''}`}
                                            onClick={() => setPicks(p => p.map((x, j) => (j === i ? it.menuItem : x)))}>
                                            {on && <span className="combo-tick"><FiCheck /></span>}
                                            <span className="combo-ph">
                                                {show('photos') && it.image ? <img src={getImageUrl(it.image)} alt="" /> : <Art kind={artFor({ name: it.name, art: it.art })} />}
                                            </span>
                                            <span className="combo-name">{nm(it, lang)}</span>
                                            <span className="combo-up">{Number(it.extra) > 0 ? `+₹${rupees(it.extra)}` : t(W.included)}</span>
                                        </button>
                                    );
                                })}
                            </div>
                            {chosen?.hasChoices && d && (d.sizes?.length > 1 || d.groups?.length > 0) && (
                                <div className="combo-yours">
                                    <h6>{t(W.yours, { name: nm(chosen, lang) })}</h6>
                                    <ChoicePicker compact sizes={d.sizes} groups={d.groups} lang={lang} t={t}
                                        value={selOf(i, chosen.menuItem)}
                                        onChange={(v) => setSels(x => ({ ...x, [`${i}:${chosen.menuItem}`]: v }))} />
                                </div>
                            )}
                        </div>
                    );
                })}

                <label className="dish-field combo-field">
                    <span>{t(W.noteLabel)}</span>
                    <input type="text" value={note} maxLength={120} placeholder={t(W.notePh)} onChange={(e) => setNote(e.target.value)} />
                </label>

                {combo.doublePoints && <div className="dish-note combo-points"><FiGift /><span>{t(W.double)}</span></div>}

                <div className="dish-bar combo-bar">
                    {priced.before > priced.unit && (
                        <div className="combo-price">
                            <s>₹{rupees(priced.before * qty)}</s>
                            <b>{t(W.youSave, { n: rupees((priced.before - priced.unit) * qty) })}</b>
                        </div>
                    )}
                    <div className="dish-qty">
                        <button type="button" onClick={() => setQty(q => Math.max(1, q - 1))} aria-label={t(W.less)} disabled={qty <= 1}><FiMinus /></button>
                        <span aria-live="polite">{qty}</span>
                        <button type="button" onClick={() => setQty(q => Math.min(99, q + 1))} aria-label={t(W.more)}><FiPlus /></button>
                    </div>
                    <button type="button" className="dish-add" onClick={add}>{t(editing ? W.update : W.add, { n: rupees(total) })}</button>
                </div>
            </div>
            {toast && (
                <div className="dish-toast" role="status">
                    <span>{t(W.added)}</span>
                    <Link to="/cart">{t(W.viewCart)}</Link>
                </div>
            )}
        </div>
    );
};

export default Combo;
