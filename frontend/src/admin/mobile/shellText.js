// Words used by the phone shell (header, bottom bar, More page) in the three menu languages
const T = (en, hi, hinglish) => ({ en, hi, hinglish });

export const SHELL = {
    more: T('More', 'और', 'Aur'),
    search: T('Search items, orders, customers', 'आइटम, ऑर्डर, ग्राहक खोजें', 'Item, order, customer dhoondo'),
    back: T('Back', 'वापस', 'Wapas'),
    pull: T('Pull down to refresh', 'रिफ्रेश के लिए नीचे खींचें', 'Refresh ke liye neeche kheecho'),
    release: T('Release to refresh', 'छोड़ें, रिफ्रेश होगा', 'Chhodo, refresh hoga'),
    refreshing: T('Refreshing…', 'रिफ्रेश हो रहा है…', 'Refresh ho raha hai…'),
    offline: T('Offline', 'इंटरनेट नहीं', 'Offline'),
    waiting: T('waiting', 'बाकी', 'baaki'),
    sending: T('Sending', 'भेज रहे', 'Bhej rahe'),
    language: T('Language', 'भाषा', 'Bhasha'),
    help: T('Help & support', 'मदद और सपोर्ट', 'Help aur support'),
    logout: T('Log out', 'लॉग आउट', 'Log out'),
    allPages: T('All pages', 'सभी पेज', 'Saare page'),
};
