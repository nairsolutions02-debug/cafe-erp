import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from './AuthContext';
import { mergeBrand, readBrandCache, fetchBrandSettings, BRAND_EVENT } from '../lib/brandStore';
import { applyTheme } from '../lib/theme';

const BrandContext = createContext(mergeBrand(readBrandCache()));

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
    return <BrandContext.Provider value={brand}>{children}</BrandContext.Provider>;
};

// eslint-disable-next-line react-refresh/only-export-components
export const useBrand = () => useContext(BrandContext);
