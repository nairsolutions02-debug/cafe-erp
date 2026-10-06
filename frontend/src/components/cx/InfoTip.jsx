import React, { useEffect, useRef, useState } from 'react';
import { usePortal } from '../../context/PortalContext';
import useCxLang, { T } from '../../lib/cxLang';

const W = { more: T('More info', 'और जानकारी', 'Aur jaankari') };

// A small ⓘ that explains something in a bubble; tap again or anywhere else to close
const InfoTip = ({ children, label }) => {
    const { show } = usePortal();
    const { t } = useCxLang();
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
            <button type="button" className="infotip-btn" aria-label={label || t(W.more)} aria-expanded={open}
                onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}>i</button>
            {open && <span className="infotip-bubble" role="tooltip">{children}</span>}
        </span>
    );
};

export default InfoTip;
