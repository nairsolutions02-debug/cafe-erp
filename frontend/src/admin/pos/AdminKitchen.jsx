import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FiMaximize, FiPrinter, FiVolume2 } from 'react-icons/fi';
import { getKitchenOrders, setKitchenStatus } from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import { printKot } from '../../lib/print';
import './POS.css';

const NEXT = { queued: 'preparing', preparing: 'ready', ready: 'queued' };
const minutes = (iso) => Math.floor((Date.now() - new Date(iso).getTime()) / 60000);

// Kitchen display: one ticket per order. Tap a line to move it queued → preparing → ready.
const AdminKitchen = () => {
    const { socket, hasPerm } = useAuth();
    const [orders, setOrders] = useState([]);
    const [, tick] = useState(0);
    const [sound, setSound] = useState(() => localStorage.getItem('kds-sound') !== '0');
    const known = useRef(null);
    const canEdit = hasPerm('orders.edit');

    const beep = useCallback(() => {
        if (!sound) return;
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            [0, 0.25, 0.5].forEach(t => {
                const o = ctx.createOscillator();
                o.frequency.value = 880;
                o.connect(ctx.destination);
                o.start(ctx.currentTime + t);
                o.stop(ctx.currentTime + t + 0.15);
            });
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

    return (
        <div className="kds">
            <div className="kds-head">
                <h1>Kitchen</h1>
                <span className="muted">{orders.length} open ticket{orders.length === 1 ? '' : 's'}</span>
                <label className="check small"><input type="checkbox" checked={sound}
                    onChange={e => { setSound(e.target.checked); localStorage.setItem('kds-sound', e.target.checked ? '1' : '0'); }} /> <FiVolume2 /> Sound</label>
                <button className="btn btn-ghost btn-sm" onClick={() => document.documentElement.requestFullscreen?.()}><FiMaximize /> Full screen</button>
            </div>
            <div className="kds-grid">
                {orders.map(o => {
                    const age = minutes(o.createdAt);
                    const allReady = o.items.every(i => i.status === 'ready' || i.status === 'served');
                    return (
                        <div key={o.id} className={`ticket${allReady ? ' ready' : age >= 20 ? ' late' : age >= 10 ? ' warn' : ''}`}>
                            <div className="ticket-head">
                                <strong>{o.tableNumber ? `Table ${o.tableNumber}` : o.tokenNumber ? `Token ${o.tokenNumber}` : o.orderNumber.slice(-6)}{o.tableNumber && o.customer && o.tableGroups > 1 ? ` · ${o.customer.split(' ')[0]}` : ''}</strong>
                                <span className="muted">{age} min</span>
                            </div>
                            <div className="muted small">{o.channel.replace('_', ' ')} · {o.orderNumber}{o.customer ? ` · ${o.customer}` : ''}</div>
                            {o.items.filter(i => i.status !== 'served').map(i => (
                                <button key={i.id} className={`ticket-item ${i.status}`} disabled={!canEdit}
                                    onClick={() => set(o.id, i.id, NEXT[i.status] || 'ready')}>
                                    <span>{i.quantity} × {i.name}{i.note && <small>{i.note}</small>}</span>
                                    <span className="small">{i.status}</span>
                                </button>
                            ))}
                            {o.note && <div className="ticket-note">{o.note}</div>}
                            {canEdit && (
                                <div className="ticket-actions">
                                    {allReady
                                        ? <button className="btn btn-success btn-sm" onClick={() => set(o.id, null, 'served')}>Served</button>
                                        : <button className="btn btn-primary btn-sm" onClick={() => set(o.id, null, 'ready')}>All ready</button>}
                                    <button className="btn btn-ghost btn-sm" onClick={() => printKot({ ...o, specialInstructions: o.note })}><FiPrinter /> KOT</button>
                                </div>
                            )}
                        </div>
                    );
                })}
                {orders.length === 0 && <p className="muted">No orders in the kitchen. New orders appear here with a sound.</p>}
            </div>
        </div>
    );
};

export default AdminKitchen;
