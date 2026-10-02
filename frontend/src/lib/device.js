// This device's short code (C1, K1, D1…) used in offline order numbers, and a local
// copy of data the counter needs when the internet drops.
import { registerDevice } from '../utils/api';

const DEVICE_KEY = 'cafe-device-v1';
const SEQ_KEY = 'cafe-order-seq-v1';

export const getDevice = (kind) => {
    try {
        const all = JSON.parse(localStorage.getItem(DEVICE_KEY)) || {};
        return all[kind] || null;
    } catch {
        return null;
    }
};

const inFlight = {};

export async function ensureDevice(kind, name) {
    const existing = getDevice(kind);
    if (existing) return existing;
    if (!inFlight[kind]) inFlight[kind] = registerDevice(kind, name).finally(() => { delete inFlight[kind]; });
    const res = await inFlight[kind];
    if (getDevice(kind)) return getDevice(kind);
    try {
        const all = JSON.parse(localStorage.getItem(DEVICE_KEY)) || {};
        all[kind] = res.data;
        localStorage.setItem(DEVICE_KEY, JSON.stringify(all));
    } catch { /* storage blocked: a new code is issued next time */ }
    return res.data;
}

export const forgetDevice = (kind) => {
    try {
        const all = JSON.parse(localStorage.getItem(DEVICE_KEY)) || {};
        delete all[kind];
        localStorage.setItem(DEVICE_KEY, JSON.stringify(all));
    } catch { /* ignore */ }
};

// C1-261003-0007: device code, date, running number for the day on this device
export function nextOrderNumber(code) {
    const d = new Date();
    const ymd = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    let seq = { date: ymd, n: 0 };
    try { seq = JSON.parse(localStorage.getItem(`${SEQ_KEY}:${code}`)) || seq; } catch { /* ignore */ }
    if (seq.date !== ymd) seq = { date: ymd, n: 0 };
    seq.n += 1;
    try { localStorage.setItem(`${SEQ_KEY}:${code}`, JSON.stringify(seq)); } catch { /* ignore */ }
    return { orderNumber: `${code}-${ymd}-${String(seq.n).padStart(4, '0')}`, token: String(seq.n) };
}

export const cacheSet = (key, value) => {
    try { localStorage.setItem(`cafe-cache:${key}`, JSON.stringify({ at: Date.now(), value })); } catch { /* ignore */ }
};
export const cacheGet = (key) => {
    try { return JSON.parse(localStorage.getItem(`cafe-cache:${key}`))?.value ?? null; } catch { return null; }
};
