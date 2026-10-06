import { useEffect, useState } from 'react';
import { getDishesWithChoices } from '../utils/api';

// Which dishes have sizes or choices ({ [id]: { from, art } }), loaded once per visit and shared by every menu card.
// A dish in this list opens its page when + is tapped; the others go straight into the cart.
let cache = null;
let loading = null;
const listeners = new Set();

const load = () => {
    if (cache || loading) return loading;
    loading = getDishesWithChoices()
        .then(r => { cache = r?.data && typeof r.data === 'object' ? r.data : {}; })
        .catch(() => { cache = {}; })
        .finally(() => { loading = null; listeners.forEach(fn => fn(cache)); });
    return loading;
};

export const useDishChoices = () => {
    const [map, setMap] = useState(cache || {});
    useEffect(() => {
        listeners.add(setMap);
        if (!cache) load();
        return () => { listeners.delete(setMap); };
    }, []);
    return map;
};

// Does the dish need a choice before it goes in the cart (a size, milk, sugar…)?
export const needsChoice = (item, map) => {
    if (Array.isArray(item?.sizes) || Array.isArray(item?.optionGroups)) {
        return (item.sizes?.length || 0) > 0 || (item.optionGroups?.length || 0) > 0;
    }
    // Items from other lists (collections) may not carry sizes: the shared list says
    return !!map?.[item?._id];
};

// Lowest price when the dish comes in sizes ("from ₹120"), else null
export const fromPrice = (item, map) => {
    const sizes = Array.isArray(item?.sizes) ? item.sizes : [];
    const low = sizes.length ? Math.min(...sizes.map(s => Number(s.price)).filter(n => n > 0)) : Number(map?.[item?._id]?.from);
    return Number.isFinite(low) && low > 0 && (sizes.length > 1 || low < Number(item?.price)) ? low : null;
};
