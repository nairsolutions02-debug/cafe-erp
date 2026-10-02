import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiBell } from 'react-icons/fi';
import { getMyNotifications, ackNotification, runDailyReminders } from '../utils/api';
import { useAuth } from '../context/AuthContext';
import './pos/POS.css';

const ago = (iso) => {
    const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m} min ago`;
    const h = Math.floor(m / 60);
    return h < 24 ? `${h} h ago` : new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
};

// A looping alarm tone made in the browser (no sound file needed)
function useAlarmTone() {
    const ctx = useRef(null);
    const timer = useRef(null);
    const stop = useCallback(() => {
        clearInterval(timer.current);
        timer.current = null;
    }, []);
    const start = useCallback(() => {
        if (timer.current) return;
        const ring = () => {
            try {
                ctx.current = ctx.current || new (window.AudioContext || window.webkitAudioContext)();
                const c = ctx.current;
                [0, 0.2, 0.4].forEach((t, i) => {
                    const o = c.createOscillator();
                    const g = c.createGain();
                    o.frequency.value = i % 2 ? 660 : 990;
                    g.gain.value = 0.3;
                    o.connect(g);
                    g.connect(c.destination);
                    o.start(c.currentTime + t);
                    o.stop(c.currentTime + t + 0.16);
                });
                navigator.vibrate?.([300, 100, 300]);
            } catch { /* audio is blocked until someone taps the page */ }
        };
        ring();
        timer.current = setInterval(ring, 1500);
    }, []);
    useEffect(() => stop, [stop]);
    return useMemo(() => ({ start, stop }), [start, stop]);
}

// Bell with recent alerts; alarm-level alerts (payment requested, staff left…) take over the screen
const Notifications = () => {
    const { socket } = useAuth();
    const navigate = useNavigate();
    const [items, setItems] = useState([]);
    const [open, setOpen] = useState(false);
    const [alarm, setAlarm] = useState(null);
    const tone = useAlarmTone();

    const load = useCallback(async () => {
        try {
            const list = (await getMyNotifications(40)).data;
            setItems(list);
            return list;
        } catch {
            return [];
        }
    }, []);

    useEffect(() => {
        runDailyReminders().catch(() => {}).finally(load);
        const t = setInterval(load, 60000);
        return () => clearInterval(t);
    }, [load]);

    useEffect(() => {
        if (!socket) return undefined;
        const onNew = async (row) => {
            const list = await load();
            const n = list.find(x => x.id === row.id);
            if (n && n.priority === 'alarm' && !n.acknowledgedAt) {
                setAlarm(n);
                tone.start();
            } else if (n && n.priority === 'loud') {
                tone.start();
                setTimeout(tone.stop, 3000);
            }
        };
        socket.on('notification', onNew);
        return () => socket.off('notification', onNew);
    }, [socket, load, tone]);

    const unread = items.filter(n => !n.acknowledgedAt && Date.now() - new Date(n.createdAt).getTime() < 864e5).length;

    const openItem = async (n) => {
        setOpen(false);
        if (!n.acknowledgedAt) await ackNotification(n.id).catch(() => {});
        load();
        if (n.link) navigate(n.link);
    };
    const acknowledge = async () => {
        tone.stop();
        const n = alarm;
        setAlarm(null);
        await ackNotification(n.id).catch(() => {});
        load();
        if (n.link) navigate(n.link);
    };

    return (
        <div className="bell">
            <button className="bell-btn" aria-label={`Alerts${unread ? ` (${unread} new)` : ''}`} onClick={() => setOpen(o => !o)}>
                <FiBell />{unread > 0 && <span className="bell-count">{unread}</span>}
            </button>
            {open && (
                <div className="bell-list">
                    {items.length === 0 && <p className="bell-item">No alerts yet.</p>}
                    {items.map(n => (
                        <button key={n.id} className={`bell-item${n.acknowledgedAt ? '' : ' unread'}`} onClick={() => openItem(n)}>
                            <strong>{n.title}</strong>
                            {n.body && <span>{n.body}</span>}
                            <small> · {ago(n.createdAt)}{n.acknowledgedBy ? ` · seen by ${n.acknowledgedBy}` : ''}</small>
                        </button>
                    ))}
                </div>
            )}
            {alarm && (
                <div className="alarm-overlay" role="alertdialog" aria-label={alarm.title}>
                    <FiBell size={64} />
                    <h2>{alarm.title}</h2>
                    {alarm.body && <p>{alarm.body}</p>}
                    <button onClick={acknowledge}>Acknowledge</button>
                </div>
            )}
        </div>
    );
};

export default Notifications;
