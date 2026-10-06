import React from 'react';
import { FiChevronRight } from 'react-icons/fi';
import useCxLang, { T } from '../../lib/cxLang';
import Art from './Art';
import { LangChips } from './LangPicker';
import './Journey.css';

const W = {
    table: T('Table {n}', 'टेबल {n}', 'Table {n}'),
    head1: T('Good coffee,', 'अच्छी कॉफ़ी,', 'Achhi coffee,'),
    head2: T('made just for you', 'सिर्फ़ आपके लिए', 'sirf aapke liye'),
    line: T('Order from your table. Pay your way. Collect points on every cup.',
        'अपनी टेबल से ऑर्डर करें। जैसे चाहें पेमेंट करें। हर कप पर पॉइंट पाएँ।',
        'Apni table se order karo. Jaise chaho pay karo. Har cup pe points pao.'),
    start: T('Start ordering', 'ऑर्डर शुरू करें', 'Order shuru karo'),
};

// Coffee beans floating behind the welcome screens (drawn, not emojis)
const BEANS = [[18, 12, 26, 20], [78, 8, 20, -30], [8, 48, 18, 50], [84, 40, 30, 10], [62, 22, 14, 70]];
export const Beans = () => (
    <div className="cxj-beans" aria-hidden="true">
        {BEANS.map(([x, y, s, r], i) => (
            <span key={i} style={{ left: `${x}%`, top: `${y}%`, width: s, '--r': `${r}deg`, animationDelay: `${i * -1.3}s` }}>
                <Art kind="bean" />
            </span>
        ))}
    </div>
);

const TableIcon = () => (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <path d="M3 8h18M5 8v12M19 8v12M8 8V5h8v3" />
    </svg>
);

// First scan, not signed in yet: the table is already known from the QR; the customer picks a language here
const Welcome = ({ tableNumber, cafeName, onStart }) => {
    const { t } = useCxLang();
    return (
        <div className="cxj-wel">
            <Beans />
            <div className="cxj-wel-art"><Art kind="frappe" className="cxj-float" /></div>
            <div className="cxj-wel-panel">
                {(tableNumber || cafeName) && (
                    <span className="cxj-tbl cx-glass">
                        <TableIcon />
                        {[tableNumber ? t(W.table, { n: tableNumber }) : '', cafeName].filter(Boolean).join(' · ')}
                    </span>
                )}
                <h1 className="cxj-h">{t(W.head1)}<br />{t(W.head2)}</h1>
                <p className="cxj-mu">{t(W.line)}</p>
                <LangChips className="cxj-langs" />
                <button type="button" className="cxj-btn" onClick={onStart}>
                    {t(W.start)} <FiChevronRight aria-hidden="true" />
                </button>
            </div>
        </div>
    );
};

export default Welcome;
