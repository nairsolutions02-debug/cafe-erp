// The customer's name and mobile, remembered on this phone ('cx-me'). If the sign-in is lost (iPhone Safari clears
// website data after about 7 days without a visit, a new browser, cleared data), the sign-in screen opens with
// "Welcome back, Pravin?" and one tap signs them in again. The same number is the same account on the server.
const KEY = 'cx-me';

export const readMe = () => {
    try {
        const me = JSON.parse(localStorage.getItem(KEY) || 'null');
        if (me && typeof me.name === 'string' && me.name.trim() && /^[6-9]\d{9}$/.test(me.phone || '')) return me;
    } catch { /* storage blocked */ }
    return null;
};

export const saveMe = ({ name, phone }) => {
    const n = String(name || '').trim();
    const p = String(phone || '').replace(/\D/g, '').slice(-10);
    if (!n || !/^[6-9]\d{9}$/.test(p)) return;
    try { localStorage.setItem(KEY, JSON.stringify({ name: n, phone: p, at: Date.now() })); } catch { /* storage blocked */ }
};

export const forgetMe = () => {
    try { localStorage.removeItem(KEY); } catch { /* storage blocked */ }
};

// 98271 •••••
export const maskPhone = (p) => (p ? `${String(p).slice(0, 5)} •••••` : '');
