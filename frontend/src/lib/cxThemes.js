// Customer app looks. The owner switches themes on in Admin → Customer app → Look & themes (setting `cx_look`);
// the customer picks one of those in Me → Look (kept on that phone). Every customer screen styles itself with the
// --cx-* variables below, so a theme only has to fill them in.
//
//   --cx-bg / --cx-bg2      page background (may be a gradient) / raised panels (sheets, sticky bars)
//   --cx-bgs                page background as one solid colour (for places a gradient can't go)
//   --cx-sf / --cx-sf2      card surface / soft fill behind pictures
//   --cx-ln / --cx-ln2      hairline border / stronger border
//   --cx-tx / --cx-mu       text / muted text
//   --cx-pr / --cx-pr2 / --cx-pi   main colour (may be a gradient) / main colour as a solid (for text) / text on main
//   --cx-blur               glass blur ("0px" for solid themes)
//   --cx-fh / --cx-fb       heading font / body font
//   --cx-hero / --cx-hero2  big welcome background / soft backdrop behind a dish picture
//   --cx-ban / --cx-ban-tx  default banner background / banner text
//   --cx-combo              combo cards background
//   --cx-r                  card corner radius
// Use the `cx-glass` class for a frosted card: it reads --cx-sf, --cx-ln and --cx-blur.

const T = (en, hi, hg) => ({ en, hi, hg });

