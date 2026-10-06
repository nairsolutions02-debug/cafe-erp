import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { getMyFavourites } from '../../utils/api';

// Favourite dish ids of the signed-in customer, loaded once and shared by every heart on the screen
let owner = null;      // customer the cache belongs to
let ids = null;        // Set of favourite menu item ids
let loading = null;    // the one request in flight
const listeners = new Set();
const tell = () => listeners.forEach(fn => fn());

export const loadFavourites = (userId, force = false) => {
    if (owner !== userId) { owner = userId; ids = null; loading = null; }
    if (!userId) return Promise.resolve(new Set());
    if (ids && !force) return Promise.resolve(ids);
    if (!loading || force) {
        loading = getMyFavourites()
            .then(r => { if (owner === userId) { ids = new Set((r.data || []).map(f => f._id)); tell(); } return ids; })
            .catch(() => { if (owner === userId) { ids = ids || new Set(); } return ids; })
            .finally(() => { loading = null; });
    }
    return loading;
};

// Hearts elsewhere (the Saved page) can change the list too
export const setFavourite = (id, on) => {
    if (!ids) ids = new Set();
    if (on) ids.add(id); else ids.delete(id);
    tell();
};

export const useFavouriteIds = () => {
    const { user } = useAuth();
    const customer = user?.role === 'customer' ? user._id : null;
    const [, bump] = useState(0);
    useEffect(() => {
        const fn = () => bump(n => n + 1);
        listeners.add(fn);
        loadFavourites(customer);
        return () => listeners.delete(fn);
    }, [customer]);
    return owner === customer && ids ? ids : new Set();
};

