import React, { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { getTourDone, markTourDone } from '../../utils/api';
import useMenuLang from '../mobile/useMenuLang';
import useIsPhone from '../mobile/useIsPhone';
import { TOURS, TOUR_WORDS as W, tourFor } from './tours';
import './Tour.css';

const pick = (t, lang) => t[lang === 'hinglish' ? 'hg' : lang] || t.en;
const doneKey = (id) => `tour-done:${id}`;
const read = (store, k) => { try { return store.getItem(k); } catch { return null; } };
const write = (store, k, v) => { try { store.setItem(k, v); } catch { /* private mode */ } };
const NEVER_ON = ['/admin/kiosk'];

const visible = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };

// Guided tour: offered once per person (a small card that never blocks work), and from Help → Take the tour
const Tour = () => {
    const { user, hasPerm } = useAuth();
    const { lang } = useMenuLang();
    const phone = useIsPhone();
    const { pathname } = useLocation();
    const [mode, setMode] = useState(null); // null | 'offer' | 'tour'
    const [i, setI] = useState(0);
    const [box, setBox] = useState(null);
    const who = user?._id;
    const steps = TOURS[tourFor(hasPerm)];
    const blocked = NEVER_ON.some(p => pathname.startsWith(p));

    // Offer it once: remembered for the person (server), cached on this device
    useEffect(() => {
        if (!who || blocked || read(localStorage, doneKey(who)) || read(sessionStorage, 'tour-later')) return undefined;
        let live = true;
        getTourDone().then(r => {
            if (!live) return;
            if (r.data) write(localStorage, doneKey(who), '1');
            else setMode(m => m || 'offer');
        }).catch(() => {});
        return () => { live = false; };
    }, [who, blocked]);
    useEffect(() => {
        const go = () => { setI(0); setMode('tour'); };
        window.addEventListener('start-tour', go);
        return () => window.removeEventListener('start-tour', go);
    }, []);

    const finish = useCallback(() => {
        setMode(null);
        if (who) write(localStorage, doneKey(who), '1');
        markTourDone().catch(() => {});
    }, [who]);
    const later = () => { write(sessionStorage, 'tour-later', '1'); setMode(null); };

    const step = mode === 'tour' ? steps[i] : null;
    const measure = useCallback(() => {
        if (!step) return setBox(null);
        const sel = phone ? (step.atPhone || step.at) : step.at;
        const el = sel ? [...document.querySelectorAll(`[data-tour="${sel}"]`)].find(visible) : null;
        if (!el) return setBox(null);
        el.scrollIntoView?.({ block: 'nearest' });
        const r = el.getBoundingClientRect();
        return setBox({ left: r.left, top: r.top, width: r.width, height: r.height });
    }, [step, phone]);
    // Measure after paint (the target may have just appeared, e.g. after scrolling into view)
    useLayoutEffect(() => {
        const id = requestAnimationFrame(measure);
        return () => cancelAnimationFrame(id);
    }, [measure]);
    useEffect(() => {
        if (mode !== 'tour') return undefined;
        const onKey = (e) => {
            if (e.key === 'Escape') finish();
            if (e.key === 'ArrowRight') setI(n => Math.min(n + 1, steps.length - 1));
            if (e.key === 'ArrowLeft') setI(n => Math.max(n - 1, 0));
        };
        window.addEventListener('resize', measure);
        window.addEventListener('keydown', onKey);
        return () => { window.removeEventListener('resize', measure); window.removeEventListener('keydown', onKey); };
    }, [mode, measure, finish, steps.length]);
    useEffect(() => { document.querySelector('.tour-bubble .tour-next')?.focus(); }, [i, mode]);

    if (!mode || (blocked && mode === 'offer') || !user) return null;

    if (mode === 'offer') {
        return createPortal(
            <div className="tour-offer" role="dialog" aria-label={pick(W.welcome, lang)}>
                <span className="tour-wave" aria-hidden="true">👋</span>
                <div>
                    <b>{pick(W.welcome, lang)}</b>
                    <p>{pick(W.welcomeSub, lang)}</p>
                    <div className="tour-row">
                        <button type="button" className="btn btn-primary btn-sm" onClick={() => { setI(0); setMode('tour'); }}>{pick(W.start, lang)}</button>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={later}>{pick(W.later, lang)}</button>
                        <button type="button" className="tour-link" onClick={finish}>{pick(W.never, lang)}</button>
                    </div>
                </div>
            </div>,
            document.body,
        );
    }

    const last = i === steps.length - 1;
    // Bubble below the target, or above it when there is no room; in the middle when there is no target
    const bw = phone ? window.innerWidth - 24 : 320;
    let style;
    if (box) {
        const below = box.top + box.height + 12;
        const left = phone ? 12 : Math.min(Math.max(12, box.left), window.innerWidth - bw - 12);
        style = below + 220 < window.innerHeight ? { left, top: below, width: bw } : { left, bottom: window.innerHeight - box.top + 12, width: bw };
    }
    return createPortal(
        <div className="tour-layer">
            {box
                ? <div className="tour-spot" style={{ left: box.left - 5, top: box.top - 5, width: box.width + 10, height: box.height + 10 }} />
                : <div className="tour-dim" />}
            <div className={`tour-bubble${box ? '' : ' center'}`} style={style} role="dialog" aria-modal="true" aria-label={pick(step.t, lang)}>
                <span className="tour-step">{pick(W.step, lang)} {i + 1} {pick(W.of, lang)} {steps.length}</span>
                <b>{pick(step.t, lang)}</b>
                <p>{pick(step.d, lang)}</p>
                <div className="tour-nav">
                    <span className="tour-dots" aria-hidden="true">{steps.map((_, k) => <i key={k} className={k === i ? 'on' : ''} />)}</span>
                    {i > 0 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setI(i - 1)}>{pick(W.back, lang)}</button>}
                    <button type="button" className="btn btn-primary btn-sm tour-next" onClick={() => (last ? finish() : setI(i + 1))}>{pick(last ? W.done : W.next, lang)}</button>
                </div>
                {!last && <button type="button" className="tour-link" onClick={finish}>{pick(W.skip, lang)}</button>}
            </div>
        </div>,
        document.body,
    );
};

export default Tour;
