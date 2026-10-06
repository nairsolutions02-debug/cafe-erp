import React, { useEffect, useRef, useState } from 'react';
import { FiMapPin, FiShoppingBag } from 'react-icons/fi';
import { usePortal } from '../../context/PortalContext';
import { clearQrTable, useQrTable } from '../../lib/qrTable';
import useCxLang, { T } from '../../lib/cxLang';

const W = {
    table: T('Table {n}', 'टेबल {n}', 'Table {n}'),
    tableWord: T('Table ', 'टेबल ', 'Table '),
    orderingFor: T("You're ordering for Table {n}", 'आप टेबल {n} के लिए ऑर्डर कर रहे हैं', 'Aap Table {n} ke liye order kar rahe ho'),
    sharing: T('Sharing the table? Everyone can scan this QR and order on their own phone. Each person gets their own bill.',
        'टेबल शेयर कर रहे हैं? सब लोग यही QR स्कैन करके अपने फ़ोन से ऑर्डर कर सकते हैं। हर किसी का बिल अलग बनेगा।',
        'Table share kar rahe ho? Sab log yahi QR scan karke apne phone se order kar sakte hain. Sabka bill alag banega.'),
    wrong: T('Wrong table? Scan the QR on your table, or ask the staff.',
        'गलत टेबल? अपनी टेबल का QR स्कैन करें, या स्टाफ़ से पूछें।',
        'Galat table? Apni table ka QR scan karo, ya staff se pucho.'),
    takeawayNudge: T('Takeaway it is. Collect your order at the counter.',
        'ठीक है, पार्सल। अपना ऑर्डर काउंटर से ले लें।',
        'Theek hai, parcel. Apna order counter se le lo.'),
    takeaway: T('Takeaway instead', 'इसकी जगह पार्सल', 'Iski jagah parcel'),
};

// "Table 5" in the header, from the scanned QR. Tap for: sharing explained, wrong table, takeaway instead.
const TableChip = () => {
    const { cfg, nudge } = usePortal();
    const table = useQrTable();
    const { t } = useCxLang();
    const [open, setOpen] = useState(false);
    const ref = useRef();
    useEffect(() => {
        if (!open) return undefined;
        const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
        document.addEventListener('pointerdown', close);
        return () => document.removeEventListener('pointerdown', close);
    }, [open]);
    if (!table || cfg?.tables?.mode === 'none') return null;
    return (
        <div className="table-chip-wrap" ref={ref}>
            <button className="table-chip" aria-label={t(W.table, { n: table.tableNumber })} onClick={() => setOpen(o => !o)} aria-expanded={open}>
                <span className="pulse-dot" aria-hidden="true" /> <FiMapPin /> <span className="tc-word">{t(W.tableWord)}</span>{table.tableNumber}
            </button>
            {open && (
                <div className="table-pop" role="dialog" aria-label={t(W.table, { n: table.tableNumber })}>
                    <strong>{t(W.orderingFor, { n: table.tableNumber })}</strong>
                    <p>{t(W.sharing)}</p>
                    <p className="muted">{t(W.wrong)}</p>
                    <button className="btn btn-ghost btn-sm" onClick={() => {
                        clearQrTable();
                        setOpen(false);
                        nudge({ kind: 'takeaway', icon: '🛍️', text: t(W.takeawayNudge) });
                    }}><FiShoppingBag /> {t(W.takeaway)}</button>
                </div>
            )}
        </div>
    );
};

export default TableChip;
