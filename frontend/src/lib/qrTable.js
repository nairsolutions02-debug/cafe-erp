// Table number from a scanned QR code (https://cafe.example/?table=5),
// remembered for a few hours so the cart can preselect it.
const KEY = 'qrTable';
const TTL_MS = 6 * 60 * 60 * 1000;

export const captureQrTable = () => {
    try {
        const table = new URLSearchParams(window.location.search).get('table');
        if (table) localStorage.setItem(KEY, JSON.stringify({ table: table.trim(), at: Date.now() }));
    } catch { /* storage unavailable */ }
};

export const getQrTable = () => {
    try {
        const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
        if (saved && Date.now() - saved.at < TTL_MS) return saved.table;
    } catch { /* storage unavailable */ }
    return null;
};

export const tableQrUrl = (tableNumber) =>
    `${window.location.origin}/?table=${encodeURIComponent(tableNumber)}`;
