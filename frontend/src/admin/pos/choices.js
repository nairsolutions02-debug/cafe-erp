// Sizes, choices and combos on staff screens (Counter, Kiosk, Kitchen, Orders, bills).
// Pricing here copies the database (price_dish / price_order) so the offline counter shows the same total;
// the database always prices the real bill again when the order is saved.
//   item:   menu row with sizes [{id,name,price,isDefault}] and option_groups [groupId] (snake or camel)
//   groups: { [id]: {id, name, pick, min_pick, max_pick, choices:[{id,name,price,isDefault,available}]} }
//   sel:    { size: sizeId, choices: [choiceId] }

export const num = (v) => Number(v) || 0;
export const sizesOf = (item) => (Array.isArray(item?.sizes) ? item.sizes : []);
const groupIdsOf = (item) => item?.option_groups || item?.optionGroups || [];
export const minOf = (g) => num(g.min_pick ?? g.minPick);
export const maxOf = (g) => Math.max(1, num(g.max_pick ?? g.maxPick ?? 1));
export const isDef = (c) => c?.isDefault === true || c?.isDefault === 'true';
export const avail = (c) => c?.available !== false && c?.available !== 'false';

export const groupsById = (list) => Object.fromEntries((list || []).map(g => [g.id, g]));
export const groupsFor = (item, groups) => groupIdsOf(item).map(id => groups?.[id]).filter(Boolean);
export const hasChoices = (item, groups) => sizesOf(item).length > 0 || groupsFor(item, groups).length > 0;

// What the picker starts with: the default size and the default choices of each group
export function defaultSel(item, groups) {
    const sizes = sizesOf(item);
    const size = sizes.find(isDef) || sizes[0];
    const choices = [];
    groupsFor(item, groups).forEach(g => {
        const ok = (g.choices || []).filter(avail);
        let d = ok.filter(isDef);
        if (!d.length && minOf(g) > 0 && ok[0]) d = [ok[0]];
        if (g.pick === 'one') d = d.slice(0, 1);
        choices.push(...d.slice(0, maxOf(g)).map(c => c.id));
    });
    return { size: size?.id || '', choices };
}

// One dish with its size and choices: { price, name, words } the same way as price_dish
export function priceDish(item, sel = {}, groups = {}) {
    const sizes = sizesOf(item);
    let price = num(item?.price);
    let sizeName = '';
    let size = null;
    if (sizes.length) {
        size = sizes.find(s => s.id === sel.size) || sizes.find(isDef) || sizes[0];
        price = num(size.price);
        sizeName = size.name || '';
    }
    const picked = sel.choices || [];
    const words = [];
    groupsFor(item, groups).forEach(g => {
        let inGroup = (g.choices || []).filter(c => picked.includes(c.id) && avail(c));
        if (!inGroup.length && minOf(g) > 0) {
            inGroup = (g.choices || []).filter(c => isDef(c) && avail(c));
            if (!inGroup.length && g.choices?.[0]) inGroup = [g.choices[0]];
            if (g.pick === 'one') inGroup = inGroup.slice(0, 1);
        }
        inGroup.forEach(c => {
            price += num(c.price);
            if (!isDef(c) || g.pick === 'many') words.push(c.name);
        });
    });
    return { price, name: `${item?.name || ''}${sizeName ? ` (${sizeName})` : ''}`, words: words.join(', '), size: size?.id || '' };
}

// A combo: its price, plus each pick's extra, plus anything above the default size and choices
export function priceCombo(combo, picks, itemsById, groups) {
    let price = num(combo.price);
    const words = [];
    (combo.slots || []).forEach((slot, n) => {
        const pick = picks[n];
        const entry = (slot.items || []).find(i => i.menuItem === pick?.menuItem);
        const item = itemsById[pick?.menuItem];
        if (!entry || !item) return;
        const d = priceDish(item, pick, groups);
        price += num(entry.extra) + Math.max(d.price - priceDish(item, {}, groups).price, 0);
        words.push(d.name + (d.words ? ` [${d.words}]` : ''));
    });
    return { price, words: words.join(' + ') };
}

// ---- reading a line's note -------------------------------------------------
// Dish note:  "Oat, Hazelnut · extra hot"         (choices, then the staff or customer note)
// Combo note: "Latte (Large) [Oat] + Croissant · no sugar"
export const isComboLine = (i) => !!(i?.comboId || i?.combo_id || i?.combo === true || i?.options?.combo
    || (!i?.menuItem && !i?.menuItemId && / \+ /.test(i?.note || '')));

export function splitNote(i) {
    const note = String(i?.note || '').trim();
    if (!note) return { picks: [], text: '' };
    if (!isComboLine(i)) return { picks: [], text: note };
    const at = note.lastIndexOf(' · ');
    const main = at >= 0 ? note.slice(0, at) : note;
    const extra = at >= 0 ? note.slice(at + 3) : '';
    return { picks: main.split(' + ').map(s => s.trim()).filter(Boolean), text: extra };
}

// Plain text for one-line lists: "2× Latte (Large) · Oat"
export const lineText = (i) => {
    const { picks, text } = splitNote(i);
    return [i.name, picks.length ? picks.join(' + ') : '', text].filter(Boolean).join(' · ');
};

