import React, { useEffect, useRef, useState } from 'react';
import { FiMapPin, FiShoppingBag } from 'react-icons/fi';
import { usePortal } from '../../context/PortalContext';
import { clearQrTable, useQrTable } from '../../lib/qrTable';

// "Table 5" in the header, from the scanned QR. Tap for: sharing explained, wrong table, takeaway instead.
const TableChip = () => {
    const { cfg, nudge } = usePortal();
    const table = useQrTable();
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
            <button className="table-chip" aria-label={`Table ${table.tableNumber}`} onClick={() => setOpen(o => !o)} aria-expanded={open}>
                <span className="pulse-dot" aria-hidden="true" /> <FiMapPin /> <span className="tc-word">Table </span>{table.tableNumber}
            </button>
            {open && (
                <div className="table-pop" role="dialog" aria-label={`Table ${table.tableNumber}`}>
                    <strong>You're ordering for Table {table.tableNumber}</strong>
                    <p>Sharing the table? Everyone can scan this QR and order on their own phone. Each person gets their own bill.</p>
                    <p className="muted">Wrong table? Scan the QR on your table, or ask the staff.</p>
                    <button className="btn btn-ghost btn-sm" onClick={() => {
                        clearQrTable();
                        setOpen(false);
                        nudge({ kind: 'takeaway', icon: '🛍️', text: 'Takeaway it is. Collect your order at the counter.' });
                    }}><FiShoppingBag /> Takeaway instead</button>
                </div>
            )}
        </div>
    );
};

export default TableChip;
