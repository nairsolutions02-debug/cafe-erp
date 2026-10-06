import { useEffect, useState } from 'react';

// Customer app language: English, Hindi or Hinglish. The customer picks it on the welcome card or with the 🌐 button
// in the header; this phone remembers it. A first visit follows the phone language (Hindi phone → Hindi).
// Printed and PDF bills stay in English (GST bills); only the app screens change.
export const CX_LANGS = [['en', 'English', 'En'], ['hi', 'हिन्दी', 'हि'], ['hg', 'Hinglish', 'Hg']];
const KEY = 'cx-lang';

// T('Cart', 'कार्ट', 'Cart') → { en, hi, hg }
export const T = (en, hi, hg) => ({ en, hi, hg });

const fromPhone = () => {
    try {
        const list = navigator.languages?.length ? navigator.languages : [navigator.language];
        return list.some(l => /^hi\b/i.test(l || '')) ? 'hi' : 'en';
    } catch { return 'en'; }
};

export const readCxLang = () => {
    try {
        const v = localStorage.getItem(KEY);
        if (v === 'en' || v === 'hi' || v === 'hg') return v;
    } catch { /* storage blocked: follow the phone */ }
    return fromPhone();
};

export const setCxLang = (lang) => {
    try { localStorage.setItem(KEY, lang); } catch { /* storage blocked: this visit only */ }
    document.documentElement.lang = lang === 'hi' ? 'hi' : 'en';
    window.dispatchEvent(new Event('cxlang'));
};

// Fill {name} placeholders: fill('Hi {name}', { name: 'Priya' })
export const fill = (text, vars = {}) => String(text ?? '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m));

// const { lang, t, setLang } = useCxLang();  t(T('Cart', 'कार्ट', 'Cart'))  or  t(WORDS.cart, { n: 2 })
export default function useCxLang() {
    const [lang, setLangState] = useState(readCxLang);
    useEffect(() => {
        const sync = () => setLangState(readCxLang());
        window.addEventListener('cxlang', sync);
        window.addEventListener('storage', sync);
        return () => { window.removeEventListener('cxlang', sync); window.removeEventListener('storage', sync); };
    }, []);
    const t = (w, vars) => {
        const s = w && typeof w === 'object' ? (w[lang] ?? w.en) : w;
        return vars ? fill(s, vars) : s;
    };
    return { lang, t, setLang: setCxLang };
}

// Reward labels the server writes in English ("20 points", "₹30 off coupon", "10% off"): said in the customer's language.
// Anything else (a free dish the owner named) is shown as written.
export const sayReward = (text, lang) => {
    const s = String(text ?? '');
    if (lang === 'en' || !s) return s;
    const hi = lang === 'hi';
    // "₹150 off coupon + 100 points": each part on its own
    if (s.includes(' + ')) return s.split(' + ').map(part => sayReward(part, lang)).join(' + ');
    return s
        .replace(/^(\d+) points?$/i, hi ? '$1 पॉइंट' : '$1 points')
        .replace(/^₹([\d,]+) off coupon$/i, hi ? '₹$1 छूट का कूपन' : '₹$1 off ka coupon')
        .replace(/^₹([\d,]+) off$/i, hi ? '₹$1 की छूट' : '₹$1 off')
        .replace(/^(\d+)% off$/i, hi ? '$1% छूट' : '$1% off');
};