export const CX_THEMES = {
    latte: { name: T('Latte Cream', 'लाटे क्रीम', 'Latte Cream'), dark: false, glass: false,
        bg: '#FFF6EC', bg2: '#FFFBF6', sf: '#FFFFFF', sf2: '#FCEFE0', ln: 'rgba(120,80,40,.10)', ln2: '#E6D3BF', tx: '#2B1A10', mu: '#7A6455',
        pr: '#D9700C', pr2: '#B85F0A', pi: '#FFFFFF', fh: 'Outfit', fb: 'Outfit',
        hero: 'linear-gradient(160deg,#3B2416,#1E120B)', hero2: 'radial-gradient(circle at 50% 60%,#FFE3C4,#FFF6EC 70%)',
        ban: 'linear-gradient(120deg,#FFD6A8,#F6A65A)', banTx: '#3B2416', combo: 'linear-gradient(120deg,#E07B1A,#C2410C)' },
    caramel: { name: T('Caramel Sand', 'कैरामल सैंड', 'Caramel Sand'), dark: false, glass: false,
        bg: '#F8EAD4', bg2: '#FFF8EE', sf: '#FFF8EE', sf2: '#F3DDBA', ln: 'rgba(120,80,40,.10)', ln2: '#E2C9A4', tx: '#2A1B0F', mu: '#7D6548',
        pr: '#E9B872', pr2: '#8A5718', pi: '#2A1B0F', fh: 'Outfit', fb: 'Outfit',
        hero: 'linear-gradient(170deg,#F3D7A7,#E4B677)', hero2: 'linear-gradient(#EDC88E,#F3D7A7)',
        ban: 'linear-gradient(120deg,#C9A27C,#8F6744)', banTx: '#FFFFFF', combo: 'linear-gradient(120deg,#9A6420,#5B3A12)' },
    espresso: { name: T('Espresso Glass', 'एस्प्रेसो ग्लास', 'Espresso Glass'), dark: true, glass: true,
        bg: 'radial-gradient(120% 60% at 20% 0%,#3B2516 0%,transparent 60%),radial-gradient(90% 50% at 100% 70%,#4A2A12 0%,transparent 60%),#0F0B09', bgs: '#0F0B09',
        bg2: 'rgba(24,18,14,.94)', sf: 'rgba(255,255,255,.07)', sf2: 'rgba(255,255,255,.06)', ln: 'rgba(255,255,255,.12)', ln2: 'rgba(255,255,255,.25)',
        tx: '#F6EEE7', mu: '#B5A496', pr: 'linear-gradient(120deg,#5A3A22,#C98A4B)', pr2: '#E2A76B', pi: '#FFFFFF', fh: 'Fraunces', fb: 'Outfit',
        hero: 'radial-gradient(80% 50% at 50% 35%,#5A3517,#0F0B09 75%)', hero2: 'radial-gradient(60% 60% at 50% 55%,#4A2A12,#0F0B09 80%)',
        ban: 'linear-gradient(120deg,rgba(201,138,75,.55),rgba(58,42,32,.6))', banTx: '#FFFFFF', combo: 'linear-gradient(120deg,#6B4423,#C98A4B)' },
    saffron: { name: T('Saffron Pop', 'केसरिया', 'Saffron Pop'), dark: false, glass: false,
        bg: '#FFFFFF', bg2: '#FFFFFF', sf: '#FFFFFF', sf2: '#FFF1E3', ln: 'rgba(0,0,0,.08)', ln2: '#E5E5E5', tx: '#1C1917', mu: '#6B6460',
        pr: '#D96C08', pr2: '#C2410C', pi: '#FFFFFF', fh: 'Poppins', fb: 'Poppins',
        hero: 'linear-gradient(170deg,#7A3B10,#1C0F07)', hero2: 'radial-gradient(circle at 50% 60%,#FFE8D0,#FFFFFF 70%)',
        ban: 'linear-gradient(120deg,#F59E0B,#EA580C)', banTx: '#FFFFFF', combo: 'linear-gradient(120deg,#EA7A12,#B91C1C)' },
    matcha: { name: T('Matcha Mist', 'माचा', 'Matcha Mist'), dark: false, glass: false,
        bg: '#EEF3E8', bg2: '#F8FBF5', sf: '#FFFFFF', sf2: '#DFEAD5', ln: 'rgba(40,80,30,.10)', ln2: '#CADBBD', tx: '#1B2A17', mu: '#5E6F56',
        pr: '#4D7C3A', pr2: '#3F6A2E', pi: '#FFFFFF', fh: 'Fraunces', fb: 'Outfit',
        hero: 'linear-gradient(170deg,#3C5F2E,#16260F)', hero2: 'radial-gradient(circle at 50% 60%,#D6E6C8,#EEF3E8 70%)',
        ban: 'linear-gradient(120deg,#9BBF7E,#4D7C3A)', banTx: '#FFFFFF', combo: 'linear-gradient(120deg,#4D7C3A,#1F3B16)' },
    berry: { name: T('Berry Glass', 'बेरी ग्लास', 'Berry Glass'), dark: false, glass: true,
        bg: 'radial-gradient(90% 50% at 0% 0%,#FBCFE8,transparent 60%),radial-gradient(90% 60% at 100% 60%,#DDD6FE,transparent 60%),#FFF1F7', bgs: '#FFF1F7',
        bg2: 'rgba(255,255,255,.9)', sf: 'rgba(255,255,255,.55)', sf2: 'rgba(255,255,255,.7)', ln: 'rgba(255,255,255,.9)', ln2: '#E9C9DA',
        tx: '#3B0A24', mu: '#7E4A65', pr: 'linear-gradient(120deg,#DB2777,#7C3AED)', pr2: '#BE185D', pi: '#FFFFFF', fh: 'Outfit', fb: 'Outfit',
        hero: 'linear-gradient(160deg,#9D174D,#4C1D95)', hero2: 'radial-gradient(circle at 50% 60%,#FBCFE8,#F5E8FF 70%)',
        ban: 'linear-gradient(120deg,#EC4899,#8B5CF6)', banTx: '#FFFFFF', combo: 'linear-gradient(120deg,#DB2777,#7C3AED)' },
    ocean: { name: T('Ocean Glass', 'ओशन ग्लास', 'Ocean Glass'), dark: true, glass: true,
        bg: 'radial-gradient(100% 60% at 0% 0%,#0E4A6E,transparent 60%),radial-gradient(100% 60% at 100% 80%,#134E4A,transparent 60%),#06121C', bgs: '#06121C',
        bg2: 'rgba(8,22,34,.94)', sf: 'rgba(255,255,255,.07)', sf2: 'rgba(255,255,255,.07)', ln: 'rgba(255,255,255,.13)', ln2: 'rgba(255,255,255,.25)',
        tx: '#E6F4FA', mu: '#93B3C4', pr: 'linear-gradient(120deg,#0EA5E9,#14B8A6)', pr2: '#38BDF8', pi: '#04121C', fh: 'Outfit', fb: 'Outfit',
        hero: 'radial-gradient(80% 50% at 50% 35%,#0E4A6E,#06121C 75%)', hero2: 'radial-gradient(60% 60% at 50% 55%,#0E4A6E,#06121C 80%)',
        ban: 'linear-gradient(120deg,rgba(14,165,233,.55),rgba(20,184,166,.45))', banTx: '#FFFFFF', combo: 'linear-gradient(120deg,#0369A1,#0F766E)' },
    midnight: { name: T('Midnight Gold', 'मिडनाइट गोल्ड', 'Midnight Gold'), dark: true, glass: false,
        bg: '#0B0B0F', bg2: '#15151B', sf: '#17171E', sf2: '#202029', ln: 'rgba(255,255,255,.08)', ln2: '#34343F', tx: '#F5F1E6', mu: '#A19E96',
        pr: 'linear-gradient(120deg,#F3D27A,#B8892B)', pr2: '#E6C15C', pi: '#1A1406', fh: 'Fraunces', fb: 'Outfit',
        hero: 'radial-gradient(80% 50% at 50% 35%,#3A2E14,#0B0B0F 75%)', hero2: 'radial-gradient(60% 60% at 50% 55%,#2C2410,#0B0B0F 80%)',
        ban: 'linear-gradient(120deg,#2A2312,#0B0B0F)', banTx: '#F3D27A', combo: 'linear-gradient(120deg,#8A6A22,#2A2312)' },
    chai: { name: T('Masala Chai', 'मसाला चाय', 'Masala Chai'), dark: false, glass: false,
        bg: '#FBF3E4', bg2: '#FFFAF1', sf: '#FFFFFF', sf2: '#F5E3C8', ln: 'rgba(110,50,20,.10)', ln2: '#E7CFAE', tx: '#341508', mu: '#7A5A43',
        pr: '#9A3412', pr2: '#9A3412', pi: '#FFFFFF', fh: 'Fraunces', fb: 'Mukta',
        hero: 'linear-gradient(170deg,#7C2D12,#2A0F05)', hero2: 'radial-gradient(circle at 50% 60%,#F7D9B0,#FBF3E4 70%)',
        ban: 'linear-gradient(120deg,#C2410C,#7C2D12)', banTx: '#FFFFFF', combo: 'linear-gradient(120deg,#9A3412,#451A03)' },
};
export const THEME_KEYS = Object.keys(CX_THEMES);

