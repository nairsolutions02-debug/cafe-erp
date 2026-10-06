import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { FiZap, FiBell, FiWifi, FiArrowDown, FiShare, FiPlusSquare, FiMoreHorizontal, FiArrowUp } from 'react-icons/fi';
import { useBrand } from '../../context/BrandContext';
import useCxLang, { T } from '../../lib/cxLang';
import { AppIcon } from '../QuickLoginForm';
import './Journey.css';

// "Put <cafe> on your home screen", shown after the customer's first order.
//   Android / Chrome / Edge: one button (the browser's own install prompt)
//   iPhone / iPad Safari: a 2-tap guide (Share → Add to Home Screen) with an arrow at the Share button
//   any other browser, or already inside the installed app: nothing
// "Not now" hides it for 14 days; it shows at most once per visit.

const ORDERED = 'cx-ordered'; // set once the customer has opened one of their orders (an order was placed)
const SNOOZE = 'cx-install-later'; // time of the last "Not now"
const DONE = 'cx-installed';
const SHOWN = 'cx-install-shown'; // this visit (sessionStorage)
const SNOOZE_MS = 14 * 24 * 60 * 60 * 1000;
const DELAY_MS = 2500; // let the order page appear first

// Chrome fires this early, often before React has drawn anything: keep it from the moment this file loads
let deferred = null;
const listeners = new Set();
if (typeof window !== 'undefined') {
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferred = e;
        listeners.forEach(fn => fn());
    });
    window.addEventListener('appinstalled', () => {
        deferred = null;
        try { localStorage.setItem(DONE, '1'); } catch { /* storage blocked */ }
        listeners.forEach(fn => fn());
    });
}

const get = (store, k) => { try { return store.getItem(k); } catch { return null; } };
const set = (store, k, v) => { try { store.setItem(k, v); } catch { /* storage blocked */ } };

const standalone = () => {
    try {
        return window.matchMedia?.('(display-mode: standalone)').matches || window.matchMedia?.('(display-mode: fullscreen)').matches
            || window.navigator.standalone === true || !!globalThis.Capacitor?.isNativePlatform?.();
    } catch { return false; }
};

