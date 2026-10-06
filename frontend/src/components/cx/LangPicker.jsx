import React, { useEffect, useRef, useState } from 'react';
import useCxLang, { CX_LANGS } from '../../lib/cxLang';

// Three chips (welcome card, Profile): English · हिन्दी · Hinglish
export const LangChips = ({ className = '' }) => {
    const { lang, setLang } = useCxLang();
    return (
        <div className={`cx-lang-chips ${className}`} role="group" aria-label="Language / भाषा">
            {CX_LANGS.map(([k, label]) => (
                <button key={k} type="button" aria-pressed={lang === k} className={lang === k ? 'on' : ''} onClick={() => setLang(k)}>{label}</button>
            ))}
        </div>
    );
};

// 🌐 button in the header: shows the current language, opens the three choices
export const LangButton = () => {
    const { lang, setLang } = useCxLang();
    const [open, setOpen] = useState(false);
    const ref = useRef(null);
    useEffect(() => {
        if (!open) return undefined;
        const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
        const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
        document.addEventListener('pointerdown', close);
        document.addEventListener('keydown', esc);
        return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', esc); };
    }, [open]);
    const short = CX_LANGS.find(([k]) => k === lang)?.[2] || 'En';
    return (
        <div className="cx-lang" ref={ref}>
            <button type="button" className="header-icon-btn cx-lang-btn" aria-haspopup="menu" aria-expanded={open}
                aria-label="Language / भाषा" title="Language / भाषा" onClick={() => setOpen(o => !o)}>
                <span aria-hidden="true">{short}</span>
            </button>
            {open && (
                <div className="cx-lang-menu" role="menu">
                    {CX_LANGS.map(([k, label]) => (
                        <button key={k} type="button" role="menuitemradio" aria-checked={lang === k} className={lang === k ? 'on' : ''}
                            onClick={() => { setLang(k); setOpen(false); }}>{label}</button>
                    ))}
                </div>
            )}
        </div>
    );
};
