// Turns the cafe's brand choices (Settings → Brand & look) into the app's look: colour variables,
// the body font and the corner style. Status colours (late, cooking, ready, paid) are never changed.

export const DEFAULT_THEME = { main: '#C87316', accent: '#A8A06D', corners: 'soft', font: 'Poppins', cxMode: 'auto' };

export const PRESETS = [
    { key: 'fika', name: 'FiKA orange', main: '#C87316', accent: '#A8A06D' },
    { key: 'teal', name: 'Teal', main: '#0F766E', accent: '#F59E0B' },
    { key: 'coffee', name: 'Coffee', main: '#6F4E37', accent: '#D4A373' },
    { key: 'green', name: 'Green', main: '#15803D', accent: '#A3E635' },
    { key: 'berry', name: 'Berry', main: '#9D174D', accent: '#F9A8D4' },
    { key: 'navy', name: 'Navy', main: '#1E3A8A', accent: '#60A5FA' },
];

// All four read Hindi (Devanagari) well
export const FONTS = ['Poppins', 'Mukta', 'Baloo 2', 'Hind'];
export const CORNERS = [['round', 'Round'], ['soft', 'Soft'], ['square', 'Square']];
// How the customer app opens: by the customer's phone setting, always light or always dark
export const CX_MODES = [['auto', "Customer's phone setting"], ['light', 'Always light'], ['dark', 'Always dark']];

const HEX = /^#[0-9a-f]{6}$/i;
export const isHex = (v) => HEX.test(v || '');

const rgb = (h) => { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
const lum = (h) => rgb(h).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; })
    .reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
export const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

// Prices, links and outline buttons are drawn in the main colour on white, and button text is white
// on the main colour: both need at least 3 : 1 (the same number, contrast is symmetric).
export const MIN_CONTRAST = 3;
export const readable = (main) => isHex(main) && contrast(main, '#ffffff') >= MIN_CONTRAST;
export const deeper = (h) => {
    let [r, g, b] = rgb(h);
    const hex = () => `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
    for (let i = 0; i < 60 && contrast(hex(), '#ffffff') < MIN_CONTRAST + 0.1; i++) { r = Math.round(r * 0.94); g = Math.round(g * 0.94); b = Math.round(b * 0.94); }
    return hex();
};

export const normaliseTheme = (t = {}) => ({
    main: isHex(t.main) && readable(t.main) ? t.main.toUpperCase() : DEFAULT_THEME.main,
    accent: isHex(t.accent) ? t.accent.toUpperCase() : DEFAULT_THEME.accent,
    corners: CORNERS.some(([k]) => k === t.corners) ? t.corners : DEFAULT_THEME.corners,
    font: FONTS.includes(t.font) ? t.font : DEFAULT_THEME.font,
    cxMode: CX_MODES.some(([k]) => k === t.cxMode) ? t.cxMode : DEFAULT_THEME.cxMode,
});

// The CSS variables for a theme (also used on the Brand & look preview before saving)
export const themeVars = (t) => ({
    '--primary': t.main,
    '--bg-primary': t.main,
    '--primary-dark': `color-mix(in srgb, ${t.main} 80%, black)`,
    '--primary-light': `color-mix(in srgb, ${t.main} 80%, white)`,
    '--accent': t.accent,
    '--accent-dark': `color-mix(in srgb, ${t.accent} 80%, black)`,
    '--accent-light': `color-mix(in srgb, ${t.accent} 75%, white)`,
    '--font-body': `'${t.font}'`,
});

const loaded = new Set(['Poppins']);
export const loadFont = (font) => {
    if (loaded.has(font) || !FONTS.includes(font) || typeof document === 'undefined') return;
    loaded.add(font);
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(font).replace(/%20/g, '+')}:wght@400;500;600;700;800&display=swap`;
    document.head.appendChild(link);
};

export const applyTheme = (t) => {
    const theme = normaliseTheme(t);
    const root = document.documentElement;
    for (const [k, v] of Object.entries(themeVars(theme))) root.style.setProperty(k, v);
    root.dataset.corners = theme.corners;
    loadFont(theme.font);
    return theme;
};
