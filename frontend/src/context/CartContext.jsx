import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

// The cart. Each line is one dish with its size and choices, or one combo with its picks:
//   { key, _id (menu item or null), combo (combo id or null), name, nameHi, image, art, isVeg,
//     price (unit price with choices, for display), quantity, size, sizeName, choices: [ids], choiceText,
//     picks: [{menuItem, name, size, sizeName, choices, choiceText}] (combos), note }
// The same dish with the same choices (and note) is one line; different choices make a new line.
// Old callers keep working: addItem(item), incrementQuantity(id), decrementQuantity(id) act on the plain
// line of that dish (no size, no choices), or on its latest line when there is no plain one.
const CartContext = createContext();

export const useCart = () => useContext(CartContext);

const sorted = (a) => [...(a || [])].map(String).sort().join('+');
const lineKey = (l) => {
    const note = String(l.note || '').trim().toLowerCase();
    if (l.combo) {
        const picks = (l.picks || []).map(p => `${p.menuItem}/${p.size || ''}/${sorted(p.choices)}`).join(',');
        return `c:${l.combo}|${picks}|${note}`;
    }
    return `d:${l._id}|${l.size || ''}|${sorted(l.choices)}|${note}`;
};

const isPlain = (l) => !l.combo && !l.size && !(l.choices || []).length && !String(l.note || '').trim();

// A line from anything: a menu item (old callers), a saved line, an old cart from before choices
const normalise = (raw) => {
    const l = {
        _id: raw.combo ? null : (raw._id ?? raw.menuItem ?? null),
        combo: raw.combo || null,
        name: raw.name || '',
        nameHi: raw.nameHi || '',
        image: raw.image || '',
        art: raw.art || raw.details?.art || '',
        isVeg: raw.isVeg !== false,
        isAvailable: raw.isAvailable !== false,
        price: Number(raw.price) || 0,
        quantity: Math.max(1, Math.min(99, Number(raw.quantity) || 1)),
        size: raw.size || '',
        sizeName: raw.sizeName || '',
        choices: Array.isArray(raw.choices) ? raw.choices.filter(Boolean) : [],
        choiceText: raw.choiceText || '',
        choiceTextHi: raw.choiceTextHi || '',
        picks: raw.combo ? (raw.picks || []).map(p => ({
            menuItem: p.menuItem, name: p.name || '', size: p.size || '', sizeName: p.sizeName || '',
            choices: p.choices || [], choiceText: p.choiceText || '', choiceTextHi: p.choiceTextHi || '', nameHi: p.nameHi || '',
            art: p.art || '', image: p.image || '',
        })) : undefined,
        note: String(raw.note || '').slice(0, 140),
    };
    l.key = lineKey(l);
    return l;
};

const load = () => {
    try {
        const saved = JSON.parse(localStorage.getItem('cart') || '[]');
        if (!Array.isArray(saved)) return [];
        // Old carts (before choices) have no key: make each a plain line; same-key lines merge
        const out = [];
        for (const raw of saved) {
            if (!raw || (!raw._id && !raw.combo)) continue;
            const l = normalise(raw);
            const same = out.find(x => x.key === l.key);
            if (same) same.quantity = Math.min(99, same.quantity + l.quantity);
            else out.push(l);
        }
        return out;
    } catch {
        return [];
    }
};

// The line that id-based helpers act on
const targetOf = (lines, id) => lines.find(l => l._id === id && isPlain(l)) || [...lines].reverse().find(l => l._id === id && !l.combo);

