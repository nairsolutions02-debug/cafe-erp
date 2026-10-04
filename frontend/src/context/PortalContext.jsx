import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { getPortalConfig } from '../utils/api';
import { useAuth } from './AuthContext';

// The owner's customer-app settings (banners, announcement, what to show, reminders, table mode),
// loaded once and shared by every customer page. Also runs the gentle reminders ("nudges").
const PortalContext = createContext({ cfg: null, show: () => true, nudge: () => {} });
export const usePortal = () => useContext(PortalContext);

const DEFAULT_SHOW = {
    rewardBar: true, photos: true, badges: true, infoButtons: true,
    nudgeMilestone: true, nudgePoints: true, nudgeCelebrate: true,
};
const NUDGE_MS = 5000;

const applyTheme = (color) => {
    if (!/^#[0-9a-f]{6}$/i.test(color || '')) return;
    const root = document.documentElement.style;
    root.setProperty('--primary', color);
    root.setProperty('--bg-primary', color);
    root.setProperty('--primary-dark', `color-mix(in srgb, ${color} 80%, black)`);
    root.setProperty('--primary-light', `color-mix(in srgb, ${color} 80%, white)`);
};

export const PortalProvider = ({ children }) => {
    const { user } = useAuth();
    const [cfg, setCfg] = useState(null);
    const [current, setCurrent] = useState(null);
    const timer = useRef();

    const refresh = useCallback(() => getPortalConfig().then(r => {
        setCfg(r.data);
        applyTheme(r.data?.theme);
    }).catch(() => {}), []);
    useEffect(() => { refresh(); }, [refresh, user?._id]);

    const show = useCallback((key) => {
        const v = cfg?.show?.[key];
        return v === undefined ? (DEFAULT_SHOW[key] ?? true) : v !== false;
    }, [cfg]);

    // One reminder at a time; each kind at most once per visit; hides itself after 5 seconds.
    // A reminder that arrives while another is showing is dropped, never queued.
    const nudge = useCallback(({ kind, icon = '✨', text, action }) => {
        if (!text) return;
        try {
            if (sessionStorage.getItem(`nudged:${kind}`)) return;
            sessionStorage.setItem(`nudged:${kind}`, '1');
        } catch { /* storage unavailable: still show it */ }
        setCurrent(prev => {
            if (prev) return prev;
            clearTimeout(timer.current);
            timer.current = setTimeout(() => setCurrent(null), NUDGE_MS);
            return { kind, icon, text, action, id: Date.now() };
        });
    }, []);
    const dismiss = () => { clearTimeout(timer.current); setCurrent(null); };
    useEffect(() => () => clearTimeout(timer.current), []);

    return (
        <PortalContext.Provider value={{ cfg, show, nudge, refresh }}>
            {children}
            {current && (
                <div className="nudge" role="status" key={current.id}>
                    <span className="nudge-icon" aria-hidden="true">{current.icon}</span>
                    <span className="nudge-text">{current.text}</span>
                    {current.action && (
                        <button className="nudge-action" onClick={() => { current.action.onClick(); dismiss(); }}>{current.action.label}</button>
                    )}
                    <button className="nudge-close" aria-label="Close" onClick={dismiss}>×</button>
                    <span className="nudge-timer" style={{ animationDuration: `${NUDGE_MS}ms` }} />
                </div>
            )}
        </PortalContext.Provider>
    );
};