// iPhone / iPad Safari (in-app browsers like Instagram or WhatsApp, and Chrome on iPhone, can't add to the home screen)
const iosSafari = () => {
    const ua = navigator.userAgent || '';
    const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    if (!ios || !/Safari\//.test(ua) || /CriOS|FxiOS|EdgiOS|OPiOS|GSA\/|Instagram|FBAN|FBAV|Line\/|WhatsApp|Snapchat/i.test(ua)) return null;
    const ipad = /iPad/.test(ua) || /Macintosh/.test(ua);
    // Safari 26 on iPhone keeps Share behind the ••• button at the bottom right
    const v = Number((ua.match(/Version\/(\d+)/) || [])[1] || 0);
    return { ipad, dots: !ipad && v >= 26 };
};

const W = {
    title: T('Put {name} on your home screen', '{name} को होम स्क्रीन पर रखें', '{name} ko home screen pe rakho'),
    sub: T('Opens like an app, you stay signed in, and you get a buzz when your order is ready.',
        'ऐप की तरह खुलता है, आप साइन इन रहते हैं, और ऑर्डर तैयार होते ही फ़ोन पर अलर्ट आता है।',
        'App ki tarah khulta hai, aap signed in rehte ho, aur order ready hote hi phone pe alert aata hai.'),
    p1: T('Opens in 1 tap', '1 टैप में खुले', '1 tap mein khule'),
    p2: T('Ready alerts', 'तैयार होने पर अलर्ट', 'Ready alerts'),
    p3: T('Works on slow net', 'धीमे नेट पर भी चले', 'Slow net pe bhi chale'),
    add: T('Add to home screen', 'होम स्क्रीन पर जोड़ें', 'Home screen pe add karo'),
    later: T('Not now', 'अभी नहीं', 'Abhi nahi'),
    iosTitle: T('Add {name} to your {device}', '{name} को अपने {device} में जोड़ें', '{name} ko apne {device} mein add karo'),
    iosSub: T('Apple needs two taps from you. It takes 5 seconds.', 'Apple को आपसे दो टैप चाहिए। बस 5 सेकंड लगेंगे।', 'Apple ko aapse do tap chahiye. Bas 5 second lagenge.'),
    step1: T('Tap {share} in the bar below', 'नीचे की पट्टी में {share} दबाएँ', 'Neeche bar mein {share} dabao'),
    step1Top: T('Tap {share} at the top of the screen', 'स्क्रीन में ऊपर {share} दबाएँ', 'Screen mein upar {share} dabao'),
    step1Dots: T('Tap {dots} in the bar below, then {share}', 'नीचे की पट्टी में {dots} दबाएँ, फिर {share}', 'Neeche bar mein {dots} dabao, phir {share}'),
    step2: T('Choose {add}', '{add} चुनें', '{add} chuno'),
    share: T('Share', 'शेयर', 'Share'),
    addHome: T('Add to Home Screen', 'Add to Home Screen', 'Add to Home Screen'),
    tapHere: T('Tap here', 'यहाँ दबाएँ', 'Yahan tap karo'),
};

// "Tap {share} in the bar below" with the {share} part drawn as a key
const withKeys = (text, keys) => text.split(/(\{\w+\})/).map((part, i) => {
    const k = part.match(/^\{(\w+)\}$/)?.[1];
    return k && keys[k] ? <span key={i} className="cxj-key">{keys[k]}</span> : <React.Fragment key={i}>{part}</React.Fragment>;
});

const InstallPrompt = () => {
    const brand = useBrand();
    const { t } = useCxLang();
    const { pathname } = useLocation();
    const [, bump] = useState(0);
    const [open, setOpen] = useState(false);

    useEffect(() => {
        const fn = () => bump(n => n + 1);
        listeners.add(fn);
        return () => listeners.delete(fn);
    }, []);

    // The order page means an order was placed: from then on the app may be offered
    const onOrderPage = /^\/order\/[^/]+/.test(pathname);
    useEffect(() => { if (onOrderPage) set(localStorage, ORDERED, '1'); }, [onOrderPage]);

    const ios = typeof navigator !== 'undefined' ? iosSafari() : null;
    const canOffer = !!(deferred || ios);

    useEffect(() => {
        if (open || !canOffer || standalone()) return undefined;
        if (!onOrderPage && !get(localStorage, ORDERED)) return undefined;
        if (get(localStorage, DONE) || get(sessionStorage, SHOWN)) return undefined;
        if (Date.now() - Number(get(localStorage, SNOOZE) || 0) < SNOOZE_MS) return undefined;
        const timer = setTimeout(() => { set(sessionStorage, SHOWN, '1'); setOpen(true); }, DELAY_MS);
        return () => clearTimeout(timer);
    }, [pathname, canOffer, open, onOrderPage]);

    const later = () => { set(localStorage, SNOOZE, String(Date.now())); setOpen(false); };
    const install = async () => {
        const e = deferred;
        if (!e) { setOpen(false); return; }
        try {
            await e.prompt();
            const choice = await e.userChoice;
            if (choice?.outcome === 'accepted') set(localStorage, DONE, '1');
            else set(localStorage, SNOOZE, String(Date.now()));
        } catch { /* the browser said no */ }
        deferred = null;
        setOpen(false);
    };

    useEffect(() => {
        if (!open) return undefined;
        const esc = (e) => { if (e.key === 'Escape') later(); };
        document.addEventListener('keydown', esc);
        return () => document.removeEventListener('keydown', esc);
    }, [open]);

    if (!open) return null;

    const name = brand.name;

    if (deferred && !ios) {
        return (
            <div className="cxj-sheet-wrap" role="dialog" aria-modal="true" aria-labelledby="cxj-inst-title">
                <div className="cxj-dim" onClick={later} />
                <div className="cxj-sheet">
                    <div className="cxj-grab" />
                    <AppIcon brand={brand} size={72} />
                    <h2 id="cxj-inst-title" className="cxj-h">{t(W.title, { name })}</h2>
                    <p className="cxj-mu cxj-sheet-sub">{t(W.sub)}</p>
                    <div className="cxj-perks">
                        <div className="cx-glass"><FiZap aria-hidden="true" />{t(W.p1)}</div>
                        <div className="cx-glass"><FiBell aria-hidden="true" />{t(W.p2)}</div>
                        <div className="cx-glass"><FiWifi aria-hidden="true" />{t(W.p3)}</div>
                    </div>
                    <button type="button" className="cxj-btn" onClick={install}><FiArrowDown aria-hidden="true" /> {t(W.add)}</button>
                    <button type="button" className="cxj-later" onClick={later}>{t(W.later)}</button>
                </div>
            </div>
        );
    }

    // iPhone / iPad: Apple allows no install button, so show where to tap
    const share = <><FiShare aria-hidden="true" /> {t(W.share)}</>;
    const step1 = ios.ipad ? W.step1Top : ios.dots ? W.step1Dots : W.step1;
    return (
        <div className={`cxj-sheet-wrap ios ${ios.ipad ? 'ipad' : ''} ${ios.dots ? 'dots' : ''}`} role="dialog" aria-modal="true" aria-labelledby="cxj-inst-title">
            <div className="cxj-dim" onClick={later} />
            <div className="cxj-sheet">
                <div className="cxj-grab" />
                <h2 id="cxj-inst-title" className="cxj-h">{t(W.iosTitle, { name, device: ios.ipad ? 'iPad' : 'iPhone' })}</h2>
                <p className="cxj-mu cxj-sheet-sub">{t(W.iosSub)}</p>
                <div className="cxj-steps">
                    <div className="cxj-step cx-glass"><span className="cxj-n">1</span>
                        <span>{withKeys(t(step1), { share, dots: <FiMoreHorizontal aria-label="•••" /> })}</span></div>
                    <div className="cxj-step cx-glass"><span className="cxj-n">2</span>
                        <span>{withKeys(t(W.step2), { add: <><FiPlusSquare aria-hidden="true" /> {t(W.addHome)}</> })}</span></div>
                </div>
                <button type="button" className="cxj-later" onClick={later}>{t(W.later)}</button>
            </div>
            <div className="cxj-point" aria-hidden="true">
                {ios.ipad ? <FiArrowUp /> : null}{t(W.tapHere)}{ios.ipad ? null : <FiArrowDown />}
            </div>
        </div>
    );
};

export default InstallPrompt;
