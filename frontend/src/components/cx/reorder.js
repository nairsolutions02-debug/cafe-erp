// Turning saved order lines and favourites back into cart lines ("Order the same again", "Your usual").
import { quoteLines } from '../../utils/api';
import { optionsText, ownNote } from './choices';

const ids = (options) => (options?.choices || []).filter(c => !c.isDefault).map(c => c.id).filter(Boolean);
const bare = (name, sizeName) => (sizeName && String(name).endsWith(` (${sizeName})`) ? String(name).slice(0, -(sizeName.length + 3)) : name);

// An order line from my_orders (menuItem is an object) or my_usual().lastOrder (menuItem is an id)
export const lineFromOrderItem = (oi) => {
    const options = oi.options || {};
    const comboId = oi.comboId || oi.combo || options.combo || null;
    if (comboId) {
        return {
            combo: comboId, name: oi.name, price: Number(oi.price) || 0, quantity: oi.quantity || 1,
            picks: (options.picks || []).map(p => ({
                menuItem: p.menuItem, name: bare(p.name, p.options?.sizeName), size: p.options?.size || '', sizeName: p.options?.sizeName || '',
                choices: ids(p.options), choiceText: optionsText(p.options),
            })),
            note: ownNote(oi.note, options),
        };
    }
    const m = oi.menuItem && typeof oi.menuItem === 'object' ? oi.menuItem : { _id: oi.menuItem };
    if (!m?._id) return null;
    return {
        _id: m._id, name: m.name || bare(oi.name, options.sizeName), image: m.image || '', price: Number(oi.price) || Number(m.price) || 0,
        quantity: oi.quantity || 1, size: options.size || '', sizeName: options.sizeName || '', choices: ids(options),
        choiceText: optionsText(options), note: ownNote(oi.note, options),
    };
};

// A favourite (my_favourites) made the way the customer had it last time
export const lineFromFavourite = (f) => {
    const options = f.last?.options || {};
    return {
        _id: f._id, name: f.name, nameHi: f.nameHi, image: f.image, art: f.art || '', isVeg: f.isVeg,
        price: Number(f.last?.price) || Number(f.price) || 0, quantity: 1,
        size: options.size || '', sizeName: options.sizeName || '', choices: ids(options),
        choiceText: optionsText(options), note: f.last ? ownNote(f.last.note, options) : '',
    };
};

const forServer = (l) => (l.combo
    ? { combo: l.combo, quantity: l.quantity, note: l.note || '', picks: (l.picks || []).map(p => ({ menuItem: p.menuItem, size: p.size, choices: p.choices })) }
    : { menuItem: l._id, quantity: l.quantity, size: l.size, choices: l.choices, note: l.note || '' });

// Check each line with the server (still on the menu, combo still on, choices still there) and take today's price.
// Returns { ok: [lines], skipped: [names] }
export const checkLines = async (lines) => {
    const res = await Promise.all(lines.filter(Boolean).map(async (l) => {
        try {
            const r = await quoteLines([forServer(l)]);
            const q = r.data?.[0];
            return q ? { line: { ...l, price: Number(q.price) } } : { skip: l.name };
        } catch {
            return { skip: l.name };
        }
    }));
    return { ok: res.filter(r => r.line).map(r => r.line), skipped: res.filter(r => r.skip !== undefined).map(r => r.skip) };
};
