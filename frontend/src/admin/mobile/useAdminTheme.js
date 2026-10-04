import { useEffect, useState } from 'react';

// Light / dark for the admin app, chosen per device (More, Screen colours: Auto / Dark / Light).
// Auto follows the phone setting. The Kitchen has its own switch, so the kitchen tablet can differ.
// Pages join dark mode once their colours are converted (DARK_READY); the others stay light for now.
const DARK_QUERY = '(prefers-color-scheme: dark)';
export const KDS_KEY = 'kds-theme';
export const APP_KEY = 'admin-theme';
export const DARK_READY = ['/admin/orders', '/admin/pos', '/admin/me', '/admin/more'];
const EVENT = 'admintheme';

export const readKdsTheme = () => {
    try { return localStorage.getItem(KDS_KEY) || 'auto'; } catch { return 'auto'; }
};
export const setKdsTheme = (v) => {
    try { localStorage.setItem(KDS_KEY, v); } catch { /* private mode */ }
    window.dispatchEvent(new Event(EVENT));
};
export const readAppTheme = () => {
    try { return localStorage.getItem(APP_KEY) || 'auto'; } catch { return 'auto'; }
};
export const setAppTheme = (v) => {
    try { localStorage.setItem(APP_KEY, v); } catch { /* private mode */ }
    window.dispatchEvent(new Event(EVENT));
};
const phoneIsDark = () => typeof window !== 'undefined' && window.matchMedia?.(DARK_QUERY).matches;
const resolve = (pref) => pref === 'dark' || (pref === 'auto' && phoneIsDark());

// True when the page at `pathname` should be drawn dark
export default function useAdminTheme(pathname) {
    const [kds, setKds] = useState(readKdsTheme);
    const [app, setApp] = useState(readAppTheme);
    const [, bump] = useState(0);
    useEffect(() => {
        const sync = () => { setKds(readKdsTheme()); setApp(readAppTheme()); };
        const m = window.matchMedia?.(DARK_QUERY);
        const onScheme = () => bump(n => n + 1);
        window.addEventListener(EVENT, sync);
        m?.addEventListener?.('change', onScheme);
        return () => { window.removeEventListener(EVENT, sync); m?.removeEventListener?.('change', onScheme); };
    }, []);
    if (pathname.startsWith('/admin/kitchen')) return resolve(kds);
    if (DARK_READY.some(p => pathname === p || pathname.startsWith(`${p}/`))) return resolve(app);
    return false;
}
