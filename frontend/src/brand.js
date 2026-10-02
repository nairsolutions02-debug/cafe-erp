// Per-cafe branding. Each cafe's Vercel project sets these VITE_CAFE_* env vars;
// VITE_CAFE_LOGO_URL points at the cafe's logo (defaults to public/logo.svg).
const env = import.meta.env;

const splitList = (value, fallback) =>
    value ? value.split('|').map(s => s.trim()).filter(Boolean) : fallback;

const brand = {
    name: env.VITE_CAFE_NAME || 'Cafe ERP',
    tagline: env.VITE_CAFE_TAGLINE || 'Fresh food, served fast',
    address: env.VITE_CAFE_ADDRESS || '',
    phone: env.VITE_CAFE_PHONE || '',
    email: env.VITE_CAFE_EMAIL || '',
    instagram: env.VITE_CAFE_INSTAGRAM || '',
    facebook: env.VITE_CAFE_FACEBOOK || '',
    hoursDays: env.VITE_CAFE_HOURS_DAYS || 'Mon - Sun',
    hoursTime: env.VITE_CAFE_HOURS_TIME || '9:00 AM - 10:00 PM',
    logo: env.VITE_CAFE_LOGO_URL || '/logo.svg',
    heroBadge: env.VITE_CAFE_HERO_BADGE || '🍽️ Freshly Made',
    heroText: env.VITE_CAFE_HERO_TEXT || 'Every dish is crafted with love and fresh ingredients. Order right from your table!',
    heroImage: env.VITE_CAFE_HERO_IMAGE_URL || '/hero-image.png',
    // Pipe-separated "value:label" pairs, e.g. "50+:Dishes|4.8:Rating". Hidden when empty.
    stats: splitList(env.VITE_CAFE_STATS, []).map(pair => {
        const [value, ...label] = pair.split(':');
        return { value: value.trim(), label: label.join(':').trim() };
    }),
    // Pipe-separated, e.g. "Search for Cold Coffee...|Try our Sandwich..."
    searchHints: splitList(env.VITE_CAFE_SEARCH_HINTS, [
        'Search the menu...',
        'Find your favorite dish...',
        'Looking for something to drink?',
    ]),
};

export default brand;
