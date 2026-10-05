import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FiMaximize, FiMinimize, FiPrinter, FiVolume2, FiMoon, FiSun } from 'react-icons/fi';
import { getKitchenOrders, setKitchenStatus } from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import { printKot } from '../../lib/print';
import useMenuLang, { tableToken } from '../mobile/useMenuLang';
import { W } from '../mobile/staffText';
import { readKdsTheme, setKdsTheme, onThemeChange } from '../mobile/useAdminTheme';
import { playTones } from '../../lib/sound';
import './POS.css';

const NEXT = { queued: 'preparing', preparing: 'ready', ready: 'queued' };
const OLD_MINUTES = 360;
const minutes = (iso) => Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
const LABEL = { queued: 'waiting', preparing: 'cooking', ready: 'ready' };
const STATION_SHORT = { hot: 'Hot', bar: 'Bar', cold: 'Cold' };
const CHANNEL = { qr: 'QR', dine_in: 'Dine-in', takeaway: 'Takeaway', counter: 'Counter', aggregator: 'Delivery' };
const readStation = () => { try { return localStorage.getItem('kds-station') || 'all'; } catch { return 'all'; } };

// Kitchen display: one ticket per order, oldest first. Tap a line to move it waiting → cooking → ready.
// Station chips (Menu, Categories) let the coffee bar phone show only drinks; the choice is kept on this device.
const AdminKitchen = () => {
    const { socket, hasPerm } = useAuth();
    const [orders, setOrders] = useState([]);
    const [, tick] = useState(0);
    const [sound, setSound] = useState(() => localStorage.getItem('kds-sound') !== '0');
    const [station, setStation] = useState(readStation);
    const { t } = useMenuLang();
    const [theme, setTheme] = useState(readKdsTheme);
    const nextTheme = () => {
        const v = { auto: 'dark', dark: 'light', light: 'auto' }[theme] || 'auto';
        setTheme(v);
        setKdsTheme(v);
    };
    useEffect(() => onThemeChange(() => setTheme(readKdsTheme())), []);
    const known = useRef(null);
    const canEdit = hasPerm('orders.edit');

    const beep = useCallback(() => {
        if (!sound) return;
        try {
            playTones([[0, 880], [0.25, 880], [0.5, 880]], 0.15, 0.5);
        } catch { /* audio blocked until the first tap */ }
    }, [sound]);

    const load = useCallback(async () => {
        const list = (await getKitchenOrders()).data;
        if (known.current && list.some(o => !known.current.has(o.id))) beep();
        known.current = new Set(list.map(o => o.id));
        setOrders(list);
    }, [beep]);

    useEffect(() => {
        load();
        const poll = setInterval(load, 15000);
        const clock = setInterval(() => tick(t => t + 1), 30000);
        return () => { clearInterval(poll); clearInterval(clock); };
    }, [load]);

    useEffect(() => {
        if (!socket) return undefined;
        const refresh = () => load();
        socket.on('new-order', refresh);
        socket.on('order-updated', refresh);
        return () => { socket.off('new-order', refresh); socket.off('order-updated', refresh); };
    }, [socket, load]);

    const set = async (orderId, itemId, status) => {
        if (!canEdit) return;
        try {
            setOrders((await setKitchenStatus(orderId, itemId, status)).data);
        } catch (err) {
            alert(err.response?.data?.message || 'Could not update');
        }
    };

    const age = (o) => minutes(o.createdAt);
    // Full screen on the kitchen hides the side menu and header, for a TV or tablet on the wall
    const [display, setDisplay] = useState(() => !!document.fullscreenElement);
    useEffect(() => {
        const onChange = () => setDisplay(!!document.fullscreenElement);
        document.addEventListener('fullscreenchange', onChange);
        return () => document.removeEventListener('fullscreenchange', onChange);
    }, []);
    useEffect(() => {
        document.documentElement.classList.toggle('kds-display', display);
        return () => document.documentElement.classList.remove('kds-display');
    }, [display]);
    const toggleFull = () => (document.fullscreenElement ? document.exitFullscreen?.() : document.documentElement.requestFullscreen?.())?.catch?.(() => {});
    const ageCls = (m) => (m >= 15 ? 'late' : m >= 8 ? 'warn' : '');
    const open = (i) => i.status !== 'served';
    const inStation = (i, st) => st === 'all' || (i.station || 'hot') === st;
    const used = ['hot', 'bar', 'cold'].map(k => [k, t(W[k])]).filter(([k]) => orders.some(o => o.items.some(i => open(i) && inStation(i, k))));
    const view = used.some(([k]) => k === station) ? station : 'all';
    const all = orders
        .map(o => ({ o, items: o.items.filter(i => open(i) && inStation(i, view)) }))
        .filter(t => t.items.length > 0);
    // Tickets older than 6 hours were almost always served without a tap: keep them out of the way
    const tickets = all.filter(({ o }) => age(o) < OLD_MINUTES);
    const earlier = all.filter(({ o }) => age(o) >= OLD_MINUTES);
    const clearEarlier = async () => {
        if (!window.confirm(`${earlier.length} old tickets: mark them as served? Payments are not changed.`)) return;
        for (const { o } of earlier) await set(o.id, null, 'served');
    };
    const pick = (k) => { setStation(k); try { localStorage.setItem('kds-station', k); } catch { /* private mode */ } };
    const allReadyAt = async (o, items) => {
        if (view === 'all') return set(o.id, null, 'ready');
        for (const i of items) if (i.status !== 'ready') await set(o.id, i.id, 'ready');
        return undefined;
    };

    return (
        <div className="kds">
            <div className="kds-head">
                <h1>Kitchen</h1>
                <span className="kds-sum">{tickets.length} {t(W.tickets)}{tickets.length > 0 ? ` · ${t(W.oldest)} ${age(tickets[0].o)} min` : ''}</span>
                <button type="button" className={`kds-icon${sound ? ' on' : ''}`} aria-pressed={sound} aria-label="Sound for new orders"
                    onClick={() => { setSound(!sound); localStorage.setItem('kds-sound', sound ? '0' : '1'); }}><FiVolume2 /> <span>{t(sound ? W.soundOn : W.soundOff)}</span></button>
                <button type="button" className="kds-icon" onClick={nextTheme} aria-label={`${t(W.themeLabel)}: ${t(W[`theme${theme[0].toUpperCase()}${theme.slice(1)}`])}`}
                    title={t(W.themeLabel)}>{theme === 'light' ? <FiSun /> : <FiMoon />} <span>{t(W[`theme${theme[0].toUpperCase()}${theme.slice(1)}`])}</span></button>
                <button type="button" className="kds-icon kds-full" onClick={toggleFull}>{display ? <FiMinimize /> : <FiMaximize />} <span>{t(display ? W.exitFull : W.fullScreen)}</span></button>
            </div>
            {used.length > 1 && (
                <div className="kds-chips" role="group" aria-label="Station">
                    {[['all', t(W.all)], ...used].map(([k, l]) => {
                        const n = orders.filter(o => age(o) < OLD_MINUTES && o.items.some(i => open(i) && i.status !== 'ready' && inStation(i, k))).length;
                        return <button key={k} type="button" aria-pressed={view === k} onClick={() => pick(k)}>{l}<span>{n}</span></button>;
                    })}
                </div>
            )}
            <div className="kds-grid">
                {tickets.map(({ o, items }) => {
                    const m = age(o);
                    const allReady = items.every(i => i.status === 'ready');
                    return (
                        <article key={o.id} className={`ticket ${allReady ? 'ready' : ageCls(m)}`}>
                            <div className="ticket-head">
                                <span className="ticket-tok">{o.tableNumber ? tableToken(o.tableNumber) : o.tokenNumber || o.orderNumber.slice(-4)}</span>
                                <span className="ticket-who">
                                    <b>{o.tableNumber ? `${t(W.table)} ${o.tableNumber}` : CHANNEL[o.channel] || o.channel.replace('_', ' ')}</b>
                                    {o.customer ? (o.tableNumber && o.tableGroups > 1 ? `${o.customer.split(' ')[0]} · ${o.tableGroups} groups` : o.customer) : o.orderNumber}
                                </span>
                                <span className={`ticket-age ${ageCls(m)}`}>{m}m</span>
                            </div>
                            {o.note && <div className="ticket-note">{o.note}</div>}
                            <ul className="ticket-items">
                                {items.map(i => (
                                    <li key={i.id}>
                                        <button type="button" className={`ticket-item ${i.status}`} disabled={!canEdit} aria-label={`${i.quantity} ${i.name}: ${LABEL[i.status] || i.status}. Tap for ${LABEL[NEXT[i.status]] || 'ready'}`}
                                            onClick={() => set(o.id, i.id, NEXT[i.status] || 'ready')}>
                                            <span className="ti-q">{i.quantity}</span>
                                            <span className="ti-name">{i.name}{i.note && <small>{i.note}</small>}</span>
                                            {view === 'all' && used.length > 1 && <span className="ti-st">{STATION_SHORT[i.station || 'hot']}</span>}
                                            <span className="ti-check" aria-hidden="true">{i.status === 'ready' ? '✓' : i.status === 'preparing' ? '•••' : ''}</span>
                                        </button>
                                    </li>
                                ))}
                            </ul>
                            {canEdit && (
                                <div className="ticket-actions">
                                    {allReady && view === 'all'
                                        ? <button className="btn btn-success" onClick={() => set(o.id, null, 'served')}>{t(W.served)}</button>
                                        : <button className="btn btn-success" disabled={allReady} onClick={() => allReadyAt(o, items)}>{t(W.allReady)}</button>}
                                    <button className="btn btn-ghost" aria-label="Print kitchen ticket" onClick={() => printKot({ ...o, specialInstructions: o.note })}><FiPrinter /> KOT</button>
                                </div>
                            )}
                        </article>
                    );
                })}
                {tickets.length === 0 && <p className="kds-empty">{t(view === 'all' ? W.kitchenEmpty : W.stationEmpty)}</p>}
            </div>
            {earlier.length > 0 && (
                <details className="kds-earlier">
                    <summary>{t(W.earlier)} ({earlier.length}) · {t(W.earlierHint)}</summary>
                    <ul>
                        {earlier.map(({ o, items }) => (
                            <li key={o.id}>
                                <b>{o.tableNumber ? `${t(W.table)} ${o.tableNumber}` : o.tokenNumber || o.orderNumber}</b>
                                <span>{items.map(i => `${i.quantity}× ${i.name}`).join(', ')}</span>
                                <small>{Math.round(age(o) / 60)}h</small>
                            </li>
                        ))}
                    </ul>
                    {canEdit && <button type="button" className="btn btn-secondary" onClick={clearEarlier}>{t(W.clearEarlier)}</button>}
                </details>
            )}
        </div>
    );
};

export default AdminKitchen;
