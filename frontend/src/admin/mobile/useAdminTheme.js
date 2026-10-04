import { useEffect, useState } from 'react';

// Light / dark for the admin app, chosen per device.
// Step 1 of dark mode: only the Kitchen screen goes dark (its own Auto / Dark / Light switch).
// The other pages join once their colours are converted; until then they stay light.
const DARK_QUERY = '(prefers-color-scheme: dark)';
export const KDS_KEY = 'kds-theme';
const EVENT = 'admintheme';

export const readKdsTheme = () => {
    try { return localStorage.getItem(KDS_KEY) || 'auto'; } catch { return 'auto'; }
};
export const setKdsTheme = (v) => {
    try { localStorage.setItem(KDS_KEY, v); } catch { /* private mode */ }
    window.dispatchEvent(new Event(EVENT));
};
const phoneIsDark = () => typeof window !== 'undefined' && window.matchMedia?.(DARK_QUERY).matches;
const resolve = (pref) => pref === 'dark' || (pref === 'auto' && phoneIsDark());

// True when the page at `pathname` should be drawn dark
export default function useAdminTheme(pathname) {
    const [kds, setKds] = useState(readKdsTheme);
    const [, bump] = useState(0);
    useEffect(() => {
        const sync = () => setKds(readKdsTheme());
        const m = window.matchMedia?.(DARK_QUERY);
        const onScheme = () => bump(n => n + 1);
        window.addEventListener(EVENT, sync);
        m?.addEventListener?.('change', onScheme);
        return () => { window.removeEventListener(EVENT, sync); m?.removeEventListener?.('change', onScheme); };
    }, []);
    if (pathname.startsWith('/admin/kitchen')) return resolve(kds);
    return false;
}
