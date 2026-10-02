import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    FiPlus, FiEdit2, FiMinusCircle, FiRepeat, FiSliders, FiPieChart, FiTrash2, FiShoppingCart, FiCoffee, FiGift,
} from 'react-icons/fi';
import { getStock, deleteStockItem, getSettings } from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import Modal from './Modal';
import { ItemForm, StockChangeForm, TransferForm, UsageView } from './StockForms';
import {
    CATEGORIES, categoryLabel, errorText, fmtMoney, fmtQty, fmtUnitCost, reorderReason, stockStatus, suggestedOrder, whatsappLink,
} from './shared';

// Reorder list grouped by vendor, with a WhatsApp order message per vendor
const ReorderList = ({ items, onClose }) => {
    const [cafe, setCafe] = useState('');
    useEffect(() => { getSettings().then(r => setCafe(r.data.restaurant_name || '')).catch(() => {}); }, []);
    const groups = useMemo(() => {
        const g = new Map();
        items.forEach(i => {
            const key = i.vendorId || '';
            if (!g.has(key)) g.set(key, { name: i.vendorName || 'No vendor set', phone: i.vendorPhone, items: [] });
            g.get(key).items.push(i);
        });
        return [...g.values()];
    }, [items]);
    const message = (g) => [
        `Order from ${cafe || 'our cafe'}:`,
        ...g.items.map(i => `• ${i.name}: ${suggestedOrder(i)?.text || '-'}`),
        'Please confirm delivery time. Thank you.',
    ].join('\n');

    return (
        <Modal title={`Reorder list (${items.length})`} onClose={onClose} wide>
            <div className="modal-body">
                {groups.length === 0 && <p className="muted">Nothing to reorder right now.</p>}
                {groups.map(g => (
                    <section className="reorder-group" key={g.name}>
                        <div className="reorder-head">
                            <h3>{g.name}</h3>
                            {g.phone && <a className="btn btn-primary btn-sm" href={whatsappLink(g.phone, message(g))} target="_blank" rel="noopener noreferrer">Send on WhatsApp</a>}
                        </div>
                        <table className="staff-table">
                            <thead><tr><th>Item</th><th>Stock</th><th>Why</th><th>Suggested order</th></tr></thead>
                            <tbody>
                                {g.items.map(i => {
                                    const s = suggestedOrder(i);
                                    return (
                                        <tr key={i.id}>
                                            <td><strong>{i.name}</strong></td>
                                            <td>{fmtQty(i.totalQuantity, i.unit)}</td>
                                            <td className="muted small">{reorderReason(i)}</td>
                                            <td>{s ? <><strong>{s.text}</strong>{s.detail && <span className="muted"> ({s.detail})</span>}</> : '—'}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </section>
                ))}
                <p className="muted small">Suggested = daily use × (vendor lead time + order cycle), at least twice the reorder level, minus stock in hand.
                    Set lead time and order cycle per vendor in the Vendors tab.</p>
            </div>
        </Modal>
    );
};

const StockTab = ({ locations, vendors, q }) => {
    const { hasPerm } = useAuth();
    const seeCost = hasPerm('sensitive.see_cost');
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [locationId, setLocationId] = useState('');
    const [search, setSearch] = useState(q);
    const [filter, setFilter] = useState('active');
    const [modal, setModal] = useState(null);

    const load = useCallback(async () => {
        try {
            setItems((await getStock(locationId)).data);
        } finally {
            setLoading(false);
        }
    }, [locationId]);
    useEffect(() => { load(); }, [load]);

    const saved = () => { setModal(null); load(); };

    const shown = items.filter(i => {
        if (search && !i.name.toLowerCase().includes(search.toLowerCase()) && !(i.sku || '').toLowerCase().includes(search.toLowerCase())) return false;
        if (filter === 'active') return i.isActive;
        if (filter === 'reorder') return i.reorder;
        if (filter === 'inactive') return !i.isActive;
        if (filter === 'unused') return i.isActive && i.usedIn === 0 && i.category === 'ingredient';
        if (CATEGORIES.some(c => c.value === filter)) return i.isActive && i.category === filter;
        return true;
    });
    const reorderItems = items.filter(i => i.reorder);
    const totalValue = items.reduce((a, i) => a + Number(i.value || 0), 0);

    const remove = async (item) => {
        if (!window.confirm(`Delete "${item.name}"? Items with stock history can only be made inactive.`)) return;
        try {
            await deleteStockItem(item.id);
            load();
        } catch (err) {
            alert(errorText(err, 'Could not delete'));
        }
    };

    return (
        <div>
            <div className="inv-toolbar">
                <input className="input search" placeholder="Search stock…" value={search} onChange={e => setSearch(e.target.value)} />
                <select className="input compact" value={locationId} onChange={e => setLocationId(e.target.value)} aria-label="Location">
                    <option value="">All locations</option>
                    {locations.map(l => <option key={l._id} value={l._id}>{l.name}</option>)}
                </select>
                <select className="input compact" value={filter} onChange={e => setFilter(e.target.value)} aria-label="Filter">
                    <option value="active">Active items</option>
                    <option value="reorder">Needs reorder</option>
                    {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                    <option value="unused">Ingredients in no recipe</option>
                    <option value="inactive">Inactive</option>
                    <option value="all">Everything</option>
                </select>
                <div className="spacer" />
                <button className={`btn ${reorderItems.length ? 'btn-secondary' : 'btn-ghost'}`} onClick={() => setModal({ type: 'reorder' })}>
                    <FiShoppingCart /> Reorder list{reorderItems.length ? ` (${reorderItems.length})` : ''}
                </button>
                {hasPerm('inventory.edit') && (
                    <button className="btn btn-ghost" onClick={() => setModal({ type: 'transfer' })}><FiRepeat /> Transfer</button>
                )}
                {hasPerm('inventory.create') && (
                    <button className="btn btn-primary" onClick={() => setModal({ type: 'item' })}><FiPlus /> Add item</button>
                )}
            </div>

            <div className="inv-summary">
                <span><strong>{items.filter(i => i.isActive).length}</strong> items</span>
                <span className={reorderItems.length ? 'warn' : ''}><strong>{reorderItems.length}</strong> to reorder</span>
                {seeCost && <span>Stock value <strong>{fmtMoney(totalValue, 0)}</strong></span>}
            </div>

            <div className="table-scroll">
                <table className="staff-table stock-table">
                    <thead>
                        <tr>
                            <th>Item</th>
                            <th>{locationId ? 'Here' : 'In stock'}</th>
                            <th>Daily use</th>
                            <th>Days left</th>
                            {seeCost && <th>Avg cost</th>}
                            {seeCost && <th>Value</th>}
                            <th>Status</th>
                            <th aria-label="Actions" />
                        </tr>
                    </thead>
                    <tbody>
                        {shown.map(i => {
                            const st = stockStatus(i);
                            return (
                                <tr key={i.id} className={i.isActive ? '' : 'inactive'}>
                                    <td>
                                        <strong>{i.name}</strong>
                                        <div className="muted small">{categoryLabel(i.category)}{i.vendorName ? ` · ${i.vendorName}` : ''}{i.usedIn ? ` · in ${i.usedIn} recipe${i.usedIn > 1 ? 's' : ''}` : ''}</div>
                                    </td>
                                    <td>
                                        <strong className={Number(i.quantity) < 0 ? 'neg' : ''}>{fmtQty(i.quantity, i.unit)}</strong>
                                        {!locationId && i.levels.length > 1 && (
                                            <div className="muted small">{i.levels.map(l => `${l.name} ${fmtQty(l.quantity, i.unit)}`).join(' · ')}</div>
                                        )}
                                        {!locationId && i.levels.length === 1 && <div className="muted small">{i.levels[0].name}</div>}
                                    </td>
                                    <td>{Number(i.dailyUse) > 0 ? fmtQty(i.dailyUse, i.unit) : <span className="muted">—</span>}</td>
                                    <td>{i.daysLeft != null ? i.daysLeft : <span className="muted">—</span>}</td>
                                    {seeCost && <td className="small">{fmtUnitCost(i.avgCost, i.unit)}</td>}
                                    {seeCost && <td>{fmtMoney(i.value, 0)}</td>}
                                    <td><span className={`pill ${st.tone}`} title={st.hint || (i.reorder ? reorderReason(i) : '')}>{st.label}</span></td>
                                    <td>
                                        <span className="row-actions">
                                            {hasPerm('inventory.create') && i.trackStock && (
                                                <>
                                                    <button className="icon-btn" title="Wastage" aria-label={`Wastage ${i.name}`} onClick={() => setModal({ type: 'change', kind: 'wastage', item: i })}><FiMinusCircle /></button>
                                                    <button className="icon-btn" title="Staff meal" aria-label={`Staff meal ${i.name}`} onClick={() => setModal({ type: 'change', kind: 'staff_meal', item: i })}><FiCoffee /></button>
                                                    <button className="icon-btn" title="Complimentary" aria-label={`Complimentary ${i.name}`} onClick={() => setModal({ type: 'change', kind: 'complimentary', item: i })}><FiGift /></button>
                                                </>
                                            )}
                                            {hasPerm('inventory.edit') && i.trackStock && (
                                                <>
                                                    <button className="icon-btn" title="Transfer" aria-label={`Transfer ${i.name}`} onClick={() => setModal({ type: 'transfer', item: i })}><FiRepeat /></button>
                                                    <button className="icon-btn" title="Correct stock" aria-label={`Correct ${i.name}`} onClick={() => setModal({ type: 'change', kind: 'adjustment', item: i })}><FiSliders /></button>
                                                </>
                                            )}
                                            <button className="icon-btn" title="Where it went" aria-label={`Usage ${i.name}`} onClick={() => setModal({ type: 'usage', item: i })}><FiPieChart /></button>
                                            {hasPerm('inventory.edit') && (
                                                <button className="icon-btn" title="Edit" aria-label={`Edit ${i.name}`} onClick={() => setModal({ type: 'item', item: i })}><FiEdit2 /></button>
                                            )}
                                            {hasPerm('inventory.delete') && (
                                                <button className="icon-btn delete" title="Delete" aria-label={`Delete ${i.name}`} onClick={() => remove(i)}><FiTrash2 /></button>
                                            )}
                                        </span>
                                    </td>
                                </tr>
                            );
                        })}
                        {!loading && shown.length === 0 && (
                            <tr><td colSpan={8} className="empty muted">
                                {items.length === 0 ? 'No stock items yet. Add ingredients (milk, beans…) and resale products, then link them in Recipes.' : 'Nothing matches.'}
                            </td></tr>
                        )}
                    </tbody>
                </table>
            </div>

            {modal?.type === 'item' && <ItemForm item={modal.item} locations={locations} vendors={vendors} onClose={() => setModal(null)} onSaved={saved} />}
            {modal?.type === 'change' && <StockChangeForm item={modal.item} kind={modal.kind} locations={locations} onClose={() => setModal(null)} onSaved={saved} />}
            {modal?.type === 'transfer' && <TransferForm items={items} startItem={modal.item} locations={locations} onClose={() => setModal(null)} onSaved={saved} />}
            {modal?.type === 'usage' && <UsageView item={modal.item} onClose={() => setModal(null)} />}
            {modal?.type === 'reorder' && <ReorderList items={reorderItems} onClose={() => setModal(null)} />}
        </div>
    );
};

export default StockTab;
