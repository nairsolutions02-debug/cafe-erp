import React from 'react';

// A small drawn coin for points (no emoji)
const Coin = ({ size = 18 }) => (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" className="cx-coin">
        <circle cx="12" cy="12" r="10" fill="#F5B731" /><circle cx="12" cy="12" r="7.2" fill="none" stroke="#B7791F" strokeWidth="1.6" />
        <path d="M9.5 9h5M9.5 11.5h5M12 9c1.8 0 2.4 1.2 2.4 2.5S13.3 14 11.4 14L14 16.5" stroke="#8A5A12" strokeWidth="1.5" fill="none" strokeLinecap="round" />
    </svg>
);
export default Coin;