// Light versions of the dark themes, for a customer who chose "Light" (and dark versions of light ones)
const LIGHT_OF = { espresso: 'latte', ocean: 'saffron', midnight: 'caramel' };
const DARK_OF = { latte: 'espresso', caramel: 'midnight', saffron: 'espresso', matcha: 'midnight', berry: 'ocean', chai: 'espresso' };

export const CX_FONTS = ['Outfit', 'Fraunces', 'Poppins', 'Mukta', 'Baloo 2', 'Hind'];

export const DEFAULT_LOOK = {
    enabled: ['latte', 'espresso', 'saffron', 'matcha', 'berry', 'chai'],
    first: 'latte',
    customerPick: true,
    modePick: true,
    glass: 60,          // 0 = no glass, 100 = strong frosting (only themes with glass use it)
    corners: 'round',   // square | soft | round
    headingFont: '',    // '' = the theme font
    nav: 'floating',    // floating | classic
    custom: null,       // {name, main, accent, dark} = "Make my own"
};

const HEX = /^#[0-9a-f]{6}$/i;

// A theme made from the owner colours ("Make my own")
export const customTheme = (c) => {
    const main = HEX.test(c?.main || '') ? c.main : '#C87316';
    const accent = HEX.test(c?.accent || '') ? c.accent : '#F3E2C7';
    const dark = !!c?.dark;
    return {
        name: T(c?.name || 'My theme', c?.name || 'मेरी थीम', c?.name || 'Meri theme'), dark, glass: false,
        bg: dark ? '#100D0B' : `color-mix(in srgb, ${accent} 22%, #FFFFFF)`,
        bg2: dark ? '#1A1613' : '#FFFFFF',
        sf: dark ? '#1C1815' : '#FFFFFF',
        sf2: dark ? '#26201C' : `color-mix(in srgb, ${accent} 35%, #FFFFFF)`,
        ln: dark ? 'rgba(255,255,255,.09)' : 'rgba(0,0,0,.08)', ln2: dark ? '#3A332D' : `color-mix(in srgb, ${main} 25%, #FFFFFF)`,
        tx: dark ? '#F4EEE8' : '#1F1A17', mu: dark ? '#A89F97' : '#6B625B',
        pr: main, pr2: dark ? `color-mix(in srgb, ${main} 70%, white)` : main, pi: '#FFFFFF', fh: 'Outfit', fb: 'Outfit',
        hero: `linear-gradient(160deg, color-mix(in srgb, ${main} 70%, black), #120C08)`,
        hero2: `radial-gradient(circle at 50% 60%, color-mix(in srgb, ${accent} 60%, white), ${dark ? '#100D0B' : '#FFFFFF'} 70%)`,
        ban: `linear-gradient(120deg, ${accent}, ${main})`, banTx: '#FFFFFF',
        combo: `linear-gradient(120deg, ${main}, color-mix(in srgb, ${main} 55%, black))`,
    };
};

export const normaliseLook = (look) => {
    const l = { ...DEFAULT_LOOK, ...(look && typeof look === 'object' ? look : {}) };
    const valid = (k) => THEME_KEYS.includes(k) || (k === 'custom' && l.custom);
    l.enabled = Array.isArray(l.enabled) ? l.enabled.filter(valid) : DEFAULT_LOOK.enabled;
    if (!valid(l.first)) l.first = l.enabled[0] || 'latte';
    if (!l.enabled.includes(l.first)) l.enabled = [l.first, ...l.enabled];
    l.glass = Math.max(0, Math.min(100, Number(l.glass ?? 60)));
    if (!['square', 'soft', 'round'].includes(l.corners)) l.corners = 'round';
    if (!['floating', 'classic'].includes(l.nav)) l.nav = 'floating';
    return l;
};

