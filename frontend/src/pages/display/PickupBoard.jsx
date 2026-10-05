import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { FiMaximize, FiVolume2, FiVolumeX, FiWifiOff } from 'react-icons/fi';
import { getPickupBoard } from '../../utils/api';
import { useBrand } from '../../context/BrandContext';
import './PickupBoard.css';

// Collect-your-order screen for a big TV in the cafe (/display/<screen key>).
// Readable from 5–10 m: giant numbers, two columns (Preparing · Ready), a spotlight when an order becomes ready.
const POLL_MS = 3000;
const SPOTLIGHT_MS = 5000;
const PAGE_MS = 7000;

// Two-tone "ding" made in the browser (no sound file to load)
const chime = (ctx) => {
    if (!ctx) return;
    const now = ctx.currentTime;
    [[880, 0], [1318.5, 0.18]].forEach(([f, t]) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'sine';
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, now + t);
        g.gain.exponentialRampToValueAtTime(0.35, now + t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, now + t + 0.9);
        o.connect(g).connect(ctx.destination);
        o.start(now + t);
        o.stop(now + t + 1);
    });
};

const minsAgo = (iso, offset) => Math.max(0, Math.floor((Date.now() + offset - new Date(iso).getTime()) / 60000));
const pageOf = (list, size, page) => {
    const pages = Math.max(1, Math.ceil(list.length / size));
    const p = page % pages;
    return { items: list.slice(p * size, p * size + size), pages, page: p };
};
// Ready tiles: fewer orders → bigger tiles
const readyLayout = (n) => (n <= 1 ? { cols: 1, size: 1 } : n <= 2 ? { cols: 2, size: 2 } : n <= 4 ? { cols: 2, size: 4 }
    : n <= 6 ? { cols: 3, size: 6 } : { cols: 3, size: 9 });
const prepLayout = (n) => (n <= 6 ? { cols: 2, size: 6, tier: 'l' } : n <= 12 ? { cols: 3, size: 12, tier: 'm' } : { cols: 4, size: 20, tier: 's' });

