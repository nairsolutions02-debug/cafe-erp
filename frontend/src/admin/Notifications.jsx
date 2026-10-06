import { playTones, soundReady, unlockSound, onSoundReady } from '../lib/sound';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import OrderAlert from './alerts/OrderAlert';
import { fullScreenAlertsHere, setFullScreenAlertsHere } from './alerts/alertsHere';
import { FiBell, FiVolumeX } from 'react-icons/fi';
import { getMyNotifications, ackNotification, runDailyReminders, getMyNotificationPrefs, runRewardChecks, getSettings } from '../utils/api';
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
    const timer = useRef(null);
    const fast = useRef(false);
    const stop = useCallback(() => {
        clearInterval(timer.current);
        timer.current = null;
    }, []);
    // fastMode: an alert left unanswered rings faster and louder
    const start = useCallback((fastMode = false) => {
        if (timer.current && fast.current === fastMode) return;
        clearInterval(timer.current);
        fast.current = fastMode;
        const ring = () => {
            playTones([[0, 990], [0.2, 660], [0.4, 990]], 0.16, fast.current ? 0.55 : 0.3);
            if (navigator.userActivation?.hasBeenActive) navigator.vibrate?.(fast.current ? [400, 100, 400, 100, 400] : [300, 100, 300]);
        };
        ring();
        timer.current = setInterval(ring, fastMode ? 800 : 1500);
    }, []);
    useEffect(() => stop, [stop]);
    return useMemo(() => ({ start, stop }), [start, stop]);
}


// Until someone taps the page the browser keeps alarms silent: say so, one tap fixes it
function SoundChip() {
    const [ready, setReady] = useState(soundReady);
    useEffect(() => onSoundReady(() => setReady(soundReady())), []);
    if (ready) return null;
    return (
        <button type="button" className="sound-chip" onClick={unlockSound} title="The browser keeps alarm sound off until the screen is tapped once">
            <FiVolumeX /> <span>Tap for alarm sound</span>
        </button>
    );
}

