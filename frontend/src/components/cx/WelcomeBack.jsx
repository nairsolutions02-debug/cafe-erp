import React, { useEffect, useRef, useState } from 'react';
import { FiPlus, FiCheck, FiGift } from 'react-icons/fi';
import { useAuth } from '../../context/AuthContext';
import { useCart } from '../../context/CartContext';
import { getMyUsual, getMyLoyaltyPoints, quoteLines } from '../../utils/api';
import useCxLang, { T } from '../../lib/cxLang';
import Art from './Art';
import { artFor } from './artKinds';
import { Beans } from './Welcome';
import './Journey.css';

const W = {
    hello: T('Welcome back,', 'फिर से स्वागत है,', 'Welcome back,'),
    table: T('Table {n}', 'टेबल {n}', 'Table {n}'),
    lastWas: T('your last visit was {ago}', 'आप पिछली बार {ago} आए थे', 'aapki last visit {ago} thi'),
    today: T('good to see you again today', 'आज फिर से आपको देखकर अच्छा लगा', 'aaj phir se aap, badhiya'),
    usual: T('Your usual', 'आपका रोज़ वाला', 'Aapka usual'),
    added: T('Added to your cart', 'कार्ट में जुड़ गया', 'Cart mein add ho gaya'),
    addUsual: T('Add {name} to cart', '{name} कार्ट में जोड़ें', '{name} cart mein add karo'),
    waiting: T('Waiting for you', 'आपके लिए रखे हैं', 'Aapke liye rakhe hain'),
    pointsCash: T('{p} points = ₹{r} off', '{p} पॉइंट = ₹{r} की छूट', '{p} points = ₹{r} off'),
    points: T('{p} points', '{p} पॉइंट', '{p} points'),
    opening: T('Opening your home page…', 'आपका होम पेज खुल रहा है…', 'Aapka home page khul raha hai…'),
    tapGo: T('Tap anywhere to continue', 'आगे बढ़ने के लिए कहीं भी दबाएँ', 'Aage badhne ke liye kahin bhi tap karo'),
};

// "2 days ago", "3 weeks ago", "20 months ago" in the customer's language
const AGO = {
    yesterday: T('yesterday', 'कल', 'kal'),
    days: T('{n} days ago', '{n} दिन पहले', '{n} din pehle'),
    weeks: T('{n} weeks ago', '{n} हफ़्ते पहले', '{n} hafte pehle'),
    month: T('a month ago', 'एक महीना पहले', 'ek mahina pehle'),
    months: T('{n} months ago', '{n} महीने पहले', '{n} mahine pehle'),
    year: T('a year ago', 'एक साल पहले', 'ek saal pehle'),
    years: T('{n} years ago', '{n} साल पहले', '{n} saal pehle'),
};
// eslint-disable-next-line react-refresh/only-export-components
export const sayAgo = (when, t, now = Date.now()) => {
    const start = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); };
    const days = Math.round((start(now) - start(when)) / 86400000);
    if (!(days > 0)) return null; // today (or a clock in the future)
    if (days === 1) return t(AGO.yesterday);
    if (days < 14) return t(AGO.days, { n: days });
    if (days < 60) return t(AGO.weeks, { n: Math.round(days / 7) });
    const months = Math.round(days / 30.44);
    if (months < 24) return months <= 1 ? t(AGO.month) : t(AGO.months, { n: months });
    const years = Math.round(days / 365.25);
    return years <= 1 ? t(AGO.year) : t(AGO.years, { n: years });
};

// "Medium · Oat, Hazelnut" from the options and note saved on the last order line
const usualWay = (u) => [u?.options?.sizeName, u?.note].filter(Boolean).join(' · ');

const BASE_MS = 1500; // the greeting on its own
const CARDS_MS = 1200; // a little longer when there is a usual or points to look at
const WAIT_MS = 1200; // most time spent waiting for "your usual" before going ahead without it

