import { useEffect, useState } from 'react';

// The table a customer is sitting at, from the QR they scanned (https://cafe.example/t/5-K7Q2).
// Remembered for a few hours, or until their bill is paid, so the next visit asks them to scan again.
const KEY = 'qrTable';
const TTL_MS = 3 * 60 * 60 * 1000;
const EVENT = 'qrtable-changed';

// Old printed QRs (https://cafe.example/?table=5) go through the same scan screen as table number "n:5"
export const captureQrTable = () => {
    try {
        const table = new URLSearchParams(window.location.search).get('table');
        if (table && !window.location.pathname.startsWith('/t/')) {
            window.history.replaceState(null, '', `/t/${encodeURIComponent(`n:${table.trim()}`)}`);
        }
    } catch { /* old browser */ }
};

export const getQrTable = () => {
    try {
        const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
        if (saved?.code && Date.now() - saved.at < TTL_MS) return saved;
    } catch { /* storage unavailable */ }
    return null;
};

export const saveQrTable = ({ code, tableNumber }) => {
    try { localStorage.setItem(KEY, JSON.stringify({ code, tableNumber, at: Date.now() })); } catch { /* storage unavailable */ }
    window.dispatchEvent(new Event(EVENT));
};

export const clearQrTable = () => {
    try { localStorage.removeItem(KEY); } catch { /* storage unavailable */ }
    window.dispatchEvent(new Event(EVENT));
};

// React: the current table, updating when it changes anywhere in the app
export const useQrTable = () => {
    const [table, setTable] = useState(getQrTable);
    useEffect(() => {
        const update = () => setTable(getQrTable());
        window.addEventListener(EVENT, update);
        window.addEventListener('storage', update);
        return () => { window.removeEventListener(EVENT, update); window.removeEventListener('storage', update); };
    }, []);
    return table;
};

export const tableQrUrl = (code) => `${window.location.origin}/t/${encodeURIComponent(code)}`;