// Bell with recent alerts; alarm-level alerts (payment requested, staff left…) take over the screen
const Notifications = () => {
    const { socket, hasPerm } = useAuth();
    const navigate = useNavigate();
    const [items, setItems] = useState([]);
    const [open, setOpen] = useState(false);
    // Alarm-level alerts waiting for someone: they stack, oldest first
    const [queue, setQueue] = useState([]);
    const [prefs, setPrefs] = useState(null);
    const [escMinutes, setEscMinutes] = useState(5);
    const [here, setHere] = useState(fullScreenAlertsHere);
    const { pathname } = useLocation();
    // No full-screen alert on the kiosk or the kitchen screen, nor for people who cannot accept orders or take money
    // (the chef): they get the bell and a short ring instead
    const calm = pathname.startsWith('/admin/kiosk') || pathname.startsWith('/admin/kitchen') || !hasPerm('orders.create');
    const snoozed = useRef({});
    const tone = useAlarmTone();

    useEffect(() => {
        getSettings().then(r => setEscMinutes(Number(r.data.escalation_minutes) || 5)).catch(() => {});
    }, []);
    useEffect(() => {
        const loadPrefs = () => getMyNotificationPrefs().then(r => setPrefs(r.data)).catch(() => {});
        loadPrefs();
        const t = setInterval(loadPrefs, 5 * 60000);
        return () => clearInterval(t);
    }, []);

    // This person's style for an alert kind: alarm / loud / normal / off. Quiet hours turn
    // everything down to silent except order and payment alarms.
    const styleFor = useCallback((n) => {
        let style = prefs?.styles?.[n.kind] || n.priority || 'normal';
        if (prefs?.quietNow && !['new_order', 'payment_request', 'escalation'].includes(n.kind)) style = style === 'off' ? 'off' : 'normal';
        return style;
    }, [prefs]);

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
        runDailyReminders().catch(() => {}).then(() => runRewardChecks().catch(() => {})).finally(load);
        const t = setInterval(load, 60000);
        return () => clearInterval(t);
    }, [load]);

    useEffect(() => {
        if (!socket) return undefined;
        const onNew = async (row) => {
            const list = await load();
            const n = list.find(x => x.id === row.id);
            if (!n) return;
            const style = styleFor(n);
            if (style === 'alarm' && !n.acknowledgedAt) {
                setQueue(q => (q.some(x => x.id === n.id) ? q : [...q, n]));
                tone.start();
            } else if (style === 'loud') {
                tone.start();
                setTimeout(tone.stop, 3000);
            }
        };
        socket.on('notification', onNew);
        return () => socket.off('notification', onNew);
    }, [socket, load, tone, styleFor]);

    // Snoozed alarms come back if nobody has acknowledged them
    const snooze = (n, minutes) => {
        setQueue(q => q.filter(x => x.id !== n.id));
        snoozed.current[n.id] = setTimeout(async () => {
            const list = await load();
            const again = list.find(x => x.id === n.id);
            if (again && !again.acknowledgedAt) { setQueue(q => (q.some(x => x.id === again.id) ? q : [...q, again])); tone.start(); }
        }, minutes * 60000);
    };
    useEffect(() => () => Object.values(snoozed.current).forEach(clearTimeout), []);

    // While alerts wait, check every 15 s: one handled on another screen leaves this one too
    useEffect(() => {
        if (!queue.length) { tone.stop(); return undefined; }
        const id = setInterval(async () => {
            const list = await load();
            setQueue(q => q.filter(x => { const now = list.find(y => y.id === x.id); return now && !now.acknowledgedAt; }));
        }, 15000);
        return () => clearInterval(id);
    }, [queue.length, load, tone]);

    // The browser tab title flashes while alerts wait, so a laptop on another tab notices
    useEffect(() => {
        if (!queue.length) return undefined;
        const base = document.title;
        let k = 0;
        const id = setInterval(() => { k += 1; document.title = k % 2 ? `(${queue.length}) ${queue[0].title}` : base; }, 1000);
        return () => { clearInterval(id); document.title = base; };
    }, [queue]);

    const done = useCallback(async (n) => {
        setQueue(q => q.filter(x => x.id !== n.id));
        await ackNotification(n.id).catch(() => {});
        // an escalation also closes the alert it was about
        if (n.payload?.from) await ackNotification(n.payload.from).catch(() => {});
        load();
    }, [load]);
    const onEscalated = useCallback((esc) => { tone.start(esc); }, [tone]);
    // Not full screen on this device (or the Kiosk): ring briefly, keep it on the bell
    useEffect(() => {
        if (queue.length && (!here || calm)) { const id = setTimeout(() => tone.stop(), 3000); return () => clearTimeout(id); }
        return undefined;
    }, [queue.length, here, calm, tone]);

    const unread = items.filter(n => styleFor(n) !== 'off' && !n.acknowledgedAt && Date.now() - new Date(n.createdAt).getTime() < 864e5).length;

    const openItem = async (n) => {
        setOpen(false);
        if (!n.acknowledgedAt) await ackNotification(n.id).catch(() => {});
        load();
        if (n.link) navigate(n.link);
    };
    return (
        <div className="bell">
            <SoundChip />
            <button className="bell-btn" data-tour="bell" aria-label={`Alerts${unread ? ` (${unread} new)` : ''}`} onClick={() => setOpen(o => !o)}>
                <FiBell />{unread > 0 && <span className="bell-count">{unread}</span>}
            </button>
            {open && (
                <div className="bell-list">
                    {items.length === 0 && <p className="bell-item">No alerts yet.</p>}
                    <label className="bell-here">
                        <input type="checkbox" checked={here} onChange={e => { setFullScreenAlertsHere(e.target.checked); setHere(e.target.checked); }} />
                        Full-screen order alerts on this screen
                    </label>
                    {items.map(n => (
                        <button key={n.id} className={`bell-item${n.acknowledgedAt ? '' : ' unread'}`} onClick={() => openItem(n)}>
                            <strong>{n.title}</strong>
                            {n.body && <span>{n.body}</span>}
                            <small> · {ago(n.createdAt)}{n.acknowledgedBy ? ` · seen by ${n.acknowledgedBy}` : ''}</small>
                        </button>
                    ))}
                </div>
            )}
            {/* Drawn on <body> so it covers the whole screen, side menu included, even in full screen */}
            {queue.length > 0 && here && !calm && (
                <OrderAlert queue={queue} items={items} escMinutes={escMinutes} onDone={done} onSnooze={snooze}
                    onOpen={(n, link) => link && navigate(link)} onEscalated={onEscalated} />
            )}
        </div>
    );
};

export default Notifications;
