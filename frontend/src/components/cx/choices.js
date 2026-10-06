// Sizes and choices of a dish, worked out in the app for instant feedback.
// The server (price_dish) is always the judge at checkout; these follow the same rules:
//   the size price replaces the dish price, then every picked choice adds its price;
//   a group with nothing picked and a minimum above zero takes its default (or its first choice).

const avail = (g) => (g?.choices || []).filter(c => c.available !== false);

export const sizeOf = (sizes, id) => {
    if (!sizes?.length) return null;
    return sizes.find(s => s.id === id) || sizes.find(s => s.isDefault) || sizes[0];
};

// The choices that count for one group, given the picked ids
export const pickedIn = (group, ids) => {
    const list = avail(group);
    let got = list.filter(c => ids.includes(c.id));
    if (!got.length && (group.min || 0) > 0) {
        got = list.filter(c => c.isDefault);
        if (!got.length && list[0]) got = [list[0]];
        if (group.pick === 'one') got = got.slice(0, 1);
    }
    return got;
};

// Unit price of a dish with a size and choices
export const dishPrice = (basePrice, sizes, groups, sel = {}) => {
    const size = sizeOf(sizes, sel.size);
    let p = size ? Number(size.price) : Number(basePrice || 0);
    const ids = sel.choices || [];
    for (const g of groups || []) for (const c of pickedIn(g, ids)) p += Number(c.price || 0);
    return p;
};

// What the page starts with: the default size, the default of every pick-one group, defaults of add-on groups
export const defaultSelection = (sizes, groups) => ({
    size: sizeOf(sizes)?.id || '',
    choices: (groups || []).flatMap(g => g.pick === 'one' || (g.min || 0) > 0
        ? pickedIn({ ...g, min: Math.max(g.min || 0, g.pick === 'one' ? 1 : 0) }, []).map(c => c.id)
        : avail(g).filter(c => c.isDefault).map(c => c.id)),
});

// Keep only ids that still exist (a saved order or an old cart line may name a choice the cafe removed)
export const cleanSelection = (sizes, groups, sel) => {
    const base = defaultSelection(sizes, groups);
    const size = sizes?.some(s => s.id === sel?.size) ? sel.size : base.size;
    const want = sel?.choices || [];
    const choices = (groups || []).flatMap(g => {
        const ids = avail(g).filter(c => want.includes(c.id)).map(c => c.id).slice(0, g.pick === 'one' ? 1 : (g.max || 99));
        if (ids.length) return ids;
        return base.choices.filter(id => avail(g).some(c => c.id === id));
    });
    return { size, choices };
};

const nm = (x, lang) => (lang === 'hi' && x?.nameHi) || x?.name || '';

// "Large · Oat · Hazelnut, Caramel": the size and anything that differs from the usual
export const selectionText = (sizes, groups, sel, lang = 'en') => {
    const parts = [];
    const size = sizes?.length > 1 ? sizeOf(sizes, sel?.size) : null;
    if (size) parts.push(nm(size, lang));
    for (const g of groups || []) {
        const got = pickedIn(g, sel?.choices || []).filter(c => g.pick === 'many' || !c.isDefault);
        if (got.length) parts.push(got.map(c => nm(c, lang)).join(', '));
    }
    return parts.join(' · ');
};

// The same words from a saved order line's options ({size, sizeName, choices:[{name, isDefault}]})
export const optionsText = (options) => {
    if (!options || typeof options !== 'object') return '';
    const parts = [];
    if (options.sizeName) parts.push(options.sizeName);
    const ch = (options.choices || []).filter(c => !c.isDefault).map(c => c.name);
    if (ch.length) parts.push(ch.join(', '));
    return parts.join(' · ');
};

// The customer's own words from a server note ("Oat, Hazelnut · less ice" → "less ice")
export const ownNote = (note, options) => {
    const s = String(note || '');
    const at = s.indexOf(' · ');
    if (at >= 0) return s.slice(at + 3);
    if (options?.picks) return '';
    const words = (options?.choices || []).filter(c => !c.isDefault).map(c => c.name).join(', ');
    return words && s === words ? '' : s;
};

// Saved options → what the page or the cart line needs
export const selFromOptions = (options) => ({
    size: options?.size || '',
    choices: (options?.choices || []).map(c => c.id).filter(Boolean),
});

// The shortest form of a selection: the default size and the defaults of required groups are left out
// (the server puts them back), so "Medium, regular milk" from the dish page and a plain ADD from the
// menu are the same cart line.
export const canonical = (sizes, groups, sel) => {
    const def = sizeOf(sizes);
    const size = sizes?.length && sel?.size && sel.size !== def?.id ? sel.size : '';
    const drop = new Set();
    for (const g of groups || []) {
        if (!(g.pick === 'one' || (g.min || 0) > 0)) continue;
        const defs = pickedIn({ ...g, min: Math.max(1, g.min || 0) }, []).map(c => c.id);
        const mine = (sel?.choices || []).filter(id => (g.choices || []).some(c => c.id === id));
        if (mine.length === defs.length && mine.every(id => defs.includes(id))) mine.forEach(id => drop.add(id));
    }
    return { size, choices: (sel?.choices || []).filter(id => !drop.has(id)) };
};
