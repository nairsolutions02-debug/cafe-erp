import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { mergeBrand, readBrandCache, fetchBrandSettings, BRAND_EVENT } from '../lib/brandStore';
import { applyTheme, normaliseTheme } from '../lib/theme';
import { getCustomerScreen } from '../utils/api';
import { DEFAULT_LOOK, normaliseLook, resolveTheme, applyCxTheme, clearCxTheme, readChoice } from '../lib/cxThemes';

const DARK_QUERY = '(prefers-color-scheme: dark)';
// Customer screens only: the staff app, the platform console and the pickup TV have their own looks
const isCustomerPath = (p) => !/^\/(admin|superadmin|display)(\/|$)/.test(p);

const BrandContext = createContext(mergeBrand(readBrandCache()));
// The customer app look: { look (owner settings, normalised), key (theme on screen), dark, hasCombos }
const CxLookContext = createContext({ look: normaliseLook(DEFAULT_LOOK), key: 'latte', dark: false, hasCombos: false });

// The owner's look settings from the last visit, so the first paint is already in the right theme
const SCREEN_CACHE = 'cx-screen';
const readScreenCache = () => {
    try { return JSON.parse(localStorage.getItem(SCREEN_CACHE)) || {}; } catch { return {}; }
};

// Gives every screen the cafe's current name, logo and contact details (see lib/brandStore.js)
export const BrandProvider = ({ children }) => {
    const [settings, setSettings] = useState(readBrandCache);
    const [version, setVersion] = useState(0);
    const { user } = useAuth();
    const tenantId = user?.tenant?.id;

    useEffect(() => {
        const bump = () => setVersion(v => v + 1);
        window.addEventListener(BRAND_EVENT, bump);
        return () => window.removeEventListener(BRAND_EVENT, bump);
    }, []);
    useEffect(() => {
        let live = true;
        fetchBrandSettings().then(s => { if (live && s) setSettings(s); });
        return () => { live = false; };
    }, [tenantId, version]);

    const brand = useMemo(() => mergeBrand(settings), [settings]);
    useEffect(() => {
        document.title = brand.name;
    }, [brand.name]);
    // Colours, font and corners for every screen (customer app, staff app, kiosk, pickup TV)
    const themeKey = JSON.stringify(brand.theme);
    useEffect(() => { applyTheme(JSON.parse(themeKey)); }, [themeKey]);

    // Customer app light / dark (Brand & look → "Customer app opens in")
    const { pathname } = useLocation();
    const [phoneDark, setPhoneDark] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(DARK_QUERY).matches);
    useEffect(() => {
        const m = window.matchMedia?.(DARK_QUERY);
        const on = () => setPhoneDark(!!m.matches);
        m?.addEventListener?.('change', on);
        return () => m?.removeEventListener?.('change', on);
    }, []);
    const cxMode = normaliseTheme(brand.theme).cxMode;
    const onCx = isCustomerPath(pathname);

    // Customer app look (Admin → Customer app → Look & themes, setting cx_look) and the customer's own pick (Me → Look)
    const [screen, setScreen] = useState(readScreenCache);
    const [choiceVer, setChoiceVer] = useState(0);
    useEffect(() => {
        if (!onCx) return undefined;
        let live = true;
        getCustomerScreen().then(r => {
            if (!live || !r?.data) return;
            const s = { look: r.data.look || {}, hasCombos: !!r.data.hasCombos };
            setScreen(s);
            try { localStorage.setItem(SCREEN_CACHE, JSON.stringify(s)); } catch { /* private mode */ }
        }).catch(() => {});
        return () => { live = false; };
    }, [onCx, tenantId, version]);
    useEffect(() => {
        const on = () => setChoiceVer(v => v + 1);
        window.addEventListener('cx-look', on);
        window.addEventListener('storage', on);
        return () => { window.removeEventListener('cx-look', on); window.removeEventListener('storage', on); };
    }, []);
    const cx = useMemo(() => {
        const owner = screen.look && typeof screen.look === 'object' ? screen.look : {};
        const fresh = Object.keys(owner).length === 0;
        const choice = readChoice();
        // No look saved by the owner and nothing picked by the customer yet: the older "Customer app opens in"
        // setting (phone setting / always light / always dark) still decides light or dark
        const mode = choice.mode || (fresh && !choice.theme ? cxMode : undefined);
        const r = resolveTheme(fresh ? DEFAULT_LOOK : owner, { ...choice, mode }, phoneDark);
        return { ...r, dark: !!r.theme.dark, hasCombos: !!screen.hasCombos, choice };
    }, [screen, choiceVer, phoneDark, cxMode]); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => {
        if (onCx) applyCxTheme(cx);
        else clearCxTheme();
    }, [onCx, cx]);
    const cxDark = onCx && cx.dark;
    useEffect(() => { document.documentElement.classList.toggle('cx-dark', cxDark); }, [cxDark]);
    const cxValue = useMemo(() => ({ look: cx.look, key: cx.key, dark: cx.dark, hasCombos: cx.hasCombos, choice: cx.choice }), [cx]);
    return <BrandContext.Provider value={brand}><CxLookContext.Provider value={cxValue}>{children}</CxLookContext.Provider></BrandContext.Provider>;
};

// eslint-disable-next-line react-refresh/only-export-components
export const useBrand = () => useContext(BrandContext);

// eslint-disable-next-line react-refresh/only-export-components
export const useCxLook = () => useContext(CxLookContext);
