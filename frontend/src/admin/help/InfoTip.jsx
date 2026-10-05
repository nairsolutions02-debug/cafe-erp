import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import useMenuLang from '../mobile/useMenuLang';
import useIsPhone from '../mobile/useIsPhone';
import { TIPS } from './tips';
import './InfoTip.css';

const WORDS = {
    who: { en: 'Who can change it', hi: 'कौन बदल सकता है', hinglish: 'Kaun badal sakta hai' },
    ex: { en: 'Example', hi: 'उदाहरण', hinglish: 'Example' },
    more: { en: 'More in the guide →', hi: 'गाइड में और →', hinglish: 'Guide mein aur →' },
    close: { en: 'Got it', hi: 'समझ गया', hinglish: 'Samajh gaya' },
    what: { en: 'What is this?', hi: 'यह क्या है?', hinglish: 'Yeh kya hai?' },
};
const pick = (t, lang) => t[lang === 'hinglish' ? 'hg' : lang] || t.en;

// The small ⓘ next to a setting. Laptop: a card next to it. Phone: a sheet from the bottom.
// Texts live in help/tips.js, next to the guide, so the two never disagree.
const InfoTip = ({ k }) => {
    const tip = TIPS[k];
    const { lang, t } = useMenuLang();
    const phone = useIsPhone();
    const [open, setOpen] = useState(false);
    const [pos, setPos] = useState(null);
    const [tick, bump] = useState(0);
    const btn = useRef(null);
    const card = useRef(null);
    const id = useId();

    useLayoutEffect(() => {
        if (!open || phone || !btn.current || !card.current) return;
        const r = btn.current.getBoundingClientRect();
        const w = card.current.offsetWidth, h = card.current.offsetHeight;
        let left = Math.min(Math.max(8, r.left - 12), window.innerWidth - w - 8);
        let top = r.bottom + 8;
        if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 8);
        setPos(p => (p && Math.abs(p.left - left) < 1 && Math.abs(p.top - top) < 1 ? p : { left, top }));
    }, [open, phone, tick]);
    useEffect(() => {
        if (!open) return undefined;
        const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
        const onDown = (e) => { if (!card.current?.contains(e.target) && !btn.current?.contains(e.target)) setOpen(false); };
        // Follow the field while the page or a pop-up scrolls, instead of closing
        const onScroll = () => bump(n => n + 1);
        document.addEventListener('keydown', onKey);
        document.addEventListener('pointerdown', onDown);
        window.addEventListener('scroll', onScroll, true);
        window.addEventListener('resize', onScroll);
        card.current?.querySelector('.it-close')?.focus();
        return () => {
            document.removeEventListener('keydown', onKey);
            document.removeEventListener('pointerdown', onDown);
            window.removeEventListener('scroll', onScroll, true);
            window.removeEventListener('resize', onScroll);
        };
    }, [open, phone]);
    if (!tip) return null;

    const close = () => { setOpen(false); btn.current?.focus(); };
    return (
        <>
            <button type="button" ref={btn} className="info-tip" aria-label={`${t(WORDS.what)} ${pick(tip.t, lang)}`}
                aria-expanded={open} aria-controls={open ? id : undefined}
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(o => !o); }}>i</button>
            {open && createPortal(
                <>
                    {phone && <div className="it-scrim" onClick={close} />}
                    <div id={id} ref={card} role="dialog" aria-label={pick(tip.t, lang)} className={`it-card${phone ? ' sheet' : ''}`}
                        style={!phone && pos ? { left: pos.left, top: pos.top } : !phone ? { visibility: 'hidden' } : undefined}>
                        <b className="it-title">{pick(tip.t, lang)}</b>
                        <p>{pick(tip.d, lang)}</p>
                        {tip.ex && <p className="it-ex"><b>{t(WORDS.ex)}:</b> {pick(tip.ex, lang)}</p>}
                        {tip.who && <small className="it-who">{t(WORDS.who)}: {pick(tip.who, lang)}</small>}
                        <div className="it-row">
                            {tip.guide ? <Link to={`/admin/help?topic=${tip.guide}`} onClick={() => setOpen(false)}>{t(WORDS.more)}</Link> : <span />}
                            <button type="button" className="it-close" onClick={close}>{t(WORDS.close)}</button>
                        </div>
                    </div>
                </>,
                document.body,
            )}
        </>
    );
};

export default InfoTip;
