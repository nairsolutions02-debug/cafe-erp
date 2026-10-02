import React, { useEffect, useState } from 'react';
import { FiPlus, FiTrash2 } from 'react-icons/fi';
import {
    saveStockItem, recordStockChange, transferStock, getUsage, uploadStockPhoto,
} from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import Modal from './Modal';
import {
    CATEGORIES, COUNT_FREQUENCIES, UNITS, WASTAGE_REASONS, errorText, fmtQty, unitOptions, fmtUnitCost,
} from './shared';

const blankItem = { name: '', category: 'ingredient', unit: 'g', minimumStock: '', vendorId: '', countFrequency: 'weekly',
    shelfOrder: '', sku: '', trackStock: true, isActive: true, units: [], openingStock: '', avgCost: '', locationId: '' };

// Add / edit a stock item. Costs are typed per base unit; for g and ml the form takes ₹ per kg / L.
export const ItemForm = ({ item, locations, vendors, onClose, onSaved }) => {
    const { hasPerm } = useAuth();
    const seeCost = hasPerm('sensitive.see_cost');
    const isNew = !item?.id;
    const bulk = (u) => (u === 'g' || u === 'ml' ? 1000 : 1);
    const [form, setForm] = useState(() => isNew ? { ...blankItem } : {
        ...blankItem, ...item, vendorId: item.vendorId || '', minimumStock: item.minimumStock ?? '',
        units: (item.units || []).map(u => ({ name: u.name, factor: u.factor })),
        avgCost: item.avgCost != null ? +(item.avgCost * bulk(item.unit)).toFixed(4) : '',
    });
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);
    const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
    const costLabel = form.unit === 'g' ? '₹ per kg' : form.unit === 'ml' ? '₹ per litre' : `₹ per ${form.unit || 'unit'}`;

    const submit = async (e) => {
        e.preventDefault();
        setSaving(true);
        setError('');
        try {
            const payload = {
                id: item?.id, name: form.name, category: form.category, unit: form.unit, minimumStock: form.minimumStock || 0,
                vendorId: form.vendorId, countFrequency: form.countFrequency, shelfOrder: form.shelfOrder || 0, sku: form.sku,
                trackStock: form.trackStock, isActive: form.isActive,
                units: form.units.filter(u => u.name && Number(u.factor) > 0),
            };
            if (seeCost && form.avgCost !== '') payload.avgCost = Number(form.avgCost) / bulk(form.unit);
            if (isNew) {
                payload.openingStock = form.openingStock || 0;
                payload.locationId = form.locationId;
            }
            await saveStockItem(payload);
            onSaved();
        } catch (err) {
            setError(errorText(err, 'Could not save'));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal title={isNew ? 'Add stock item' : `Edit ${item.name}`} onClose={onClose} wide>
            <form onSubmit={submit}>
                <div className="modal-body form-grid">
                    <div className="input-group span-2">
                        <label>Name *</label>
                        <input className="input" value={form.name} onChange={e => set('name', e.target.value)} required autoFocus />
                    </div>
                    <div className="input-group">
                        <label>Type</label>
                        <select className="input" value={form.category}
                            onChange={e => setForm(f => ({ ...f, category: e.target.value, trackStock: e.target.value !== 'packaging' && f.trackStock }))}>
                            {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                        </select>
                    </div>
                    <div className="input-group">
                        <label>Base unit * <span className="hint">recipes and counts use this</span></label>
                        <input className="input" list="stock-units" value={form.unit} onChange={e => set('unit', e.target.value.trim())} required />
                        <datalist id="stock-units">{UNITS.map(u => <option key={u} value={u} />)}</datalist>
                    </div>
                    <div className="input-group">
                        <label>Reorder level ({form.unit || 'unit'})</label>
                        <input className="input" type="number" min="0" step="any" value={form.minimumStock} onChange={e => set('minimumStock', e.target.value)} placeholder="0 = use daily usage only" />
                    </div>
                    <div className="input-group">
                        <label>Usual vendor</label>
                        <select className="input" value={form.vendorId} onChange={e => set('vendorId', e.target.value)}>
                            <option value="">—</option>
                            {vendors.filter(v => v.isActive || v.id === form.vendorId).map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                        </select>
                    </div>
                    <div className="input-group">
                        <label>Count</label>
                        <select className="input" value={form.countFrequency} onChange={e => set('countFrequency', e.target.value)}>
                            {COUNT_FREQUENCIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                        </select>
                    </div>
                    <div className="input-group">
                        <label>Shelf order <span className="hint">count sheet order</span></label>
                        <input className="input" type="number" value={form.shelfOrder} onChange={e => set('shelfOrder', e.target.value)} />
                    </div>
                    {seeCost && (
                        <div className="input-group">
                            <label>{isNew ? 'Cost' : 'Average cost'} ({costLabel})</label>
                            <input className="input" type="number" min="0" step="any" value={form.avgCost} onChange={e => set('avgCost', e.target.value)} />
                            {!isNew && <small className="hint">Purchases update this automatically. A change here is logged.</small>}
                        </div>
                    )}
                    <div className="input-group">
                        <label>SKU / code</label>
                        <input className="input" value={form.sku} onChange={e => set('sku', e.target.value)} />
                    </div>
                    {isNew && (
                        <>
                            <div className="input-group">
                                <label>Opening stock ({form.unit || 'unit'})</label>
                                <input className="input" type="number" step="any" value={form.openingStock} onChange={e => set('openingStock', e.target.value)} placeholder="0" />
                            </div>
                            <div className="input-group">
                                <label>Opening stock is at</label>
                                <select className="input" value={form.locationId} onChange={e => set('locationId', e.target.value)}>
                                    <option value="">Purchase location</option>
                                    {locations.filter(l => l.isActive).map(l => <option key={l._id} value={l._id}>{l.name}</option>)}
                                </select>
                            </div>
                        </>
                    )}
                    <div className="input-group span-2">
                        <label>Pack units <span className="hint">e.g. Litre = 1000 (ml), Crate = 24 (pc), Carton = 100 (pc)</span></label>
                        {form.units.map((u, i) => (
                            <div className="unit-line" key={i}>
                                <input className="input" placeholder="Name" value={u.name}
                                    onChange={e => set('units', form.units.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
                                <span>=</span>
                                <input className="input" type="number" min="0" step="any" placeholder="how many" value={u.factor}
                                    onChange={e => set('units', form.units.map((x, j) => j === i ? { ...x, factor: e.target.value } : x))} />
                                <span>{form.unit}</span>
                                <button type="button" className="icon-btn delete" aria-label="Remove unit" onClick={() => set('units', form.units.filter((_, j) => j !== i))}><FiTrash2 /></button>
                            </div>
                        ))}
                        <button type="button" className="link-btn" onClick={() => set('units', [...form.units, { name: '', factor: '' }])}><FiPlus /> Add pack unit</button>
                    </div>
                    <label className="check span-2">
                        <input type="checkbox" checked={form.trackStock} onChange={e => set('trackStock', e.target.checked)} />
                        Track quantity (turn off for packaging bought in bulk and expensed)
                    </label>
                    {!isNew && (
                        <label className="check span-2">
                            <input type="checkbox" checked={form.isActive} onChange={e => set('isActive', e.target.checked)} />
                            Active (inactive items are hidden from counts and purchase lists)
                        </label>
                    )}
                    {error && <p className="error-message span-2">{error}</p>}
                </div>
                <div className="modal-footer">
                    <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
                    <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
                </div>
            </form>
        </Modal>
    );
};

const KIND_TITLES = {
    wastage: 'Record wastage',
    staff_meal: 'Record staff meal',
    complimentary: 'Record complimentary',
    adjustment: 'Correct stock',
};

// Wastage / staff meal / complimentary take stock out; adjustment sets the right quantity at a location
export const StockChangeForm = ({ item, kind, locations, onClose, onSaved }) => {
    const units = unitOptions(item);
    const levelAt = (id) => item.levels.find(l => l.locationId === id)?.quantity ?? 0;
    // Usually the kitchen/sales location; otherwise wherever the item is
    const salesLoc = locations.find(l => l.defaultForSales)?._id;
    const firstLoc = (salesLoc && levelAt(salesLoc) > 0 ? salesLoc : null)
        || item.levels.find(l => l.quantity > 0)?.locationId || salesLoc || locations[0]?._id || '';
    const [form, setForm] = useState({ locationId: firstLoc, quantity: '', factor: 1, newQuantity: '', reason: kind === 'wastage' ? WASTAGE_REASONS[0] : '', note: '' });
    const [photo, setPhoto] = useState(null);
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);
    const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

    const submit = async (e) => {
        e.preventDefault();
        setSaving(true);
        setError('');
        try {
            const photoUrl = photo ? await uploadStockPhoto(photo, 'stock') : '';
            const base = { kind, itemId: item.id, locationId: form.locationId, reason: form.reason, note: form.note, photoUrl };
            if (kind === 'adjustment') await recordStockChange({ ...base, newQuantity: Number(form.newQuantity) });
            else await recordStockChange({ ...base, quantity: Number(form.quantity) * Number(form.factor) });
            onSaved();
        } catch (err) {
            setError(errorText(err, 'Could not save'));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal title={`${KIND_TITLES[kind]}: ${item.name}`} onClose={onClose}>
            <form onSubmit={submit}>
                <div className="modal-body">
                    <div className="input-group">
                        <label>Location</label>
                        <select className="input" value={form.locationId} onChange={e => set('locationId', e.target.value)} required>
                            {locations.filter(l => l.isActive).map(l => (
                                <option key={l._id} value={l._id}>{l.name} · {fmtQty(levelAt(l._id), item.unit)}</option>
                            ))}
                        </select>
                    </div>
                    {kind === 'adjustment' ? (
                        <div className="input-group">
                            <label>Correct quantity at this location ({item.unit})</label>
                            <input className="input" type="number" step="any" min="0" value={form.newQuantity} onChange={e => set('newQuantity', e.target.value)} required autoFocus />
                            <small className="hint">Now {fmtQty(levelAt(form.locationId), item.unit)}. For a full shelf check use Counts instead.</small>
                        </div>
                    ) : (
                        <div className="input-group">
                            <label>Quantity</label>
                            <div className="qty-unit">
                                <input className="input" type="number" step="any" min="0" value={form.quantity} onChange={e => set('quantity', e.target.value)} required autoFocus />
                                <select className="input" value={form.factor} onChange={e => set('factor', e.target.value)}>
                                    {units.map(u => <option key={u.name} value={u.factor}>{u.name}</option>)}
                                </select>
                            </div>
                        </div>
                    )}
                    <div className="input-group">
                        <label>Reason {kind === 'adjustment' && '*'}</label>
                        {kind === 'wastage' ? (
                            <select className="input" value={form.reason} onChange={e => set('reason', e.target.value)}>
                                {WASTAGE_REASONS.map(r => <option key={r}>{r}</option>)}
                            </select>
                        ) : (
                            <input className="input" value={form.reason} onChange={e => set('reason', e.target.value)} required={kind === 'adjustment'}
                                placeholder={kind === 'adjustment' ? 'e.g. found extra stock, entry mistake' : 'optional'} />
                        )}
                    </div>
                    <div className="input-group">
                        <label>Note</label>
                        <input className="input" value={form.note} onChange={e => set('note', e.target.value)} />
                    </div>
                    {kind === 'wastage' && (
                        <div className="input-group">
                            <label>Photo (optional)</label>
                            <input type="file" accept="image/*" capture="environment" onChange={e => setPhoto(e.target.files[0] || null)} />
                        </div>
                    )}
                    {error && <p className="error-message">{error}</p>}
                </div>
                <div className="modal-footer">
                    <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
                    <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
                </div>
            </form>
        </Modal>
    );
};

// Move stock between locations (several items at once)
export const TransferForm = ({ items, startItem, locations, onClose, onSaved }) => {
    const active = locations.filter(l => l.isActive);
    const from0 = startItem?.levels.find(l => l.quantity > 0)?.locationId || active.find(l => l.receivesPurchases)?._id || active[0]?._id || '';
    const to0 = active.find(l => l._id !== from0 && l.defaultForSales)?._id || active.find(l => l._id !== from0)?._id || '';
    const [fromId, setFromId] = useState(from0);
    const [toId, setToId] = useState(to0);
    const [note, setNote] = useState('');
    const [lines, setLines] = useState([{ itemId: startItem?.id || '', quantity: '', factor: 1 }]);
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);
    const byId = (id) => items.find(i => i.id === id);
    const setLine = (i, patch) => setLines(ls => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

    const submit = async (e) => {
        e.preventDefault();
        setSaving(true);
        setError('');
        try {
            await transferStock({ fromId, toId, note,
                lines: lines.filter(l => l.itemId).map(l => ({ itemId: l.itemId, quantity: Number(l.quantity) * Number(l.factor) })) });
            onSaved();
        } catch (err) {
            setError(errorText(err, 'Could not transfer'));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal title="Transfer stock" onClose={onClose} wide>
            <form onSubmit={submit}>
                <div className="modal-body">
                    <div className="form-grid">
                        <div className="input-group">
                            <label>From</label>
                            <select className="input" value={fromId} onChange={e => setFromId(e.target.value)}>
                                {active.map(l => <option key={l._id} value={l._id}>{l.name}</option>)}
                            </select>
                        </div>
                        <div className="input-group">
                            <label>To</label>
                            <select className="input" value={toId} onChange={e => setToId(e.target.value)}>
                                {active.map(l => <option key={l._id} value={l._id}>{l.name}</option>)}
                            </select>
                        </div>
                    </div>
                    {lines.map((l, i) => {
                        const it = byId(l.itemId);
                        const have = it?.levels.find(x => x.locationId === fromId)?.quantity ?? 0;
                        return (
                            <div className="line-row transfer" key={i}>
                                <select className="input" value={l.itemId} onChange={e => setLine(i, { itemId: e.target.value, factor: 1 })} required>
                                    <option value="">Item…</option>
                                    {items.filter(x => x.isActive && x.trackStock).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
                                </select>
                                <input className="input" type="number" min="0" step="any" placeholder="Qty" value={l.quantity}
                                    onChange={e => setLine(i, { quantity: e.target.value })} required />
                                <select className="input" value={l.factor} onChange={e => setLine(i, { factor: e.target.value })}>
                                    {unitOptions(it).map(u => <option key={u.name} value={u.factor}>{u.name}</option>)}
                                </select>
                                <small className="muted">{it ? `has ${fmtQty(have, it.unit)}` : ''}</small>
                                <button type="button" className="icon-btn delete" aria-label="Remove line" disabled={lines.length === 1}
                                    onClick={() => setLines(ls => ls.filter((_, j) => j !== i))}><FiTrash2 /></button>
                            </div>
                        );
                    })}
                    <button type="button" className="link-btn" onClick={() => setLines(ls => [...ls, { itemId: '', quantity: '', factor: 1 }])}><FiPlus /> Add item</button>
                    <div className="input-group" style={{ marginTop: 12 }}>
                        <label>Note</label>
                        <input className="input" value={note} onChange={e => setNote(e.target.value)} />
                    </div>
                    {error && <p className="error-message">{error}</p>}
                </div>
                <div className="modal-footer">
                    <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
                    <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Moving…' : 'Transfer'}</button>
                </div>
            </form>
        </Modal>
    );
};

// Which dishes used an ingredient over the last N days
export const UsageView = ({ item, onClose }) => {
    const { hasPerm } = useAuth();
    const [days, setDays] = useState(7);
    const [data, setData] = useState(null);
    useEffect(() => { getUsage(item.id, days).then(r => setData(r.data)); }, [item.id, days]);
    return (
        <Modal title={`Where ${item.name} went`} onClose={onClose}>
            <div className="modal-body">
                <div className="usage-head">
                    <select className="input compact" value={days} onChange={e => setDays(Number(e.target.value))}>
                        <option value={7}>Last 7 days</option>
                        <option value={14}>Last 14 days</option>
                        <option value={30}>Last 30 days</option>
                    </select>
                    {data && <strong>{fmtQty(data.total, item.unit)} used</strong>}
                </div>
                {data && data.rows.length === 0 && <p className="muted">Nothing used in this period. Add recipes so sales deduct this item.</p>}
                {data && data.rows.map(r => (
                    <div className="usage-row" key={r.label}>
                        <span>{r.label}</span>
                        <div className="bar"><i className={r.isSale ? '' : 'loss'} style={{ width: `${r.pct}%` }} /></div>
                        <span className="num">{r.pct}%</span>
                        <span className="num muted">{fmtQty(r.quantity, item.unit)}</span>
                    </div>
                ))}
                <p className="muted small">
                    Daily use {fmtQty(item.dailyUse, item.unit)} (last 14 days).
                    {item.avgCost != null && hasPerm('sensitive.see_cost') && ` Average cost ${fmtUnitCost(item.avgCost, item.unit)}.`}
                </p>
            </div>
        </Modal>
    );
};