// Full-screen "Welcome back, <name>" after a signed-in customer scans a table QR, then the home page.
// Tapping anywhere goes on at once. Never blocks ordering: if the usual or points can't be read, it just greets.
const WelcomeBack = ({ tableNumber, onDone }) => {
    const { user } = useAuth();
    const cart = useCart();
    const { lang, t } = useCxLang();
    const [data, setData] = useState({ ready: false, usual: null, lastVisit: null, points: null });
    const [added, setAdded] = useState(false);
    const [paused, setPaused] = useState(false);
    const doneRef = useRef(false);
    const finish = () => { if (!doneRef.current) { doneRef.current = true; onDone?.(); } };

    useEffect(() => {
        let live = true;
        const usual = getMyUsual().then(r => r.data || {}).catch(() => ({}));
        const pts = (user?.loyaltyPoints > 0 ? getMyLoyaltyPoints().then(r => r.data).catch(() => null) : Promise.resolve(null));
        const timeout = new Promise(res => setTimeout(() => res('timeout'), WAIT_MS));
        Promise.race([Promise.all([usual, pts]), timeout]).then((r) => {
            if (!live) return;
            if (r === 'timeout') { setData(d => ({ ...d, ready: true })); return; }
            const [u, p] = r;
            setData({ ready: true, usual: u?.usual?.isAvailable === false ? null : (u?.usual || null), lastVisit: u?.lastVisit || null, points: p });
        });
        return () => { live = false; };
    }, [user?.loyaltyPoints]);

    const hasCards = !!(data.usual || data.points?.currentPoints > 0);
    const total = BASE_MS + (hasCards ? CARDS_MS : 0);
    useEffect(() => {
        if (!data.ready || paused) return undefined;
        const timer = setTimeout(finish, total);
        return () => clearTimeout(timer);
    }, [data.ready, paused, total]); // eslint-disable-line react-hooks/exhaustive-deps

    // + on "Your usual": the same dish with the same size and choices
    const addUsual = async (e) => {
        e.stopPropagation();
        const u = data.usual;
        if (!u || added) return;
        setPaused(true);
        try {
            const opts = u.options || {};
            const choices = (opts.choices || []).map(c => c.id).filter(Boolean);
            const line = { menuItem: u._id, quantity: 1, size: opts.size || undefined, choices };
            const q = (await quoteLines([line])).data?.[0];
            const item = { _id: u._id, name: u.name, nameHi: u.nameHi, image: u.image, art: u.art, isVeg: u.isVeg, price: Number(q?.price) || 0 };
            if (typeof cart?.addLine === 'function') {
                // Same size and choices as last time; the server line note is the readable choices ("Oat, Hazelnut")
                cart.addLine({ ...item, quantity: 1, size: opts.size || '', sizeName: opts.sizeName || '', choices,
                    choiceText: choices.length ? (q?.note || u.note || '') : '' });
            } else {
                cart?.addItem?.(item);
            }
            setAdded(true);
            setTimeout(finish, 700);
        } catch {
            setPaused(false);
        }
    };

    const ago = data.lastVisit ? sayAgo(data.lastVisit, t) : null;
    const name = user?.name || '';
    const u = data.usual;
    const uName = (lang === 'hi' && u?.nameHi) || u?.name;
    const p = data.points;

    return (
        <div className="cxj-wb" role="button" tabIndex={0} aria-label={t(W.tapGo)} onClick={finish}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') finish(); }}>
            <Beans />
            <div className="cxj-wb-in">
                <div className="cxj-av cxj-av-xl" aria-hidden="true">{name.charAt(0).toUpperCase()}</div>
                <h1 className="cxj-h">{t(W.hello)}<br />{name}</h1>
                <p className="cxj-wb-sub">
                    {tableNumber ? t(W.table, { n: tableNumber }) : null}
                    {tableNumber && (ago || data.lastVisit) ? ' · ' : null}
                    {ago ? t(W.lastWas, { ago }) : data.lastVisit ? t(W.today) : null}
                </p>

                {u && (
                    <div className="cxj-card cxj-pop">
                        <div className="cxj-ph">{u.image ? <img src={u.image} alt="" /> : <Art kind={artFor(u)} />}</div>
                        <div className="cxj-grow">
                            <small className="cxj-mu">{t(W.usual)}</small>
                            <b>{uName}</b>
                            {usualWay(u) && <small className="cxj-mu">{usualWay(u)}</small>}
                        </div>
                        <button type="button" className={`cxj-add ${added ? 'on' : ''}`} onClick={addUsual}
                            aria-label={added ? t(W.added) : t(W.addUsual, { name: uName })}>
                            {added ? <FiCheck /> : <FiPlus />}
                        </button>
                    </div>
                )}

                {p?.currentPoints > 0 && (
                    <div className="cxj-card cxj-pop" style={{ animationDelay: '.08s' }}>
                        <div className="cxj-ph cxj-ph-icon"><FiGift /></div>
                        <div className="cxj-grow">
                            <small className="cxj-mu">{t(W.waiting)}</small>
                            <b>{p.canRedeem && p.pointsValue > 0
                                ? t(W.pointsCash, { p: p.currentPoints, r: Math.floor(Number(p.pointsValue)) })
                                : t(W.points, { p: p.currentPoints })}</b>
                        </div>
                    </div>
                )}

                <div className="cxj-progress" aria-hidden="true">
                    <i className={data.ready ? 'go' : 'wait'} style={data.ready ? { animationDuration: `${total}ms`, animationPlayState: paused ? 'paused' : 'running' } : undefined} />
                </div>
                <p className="cxj-wb-small" aria-live="polite">{added ? t(W.added) : t(W.opening)}</p>
            </div>
        </div>
    );
};

export default WelcomeBack;