export const themeOf = (key, look) => (key === 'custom' ? customTheme(look?.custom) : CX_THEMES[key] || CX_THEMES.latte);

// The customer choice on this phone: {theme, mode: 'theme' | 'light' | 'dark' | 'auto'}
//   theme = as the theme is (default), auto = follow the phone light / dark setting
const STORE = 'cx-look';
export const readChoice = () => {
    try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch { return {}; }
};
export const saveChoice = (choice) => {
    try { localStorage.setItem(STORE, JSON.stringify(choice)); } catch { /* private mode */ }
    window.dispatchEvent(new Event('cx-look'));
};

// Which theme to show: the customer pick (if allowed and still switched on), else the owner first theme;
// then light or dark by the customer choice
export const resolveTheme = (look, choice = readChoice(), phoneDark = false) => {
    const l = normaliseLook(look);
    let key = l.customerPick && l.enabled.includes(choice.theme) ? choice.theme : l.first;
    const mode = l.modePick ? (choice.mode || 'theme') : 'theme';
    const wantDark = mode === 'dark' || (mode === 'auto' && phoneDark);
    const wantLight = mode === 'light' || (mode === 'auto' && !phoneDark);
    const t0 = themeOf(key, l);
    if (wantLight && t0.dark && LIGHT_OF[key]) key = LIGHT_OF[key];
    else if (wantDark && !t0.dark && DARK_OF[key]) key = DARK_OF[key];
    return { key, theme: themeOf(key, l), look: l };
};

const RADIUS = { square: '10px', soft: '16px', round: '22px' };

export const cxVars = (theme, look) => {
    const l = normaliseLook(look);
    const blur = theme.glass ? `${Math.round(6 + (l.glass / 100) * 18)}px` : '0px';
    const fh = l.headingFont && CX_FONTS.includes(l.headingFont) ? l.headingFont : theme.fh;
    return {
        '--cx-bg': theme.bg, '--cx-bgs': theme.bgs || theme.bg, '--cx-bg2': theme.bg2, '--cx-sf': theme.sf, '--cx-sf2': theme.sf2,
        '--cx-ln': theme.ln, '--cx-ln2': theme.ln2, '--cx-tx': theme.tx, '--cx-mu': theme.mu,
        '--cx-pr': theme.pr, '--cx-pr2': theme.pr2, '--cx-pi': theme.pi, '--cx-blur': blur,
        '--cx-fh': `'${fh}', 'Outfit', system-ui, sans-serif`, '--cx-fb': `'${theme.fb}', 'Outfit', system-ui, sans-serif`,
        '--cx-hero': theme.hero, '--cx-hero2': theme.hero2, '--cx-ban': theme.ban, '--cx-ban-tx': theme.banTx,
        '--cx-combo': theme.combo, '--cx-r': RADIUS[l.corners],
    };
};

const fontsLoaded = new Set();
export const loadCxFonts = (fonts) => {
    if (typeof document === 'undefined') return;
    const need = [...new Set(fonts)].filter(f => f && !fontsLoaded.has(f) && CX_FONTS.includes(f));
    if (!need.length) return;
    need.forEach(f => fontsLoaded.add(f));
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?${need.map(f => `family=${encodeURIComponent(f).replace(/%20/g, '+')}:wght@400;500;600;700;800`).join('&')}&display=swap`;
    document.head.appendChild(link);
};

// Put a theme on the page (customer screens only)
export const applyCxTheme = ({ key, theme, look }) => {
    const root = document.documentElement;
    for (const [k, v] of Object.entries(cxVars(theme, look))) root.style.setProperty(k, v);
    root.dataset.cxTheme = key;
    root.dataset.cxNav = look.nav;
    root.classList.toggle('cx-theme-dark', !!theme.dark);
    root.classList.toggle('cx-theme-glass', !!theme.glass && look.glass > 0);
    loadCxFonts([theme.fb, look.headingFont || theme.fh]);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', HEX.test(theme.bgs || theme.bg) ? (theme.bgs || theme.bg) : (theme.dark ? '#0F0B09' : '#FFFFFF'));
    root.classList.add('cx-themed');
};

// Leaving the customer app (staff screens, pickup TV): take the customer look off the page
export const clearCxTheme = () => {
    const root = document.documentElement;
    root.classList.remove('cx-themed', 'cx-theme-dark', 'cx-theme-glass');
    delete root.dataset.cxTheme;
    delete root.dataset.cxNav;
};
