import React, { useEffect, useRef, useState } from 'react';
import { usePortal } from '../../context/PortalContext';

// A small ⓘ that explains something in a bubble; tap again or anywhere else to close
const InfoTip = ({ children, label = 'More info' }) => {
    const { show } = usePortal();
    const [open, setOpen] = useState(false);
    const ref = useRef();
    useEffect(() => {
        if (!open) return undefined;
        const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
        document.addEventListener('pointerdown', close);
        return () => document.removeEventListener('pointerdown', close);
    }, [open]);
    if (!show('infoButtons')) return null;
    return (
        <span className="infotip" ref={ref}>
            <button type="button" className="infotip-btn" aria-label={label} aria-expanded={open}
                onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}>i</button>
            {open && <span className="infotip-bubble" role="tooltip">{children}</span>}
        </span>
    );
};

export default InfoTip;
