import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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

export const PortalProvider = ({ children }) => {
    const { user, socket } = useAuth();
    const navigate = useNavigate();
    const [cfg, setCfg] = useState(null);
    const [current, setCurrent] = useState(null);
    const timer = useRef();

    const refresh = useCallback(() => getPortalConfig().then(r => {
        setCfg(r.data);
    }).catch(() => {}), []);
    useEffect(() => { refresh(); }, [refresh, user?._id]);

    const show = useCallback((key) => {
        const v = cfg?.show?.[key];
        return v === undefined ? (DEFAULT_SHOW[key] ?? true) : v !== false;
    }, [cfg]);

    // One reminder at a time; each kind at most once per visit; hides itself after 5 seconds.
    // A reminder that arrives while another is showing is dropped, never queued; an important one
    // (an order cancelled by staff) replaces it and stays a little longer.
    const nudge = useCallback(({ kind, icon = '✨', text, action, important = false }) => {
        if (!text) return;
        try {
            if (sessionStorage.getItem(`nudged:${kind}`)) return;
            sessionStorage.setItem(`nudged:${kind}`, '1');
        } catch { /* storage unavailable: still show it */ }
        setCurrent(prev => {
            if (prev && !important) return prev;
            clearTimeout(timer.current);
            const ms = important ? NUDGE_MS * 2 : NUDGE_MS;
            timer.current = setTimeout(() => setCurrent(null), ms);
            return { kind, icon, text, action, important, ms, id: Date.now() };
        });
    }, []);

    // Staff cancelled one of this customer's orders: tell them wherever they are in the app
    useEffect(() => {
        if (!socket || user?.role !== 'customer') return undefined;
        const onUpdate = (order) => {
            if (order?.status !== 'cancelled' || order.user?._id !== user._id) return;
            if (window.location.pathname === `/order/${order._id}`) return; // that page shows it in full
            nudge({
                kind: `cancelled-${order._id}`, icon: '⚠️', important: true,
                text: `Order ${order.orderNumber} was cancelled by the cafe.`,
                action: { label: 'View', onClick: () => navigate(`/order/${order._id}`) },
            });
        };
        socket.on('my-order-updated', onUpdate);
        return () => socket.off('my-order-updated', onUpdate);
    }, [socket, user?._id, user?.role, nudge, navigate]);
    const dismiss = () => { clearTimeout(timer.current); setCurrent(null); };
    useEffect(() => () => clearTimeout(timer.current), []);

    return (
        <PortalContext.Provider value={{ cfg, show, nudge, refresh }}>
            {children}
            {current && (
                <div className={`nudge ${current.important ? 'important' : ''}`} role={current.important ? 'alert' : 'status'} key={current.id}>
                    <span className="nudge-icon" aria-hidden="true">{current.icon}</span>
                    <span className="nudge-text">{current.text}</span>
                    {current.action && (
                        <button className="nudge-action" onClick={() => { current.action.onClick(); dismiss(); }}>{current.action.label}</button>
                    )}
                    <button className="nudge-close" aria-label="Close" onClick={dismiss}>×</button>
                    <span className="nudge-timer" style={{ animationDuration: `${current.ms}ms` }} />
                </div>
            )}
        </PortalContext.Provider>
    );
};
