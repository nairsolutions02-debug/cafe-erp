// The cafe's name, logo and contact details. The owner sets them in Settings → Brand & look (stored in
// the settings table); the VITE_CAFE_* values from Vercel are the fallback for anything left empty.
import defaults from '../brand';
import { getSettings } from '../utils/api';

export const BRAND_KEYS = {
    name: 'restaurant_name', address: 'restaurant_address', phone: 'restaurant_phone',
    tagline: 'brand_tagline', heroText: 'brand_hero', logo: 'brand_logo', email: 'brand_email',
    instagram: 'brand_instagram', facebook: 'brand_facebook', hoursDays: 'brand_hours_days', hoursTime: 'brand_hours_time',
};
// Colours, corners and font (part 2). brand_main falls back to the older customer-app colour (portal_theme).
export const THEME_KEYS = { main: 'brand_main', accent: 'brand_accent', corners: 'brand_corners', font: 'brand_font' };
const ALL_KEYS = [...Object.values(BRAND_KEYS), ...Object.values(THEME_KEYS), 'portal_theme'];
const CACHE = 'brand-cache-v2';
export const BRAND_EVENT = 'brandchanged';

const text = (v) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());

export const mergeBrand = (settings) => {
    const out = { ...defaults };
    for (const [field, key] of Object.entries(BRAND_KEYS)) {
        const v = text(settings?.[key]);
        if (v) out[field] = v;
    }
    out.logoIsCustom = !!text(settings?.[BRAND_KEYS.logo]);
    out.theme = Object.fromEntries(Object.entries(THEME_KEYS).map(([field, key]) => [field, text(settings?.[key])]));
    if (!out.theme.main) out.theme.main = text(settings?.portal_theme);
    return out;
};

export const readBrandCache = () => {
    try { return JSON.parse(localStorage.getItem(CACHE)) || null; } catch { return null; }
};

// The brand settings of this cafe, or null when they can't be read (offline, no cafe yet)
export const fetchBrandSettings = async () => {
    try {
        const s = (await getSettings()).data;
        const picked = Object.fromEntries(ALL_KEYS.map(k => [k, s[k] ?? '']));
        try { localStorage.setItem(CACHE, JSON.stringify(picked)); } catch { /* private mode */ }
        return picked;
    } catch {
        return null;
    }
};

// Tell every open screen to reload the brand (after saving on the Brand & look page)
export const brandChanged = () => window.dispatchEvent(new Event(BRAND_EVENT));
