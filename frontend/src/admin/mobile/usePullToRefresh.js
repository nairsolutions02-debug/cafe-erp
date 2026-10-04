import { useEffect, useRef, useState } from 'react';

const LIMIT = 110;
const TRIGGER = 70;

// Pull down at the top of the page to reload it (phone only). Ignores pulls that start in a form
// field, a dialog or a horizontal scroller, and anything while the page itself is scrolled.
export default function usePullToRefresh(enabled, onRefresh) {
    const [pull, setPull] = useState(0);
    const [busy, setBusy] = useState(false);
    const start = useRef(null);
    const pullRef = useRef(0);
    const refresh = useRef(onRefresh);
    useEffect(() => { refresh.current = onRefresh; }, [onRefresh]);

    useEffect(() => {
        if (!enabled) return undefined;
        const set = (v) => { pullRef.current = v; setPull(v); };
        const onStart = (e) => {
            if (window.scrollY > 0 || e.touches.length !== 1) return;
            const t = e.target;
            if (t.closest?.('input, textarea, select, [role="dialog"], .modal, .modal-overlay, .sheet, .gs-overlay')) return;
            start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        };
        const onMove = (e) => {
            if (!start.current) return;
            const dy = e.touches[0].clientY - start.current.y;
            const dx = Math.abs(e.touches[0].clientX - start.current.x);
            if (dy <= 0 || dx > dy || window.scrollY > 0) { start.current = null; set(0); return; }
            set(Math.min(LIMIT, dy * 0.5));
        };
        const onEnd = () => {
            if (!start.current) return;
            start.current = null;
            if (pullRef.current >= TRIGGER) {
                setBusy(true);
                set(48);
                Promise.resolve(refresh.current()).finally(() => setTimeout(() => { setBusy(false); set(0); }, 450));
            } else set(0);
        };
        window.addEventListener('touchstart', onStart, { passive: true });
        window.addEventListener('touchmove', onMove, { passive: true });
        window.addEventListener('touchend', onEnd);
        window.addEventListener('touchcancel', onEnd);
        return () => {
            window.removeEventListener('touchstart', onStart);
            window.removeEventListener('touchmove', onMove);
            window.removeEventListener('touchend', onEnd);
            window.removeEventListener('touchcancel', onEnd);
        };
    }, [enabled]);

    return { pull, busy, ready: pull >= TRIGGER };
}