export const CartProvider = ({ children }) => {
    const [items, setItems] = useState(load);
    const [coupon, setCoupon] = useState(null);

    useEffect(() => {
        try { localStorage.setItem('cart', JSON.stringify(items)); } catch { /* storage full or blocked */ }
    }, [items]);

    // Add a line (merges with the same dish + same choices)
    const addLine = useCallback((raw) => {
        const l = normalise(raw);
        setItems(prev => {
            const same = prev.find(i => i.key === l.key);
            if (same) return prev.map(i => i.key === l.key ? { ...i, quantity: Math.min(99, i.quantity + l.quantity), price: l.price || i.price } : i);
            return [...prev, l];
        });
        return l.key;
    }, []);

    // Edit: swap a line for the new version (keeps its place; merges if the new one matches another line)
    const replaceLine = useCallback((oldKey, raw) => {
        const l = normalise(raw);
        setItems(prev => {
            const at = prev.findIndex(i => i.key === oldKey);
            const rest = prev.filter(i => i.key !== oldKey);
            const same = rest.find(i => i.key === l.key);
            if (same) return rest.map(i => i.key === l.key ? { ...i, quantity: Math.min(99, i.quantity + l.quantity) } : i);
            if (at < 0) return [...rest, l];
            return [...rest.slice(0, at), l, ...rest.slice(at)];
        });
        return l.key;
    }, []);

    const updateLineQty = useCallback((key, quantity) => {
        setItems(prev => quantity <= 0
            ? prev.filter(i => i.key !== key)
            : prev.map(i => i.key === key ? { ...i, quantity: Math.min(99, quantity) } : i));
    }, []);

    const removeLine = useCallback((key) => setItems(prev => prev.filter(i => i.key !== key)), []);

    // Server prices for the lines (from quote_lines): keeps the totals right everywhere
    const syncPrices = useCallback((byKey) => {
        setItems(prev => {
            let changed = false;
            const next = prev.map(i => {
                const p = byKey[i.key];
                if (p === undefined || Number(p) === i.price) return i;
                changed = true;
                return { ...i, price: Number(p) };
            });
            return changed ? next : prev;
        });
    }, []);

    // ---- old callers (menu cards, search, order again): one dish, no choices ----
    const addItem = (item) => {
        const sizes = Array.isArray(item.sizes) ? item.sizes : [];
        const def = sizes.find(s => s.isDefault) || sizes[0];
        const plain = normalise({ ...item, price: def ? def.price : item.price, quantity: 1, size: '', choices: [], note: '' });
        setItems(prev => {
            const same = prev.find(i => i.key === plain.key);
            if (same) return prev.map(i => i.key === plain.key ? { ...i, quantity: Math.min(99, i.quantity + 1) } : i);
            return [...prev, plain];
        });
    };

    // key or menu item id
    const resolve = (prev, idOrKey) => prev.find(i => i.key === idOrKey) || targetOf(prev, idOrKey);

    const removeItem = (idOrKey) => {
        setItems(prev => {
            const t = resolve(prev, idOrKey);
            return t ? prev.filter(i => i !== t) : prev;
        });
    };

    const updateQuantity = (idOrKey, quantity) => {
        setItems(prev => {
            const t = resolve(prev, idOrKey);
            if (!t) return prev;
            if (quantity <= 0) return prev.filter(i => i !== t);
            return prev.map(i => i === t ? { ...i, quantity: Math.min(99, quantity) } : i);
        });
    };

    const incrementQuantity = (itemId) => {
        setItems(prev => {
            const t = targetOf(prev, itemId);
            return t ? prev.map(i => i === t ? { ...i, quantity: Math.min(99, i.quantity + 1) } : i) : prev;
        });
    };

    const decrementQuantity = (itemId) => {
        setItems(prev => {
            const t = targetOf(prev, itemId);
            if (!t) return prev;
            if (t.quantity <= 1) return prev.filter(i => i !== t);
            return prev.map(i => i === t ? { ...i, quantity: i.quantity - 1 } : i);
        });
    };

    // How many of a dish are in the cart, over all its lines
    const qtyOf = (itemId) => items.reduce((n, i) => n + (i._id === itemId && !i.combo ? i.quantity : 0), 0);

    const clearCart = () => {
        setItems([]);
        setCoupon(null);
    };

    const applyCoupon = (couponData) => {
        setCoupon(couponData);
    };

    const removeCoupon = () => {
        setCoupon(null);
    };

    // What the server prices (price_order / quote_lines / place_order)
    const itemsForServer = useCallback(() => items.map(i => (i.combo
        ? { combo: i.combo, quantity: i.quantity, note: i.note || '',
            picks: (i.picks || []).map(p => ({ menuItem: p.menuItem, size: p.size || '', choices: p.choices || [] })) }
        : { menuItem: i._id, quantity: i.quantity, size: i.size || '', choices: i.choices || [], note: i.note || '' })), [items]);

    const subtotal = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const discount = coupon ? coupon.discount : 0;
    const tax = (subtotal - discount) * 0.05;
    const total = subtotal - discount + tax;
    const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);

    return (
        <CartContext.Provider value={{
            items,
            coupon,
            subtotal,
            discount,
            tax,
            total,
            itemCount,
            addItem,
            addLine,
            replaceLine,
            updateLineQty,
            removeLine,
            syncPrices,
            itemsForServer,
            qtyOf,
            removeItem,
            updateQuantity,
            incrementQuantity,
            decrementQuantity,
            clearCart,
            applyCoupon,
            removeCoupon
        }}>
            {children}
        </CartContext.Provider>
    );
};
