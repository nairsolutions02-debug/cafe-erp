import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { toggleFavourite } from '../../utils/api';
import { setFavourite, useFavouriteIds } from './favs';
import './FavHeart.css';
import useCxLang, { T } from '../../lib/cxLang';

// Round heart that saves a dish as a favourite. Sits on cards, so it never opens the card.
//   <FavHeart item={item} className="..." />
// The favourite ids load once per signed-in customer (favs.js) and are shared by every heart on the screen.
const W = {
    save: T('Save to favourites', 'पसंदीदा में रखें', 'Favourites mein rakho'),
    saved: T('Saved in favourites', 'पसंदीदा में है', 'Favourites mein hai'),
};

const Heart = ({ on }) => (
    <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 20.5s-7.5-4.6-9.3-9.2C1.4 7.9 3.6 4.5 7 4.5c2 0 3.6 1.1 5 3 1.4-1.9 3-3 5-3 3.4 0 5.6 3.4 4.3 6.8-1.8 4.6-9.3 9.2-9.3 9.2z"
            fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
);

const FavHeart = ({ item, className = '', onChange }) => {
    const { user } = useAuth();
    const { t } = useCxLang();
    const favs = useFavouriteIds();
    const id = item?._id;
    const on = !!id && favs.has(id);
    const [pop, setPop] = useState(false);

    const click = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!id) return;
        if (user?.role !== 'customer') {
            // The sign-in card is already on screen for visitors; bring it into view
            window.dispatchEvent(new Event('cx-need-login'));
            document.querySelector('.login-modal, .login-modal-overlay')?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
            return;
        }
        const next = !on;
        setFavourite(id, next);
        setPop(next);
        onChange?.(next);
        try {
            const res = await toggleFavourite(id);
            if (res.data !== next) { setFavourite(id, !!res.data); onChange?.(!!res.data); }
        } catch {
            setFavourite(id, on);
            onChange?.(on);
        }
    };

    return (
        <button type="button" className={`cx-heart ${on ? 'on' : ''} ${pop ? 'pop' : ''} ${className}`}
            aria-pressed={on} aria-label={t(on ? W.saved : W.save)} title={t(on ? W.saved : W.save)}
            onClick={click} onAnimationEnd={() => setPop(false)}>
            <Heart on={on} />
        </button>
    );
};

export default FavHeart;
