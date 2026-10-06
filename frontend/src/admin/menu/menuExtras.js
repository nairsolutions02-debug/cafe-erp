// Shared helpers for the menu extras: sizes, choice groups, goes well with, details page, combos
export const uid = () => Math.random().toString(36).slice(2, 10);
export const MAX_PAIRS = 8;
export const MAX_GROUPS = 8;
export const MAX_SIZES = 6;
export const DETAIL_SHOW = [
    ['rating', 'Rating & reviews', true], ['prep', 'Prep time', true], ['calories', 'Calories', true], ['caffeine', 'Caffeine', true],
    ['allergens', 'Allergens', true], ['ingredients', 'Ingredients', false], ['pairs', '"Goes well with"', true], ['combo', 'Combo nudge', true],
    ['veg', 'Veg / non-veg mark', true], ['points', 'Points earned', false],
];
export const showOf = (details) => Object.fromEntries(DETAIL_SHOW.map(([k, , d]) => [k, details?.show?.[k] ?? d]));
export const choiceRange = (g) => (g.pick === 'one' ? 'Pick one'
    : `${g.minPick > 0 ? `${g.minPick}–${g.maxPick}` : `Up to ${g.maxPick}`}${g.minPick > 0 ? '' : ' · optional'}`);
export const rupees = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;
// The usual price of a dish (its default size when it has sizes)
export const dishPrice = (item) => {
    const sizes = Array.isArray(item?.sizes) ? item.sizes : [];
    const d = sizes.find(s => s.isDefault) || sizes[0];
    return Number(d ? d.price : item?.price) || 0;
};
export const DAYS = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [0, 'Sun']];
// 15:00 -> 3 PM
export const clock = (t) => {
    if (!t) return '';
    const [h, m] = String(t).split(':').map(Number);
    return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`;
};
