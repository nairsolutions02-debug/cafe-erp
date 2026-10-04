import React, { useEffect, useState } from 'react';

const COLORS = ['#F59E0B', '#EF4444', '#22C55E', '#3B82F6', '#A855F7', '#EC4899'];

// A short burst of confetti; nothing at all when the phone asks for less motion
const makePieces = (n) => Array.from({ length: n }, (_, i) => ({
    left: `${Math.random() * 100}%`,
    background: COLORS[i % COLORS.length],
    animationDelay: `${Math.random() * 0.5}s`,
    animationDuration: `${1.6 + Math.random() * 1.2}s`,
    transform: `rotate(${Math.random() * 360}deg)`,
}));

const Confetti = ({ pieces = 70, ms = 2600 }) => {
    const [on, setOn] = useState(() => !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
    const [styles] = useState(() => makePieces(pieces));
    useEffect(() => {
        const t = setTimeout(() => setOn(false), ms);
        return () => clearTimeout(t);
    }, [ms]);
    if (!on) return null;
    return (
        <div className="confetti" aria-hidden="true">
            {styles.map((style, i) => <i key={i} style={style} />)}
        </div>
    );
};

export default Confetti;
