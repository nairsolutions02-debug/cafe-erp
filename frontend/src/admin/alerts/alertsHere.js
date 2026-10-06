// This device can turn the full-screen alert off (e.g. the kitchen TV); alerts then only ring briefly and show on the bell
const HERE_KEY = 'order-alerts-here';
export const fullScreenAlertsHere = () => { try { return localStorage.getItem(HERE_KEY) !== 'off'; } catch { return true; } };
export const setFullScreenAlertsHere = (on) => { try { localStorage.setItem(HERE_KEY, on ? 'on' : 'off'); } catch { /* private mode */ } };
