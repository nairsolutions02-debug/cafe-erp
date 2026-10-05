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
    screen: T('Screen colours', 'स्क्रीन के रंग', 'Screen ke rang'),
    screenNote: T('Auto follows the phone setting. The sun / moon button at the top switches in one tap. The Kitchen has its own button; the Kiosk stays light for customers.',
        'अपने-आप फ़ोन की सेटिंग जैसा रहता है। ऊपर का सूरज / चाँद बटन एक टैप में बदलता है। किचन का अपना बटन है; कियोस्क ग्राहकों के लिए लाइट रहता है।',
        'Auto phone ki setting follow karta hai. Upar ka suraj / chaand button ek tap mein badalta hai. Kitchen ka apna button hai; Kiosk customers ke liye light rehta hai.'),
    toDark: T('Switch to dark screen', 'डार्क स्क्रीन करें', 'Dark screen karo'),
    toLight: T('Switch to light screen', 'लाइट स्क्रीन करें', 'Light screen karo'),
    auto: T('Auto', 'अपने-आप', 'Auto'),
    dark: T('Dark', 'डार्क', 'Dark'),
    light: T('Light', 'लाइट', 'Light'),
    allPages: T('All pages', 'सभी पेज', 'Saare page'),
};
