import { useEffect, useState } from 'react';

const read = () => {
    try { return localStorage.getItem('menuLang') || 'en'; } catch { return 'en'; }
};

// The admin menu language (en / hi / hinglish); follows changes made in the side menu or More page.
// t({ en, hi, hinglish }) picks the right words.
export default function useMenuLang() {
    const [lang, setLang] = useState(read);
    useEffect(() => {
        const sync = () => setLang(read());
        window.addEventListener('menulang', sync);
        return () => window.removeEventListener('menulang', sync);
    }, []);
    const t = (w) => (w && typeof w === 'object' ? w[lang] || w.en : w);
    return { lang, t };
}

// "T5" for table 5; a table named in words keeps its name
export const tableToken = (n) => (/^\d+$/.test(String(n)) ? `T${n}` : String(n));
