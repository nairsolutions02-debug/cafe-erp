import React, { useEffect, useState } from 'react';
import { getStockMoves, getStock } from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import { MOVE_KINDS, fmtDateTime, fmtMoney, fmtQty } from './shared';

// The stock ledger: every change of stock, newest first. Nothing here can be edited.
const MovesTab = ({ locations }) => {
    const { hasPerm } = useAuth();
    const seeCost = hasPerm('sensitive.see_cost');
    const [items, setItems] = useState([]);
    const [filters, setFilters] = useState({ itemId: '', kind: '', locationId: '', from: '', to: '' });
    const [rows, setRows] = useState([]);
    const set = (k, v) => setFilters(f => ({ ...f, [k]: v }));

    useEffect(() => { getStock().then(r => setItems(r.data)); }, []);
    useEffect(() => { getStockMoves({ ...filters, limit: 300 }).then(r => setRows(r.data)); }, [filters]);

    return (
        <div>
            <div className="inv-toolbar">
                <select className="input compact" value={filters.itemId} onChange={e => set('itemId', e.target.value)} aria-label="Item">
                    <option value="">All items</option>
                    {items.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>
                <select className="input compact" value={filters.kind} onChange={e => set('kind', e.target.value)} aria-label="Type">
                    <option value="">All types</option>
                    {['purchase', 'sale', 'transfer', 'wastage', 'staff_meal', 'complimentary', 'adjustment', 'count', 'opening']
                        .map(k => <option key={k} value={k}>{MOVE_KINDS[k]}</option>)}
                </select>
                <select className="input compact" value={filters.locationId} onChange={e => set('locationId', e.target.value)} aria-label="Location">
                    <option value="">All locations</option>
                    {locations.map(l => <option key={l._id} value={l._id}>{l.name}</option>)}
                </select>
                <input className="input compact" type="date" value={filters.from} onChange={e => set('from', e.target.value)} aria-label="From" />
                <input className="input compact" type="date" value={filters.to} onChange={e => set('to', e.target.value)} aria-label="To" />
            </div>
            <div className="table-scroll">
                <table className="staff-table">
                    <thead>
                        <tr><th>When</th><th>Item</th><th>Location</th><th>Type</th><th>Qty</th>{seeCost && <th>Value</th>}<th>Details</th><th>By</th></tr>
                    </thead>
                    <tbody>
                        {rows.map(m => (
                            <tr key={m.id}>
                                <td className="small">{fmtDateTime(m.createdAt)}</td>
                                <td><strong>{m.item}</strong></td>
                                <td>{m.location}</td>
                                <td><span className={`kind kind-${m.kind}`}>{MOVE_KINDS[m.kind] || m.kind}</span></td>
                                <td className={m.quantity < 0 ? 'neg' : 'pos'}>{m.quantity > 0 ? '+' : ''}{fmtQty(m.quantity, m.unit)}</td>
                                {seeCost && <td>{fmtMoney(m.value)}</td>}
                                <td className="small">
                                    {[m.orderNumber, m.reason, m.note].filter(Boolean).join(' · ')}
                                    {m.photoUrl && <> · <a href={m.photoUrl} target="_blank" rel="noopener noreferrer">photo</a></>}
                                </td>
                                <td className="small">{m.by}</td>
                            </tr>
                        ))}
                        {rows.length === 0 && <tr><td colSpan={8} className="empty muted">No stock movements match.</td></tr>}
                    </tbody>
                </table>
            </div>
            {rows.length >= 300 && <p className="muted small">Showing the latest 300. Narrow the dates or pick an item to see more.</p>}
        </div>
    );
};

export default MovesTab;
