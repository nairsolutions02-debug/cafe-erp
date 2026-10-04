import React from 'react';
import { usePortal } from '../../context/PortalContext';

// The owner's one-line announcement ("Live music Friday 8 pm"), scrolling if it's long
const AnnouncementStrip = () => {
    const { cfg } = usePortal();
    const a = cfg?.announcement;
    if (!a?.on || !a.text?.trim()) return null;
    const long = a.text.length > 38;
    return (
        <div className={`announce ${long ? 'scroll' : ''}`} role="note">
            <span className="announce-dot" aria-hidden="true" />
            <div className="announce-viewport">
                <div className="announce-track">
                    <span>{a.text}</span>
                    {long && <span aria-hidden="true">{a.text}</span>}
                </div>
            </div>
        </div>
    );
};

export default AnnouncementStrip;