const Clock = ({ offset }) => {
    const [t, setT] = useState(() => new Date(Date.now() + offset));
    useEffect(() => {
        const i = setInterval(() => setT(new Date(Date.now() + offset)), 1000);
        return () => clearInterval(i);
    }, [offset]);
    return <span className="pb-clock">{t.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>;
};

const PickupBoard = () => {
    const brand = useBrand();
    const { key } = useParams();
    const preview = useSearchParams()[0].get('preview') === '1';
    const [data, setData] = useState(null);
    const [bad, setBad] = useState(false);
    const [offline, setOffline] = useState(false);
    const [offset, setOffset] = useState(0);
    const [fresh, setFresh] = useState({}); // id -> time it appeared (for entry animations)
    const [queue, setQueue] = useState([]); // orders waiting for the spotlight
    const [spot, setSpot] = useState(null);
    const [page, setPage] = useState(0);
    const [sound, setSound] = useState(false);
    const [idle, setIdle] = useState(false);
    const seen = useRef({ prep: null, ready: null });
    const audio = useRef(null);
    const idleTimer = useRef();

    const load = useCallback(async () => {
        try {
            const r = (await getPickupBoard(key, preview)).data;
            if (!r?.ok) { setBad(true); return; }
            setBad(false);
            setOffline(false);
            setOffset(new Date(r.now).getTime() - Date.now());
            const prepIds = new Set(r.preparing.map(o => o.id));
            const readyIds = new Set(r.ready.map(o => o.id));
            const first = seen.current.ready === null;
            const now = Date.now();
            const appeared = {};
            if (!first) {
                r.preparing.forEach(o => { if (!seen.current.prep.has(o.id)) appeared[o.id] = now; });
                const newlyReady = r.ready.filter(o => !seen.current.ready.has(o.id));
                newlyReady.forEach(o => { appeared[o.id] = now; });
                if (newlyReady.length) setQueue(q => [...q, ...newlyReady.slice().reverse()]);
            }
            seen.current = { prep: prepIds, ready: readyIds };
            if (Object.keys(appeared).length) setFresh(f => ({ ...f, ...appeared }));
            setData(r);
            if (/^#[0-9a-f]{6}$/i.test(r.theme || '')) document.documentElement.style.setProperty('--pb-accent', r.theme);
        } catch {
            setOffline(true);
        }
    }, [key, preview]);

    useEffect(() => {
        load(); // eslint-disable-line react-hooks/set-state-in-effect
        const i = setInterval(load, POLL_MS);
        return () => clearInterval(i);
    }, [load]);

    // Spotlight: one newly ready order at a time, with a chime
    useEffect(() => {
        if (spot || !queue.length) return;
        const [next, ...rest] = queue;
        setSpot(next); // eslint-disable-line react-hooks/set-state-in-effect
        setQueue(rest);
        if (sound) chime(audio.current);
    }, [queue, spot, sound]);
    useEffect(() => {
        if (!spot) return undefined;
        const t = setTimeout(() => setSpot(null), SPOTLIGHT_MS);
        return () => clearTimeout(t);
    }, [spot]);

    // Entry glow lasts 30 s
    useEffect(() => {
        const i = setInterval(() => setFresh(f => Object.fromEntries(Object.entries(f).filter(([, t]) => Date.now() - t < 30000))), 5000);
        return () => clearInterval(i);
    }, []);

    // Many orders: turn the page every few seconds
    useEffect(() => {
        const i = setInterval(() => setPage(p => p + 1), PAGE_MS);
        return () => clearInterval(i);
    }, []);

    // Keep the TV awake; hide the pointer and controls when nobody touches it
    useEffect(() => {
        let lock = null;
        const ask = async () => { try { lock = await navigator.wakeLock?.request('screen'); } catch { /* not supported */ } };
        ask();
        const vis = () => document.visibilityState === 'visible' && ask();
        document.addEventListener('visibilitychange', vis);
        const wake = () => {
            setIdle(false);
            clearTimeout(idleTimer.current);
            idleTimer.current = setTimeout(() => setIdle(true), 3000);
        };
        wake();
        window.addEventListener('pointermove', wake);
        window.addEventListener('pointerdown', wake);
        return () => {
            document.removeEventListener('visibilitychange', vis);
            window.removeEventListener('pointermove', wake);
            window.removeEventListener('pointerdown', wake);
            clearTimeout(idleTimer.current);
            lock?.release?.().catch(() => {});
        };
    }, []);

    const enableSound = () => {
        try {
            audio.current = audio.current || new (window.AudioContext || window.webkitAudioContext)();
            audio.current.resume();
            chime(audio.current);
            setSound(true);
        } catch { /* no audio */ }
    };
    const fullscreen = () => document.documentElement.requestFullscreen?.().catch(() => {});

    const ready = useMemo(() => data?.ready || [], [data]);
    const prep = useMemo(() => data?.preparing || [], [data]);
    const rl = readyLayout(ready.length);
    const pl = prepLayout(prep.length);
    const rp = pageOf(ready, rl.size, page);
    const pp = pageOf(prep, pl.size, page);
    const ticker = data?.announcement?.on && data.announcement.text?.trim() ? data.announcement.text : '';

    if (bad) {
        return (
            <div className="pb pb-bad">
                <img src={brand.logo} alt="" className="pb-bad-logo" />
                <h1>This screen link isn't active</h1>
                <p>Open Admin → Sell → Pickup screen and make a new link for this TV.</p>
            </div>
        );
    }

    return (
        <div className={`pb ${idle || preview ? 'idle' : ''} ${preview ? 'preview' : ''}`}>
            <div className="pb-bg" aria-hidden="true"><i /><i /><i /></div>

            <header className="pb-top">
                <div className="pb-brand">
                    <img src={brand.logo} alt="" />
                    <span>{data?.cafe || brand.name}</span>
                </div>
                <div className="pb-top-msg">{data?.settings?.message || 'Please collect your order from the serving counter'}</div>
                <div className="pb-top-right">
                    {offline && <span className="pb-offline"><FiWifiOff /> Reconnecting…</span>}
                    <span className="pb-live" aria-hidden="true" />
                    <Clock offset={offset} />
                </div>
            </header>

            <main className="pb-main">
                <section className="pb-col pb-prep" aria-label="Preparing">
                    <h2><span className="pb-steam" aria-hidden="true"><i /><i /><i /></span>Preparing <b>{prep.length || ''}</b></h2>
                    {prep.length === 0 ? (
                        <div className="pb-empty"><span>☕</span>All caught up</div>
                    ) : (
                        <div className={`pb-prep-grid tier-${pl.tier}`} style={{ '--cols': pl.cols }} key={`p${pp.page}`}>
                            {pp.items.map(o => (
                                <div key={o.id} className={`pb-chip ${o.started ? 'started' : 'queued'} ${fresh[o.id] ? 'fresh' : ''}`}>
                                    <span className="pb-chip-num">{o.label}</span>
                                    <span className="pb-chip-sub">{o.name || (o.table ? `Table ${o.table}` : '')}</span>
                                    {o.started && <span className="pb-chip-bar" aria-hidden="true" />}
                                </div>
                            ))}
                        </div>
                    )}
                    {pp.pages > 1 && <div className="pb-dots">{Array.from({ length: pp.pages }, (_, i) => <i key={i} className={i === pp.page ? 'on' : ''} />)}</div>}
                </section>

                <section className="pb-col pb-ready" aria-label="Ready to collect">
                    <h2><span className="pb-tick" aria-hidden="true">✓</span>Ready to collect <b>{ready.length || ''}</b></h2>
                    {ready.length === 0 ? (
                        <div className="pb-empty big"><span className="pb-empty-bell">🔔</span>Your number appears here when it's ready</div>
                    ) : (
                        <div className={`pb-ready-grid ${rp.items.length === 1 ? "single" : ""}`} style={{ '--cols': rl.cols, '--n': rp.items.length }} key={`r${rp.page}`}>
                            {rp.items.map(o => (
                                <div key={o.id} className={`pb-tile ${fresh[o.id] ? 'fresh' : ''}`}>
                                    <span className="pb-tile-num">{o.label}</span>
                                    {(o.name || o.table) && <span className="pb-tile-name">{o.name || `Table ${o.table}`}</span>}
                                    <span className="pb-tile-time">{minsAgo(o.readyAt, offset) < 1 ? 'Just now' : `${minsAgo(o.readyAt, offset)} min ago`}</span>
                                </div>
                            ))}
                        </div>
                    )}
                    {rp.pages > 1 && <div className="pb-dots">{Array.from({ length: rp.pages }, (_, i) => <i key={i} className={i === rp.page ? 'on' : ''} />)}</div>}
                </section>
            </main>

            <footer className="pb-foot">
                <div className="pb-foot-track">
                    {[0, 1].map(i => (
                        <span key={i} aria-hidden={i === 1}>
                            {ticker && <>{ticker}<b>•</b></>}
                            Order from your phone: scan the QR on your table<b>•</b>
                            Watch for your number, then collect at the counter<b>•</b>
                        </span>
                    ))}
                </div>
            </footer>

            {spot && (
                <div className="pb-spot" role="alert" key={spot.id}>
                    <div className="pb-spot-rings" aria-hidden="true"><i /><i /><i /></div>
                    <div className="pb-spot-card">
                        <span className="pb-spot-kicker">Order ready</span>
                        <span className="pb-spot-num">{spot.label}</span>
                        {spot.name && <span className="pb-spot-name">{spot.name}</span>}
                        <span className="pb-spot-msg">Please collect it from the counter</span>
                    </div>
                </div>
            )}

            <div className="pb-controls">
                {!sound
                    ? <button onClick={enableSound}><FiVolume2 /> Turn on sound</button>
                    : <button onClick={() => setSound(false)}><FiVolumeX /> Mute</button>}
                <button onClick={fullscreen}><FiMaximize /> Full screen</button>
            </div>
            {!sound && !idle && <div className="pb-hint">Tap once to turn on the chime and full screen</div>}
            <div className="pb-tap" onClick={() => { if (!sound) { enableSound(); fullscreen(); } }} hidden={sound} />
        </div>
    );
};

export default PickupBoard;
