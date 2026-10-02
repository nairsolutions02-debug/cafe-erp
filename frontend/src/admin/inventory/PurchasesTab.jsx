import React, { useCallback, useEffect, useState } from 'react';
import { FiPlus, FiTrash2, FiEye, FiCreditCard, FiRotateCcw, FiAlertTriangle } from 'react-icons/fi';
import {
    getPurchases, getPurchase, recordPurchase, payPurchase, voidPurchase, getStock, saveStockItem, uploadStockPhoto,
} from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import Modal from './Modal';
import { PAYMENT_MODES, errorText, fmtDate, fmtMoney, fmtQty, fmtUnitCost, today, unitOptions } from './shared';

const blankLine = () => ({ itemId: '', unitName: '', factor: 1, quantity: '', rate: '', taxRate: '' });
const round2 = (n) => Math.round(n * 100) / 100;

// Enter a supplier bill: items × qty × rate in pack units, GST, paid now or later, bill photo
const PurchaseForm = ({ vendors, locations, onClose, onSaved }) => {
    const [items, setItems] = useState([]);
    const [form, setForm] = useState({
        vendorId: '', vendorName: '', billNumber: '', billDate: today(),
        locationId: locations.find(l => l.receivesPurchases)?._id || locations[0]?._id || '',
        paymentMode: 'cash', paidAmount: '', paidAll: true, dueDate: '', note: '',
    });
    const [lines, setLines] = useState([blankLine()]);
    const [photo, setPhoto] = useState(null);
    const [newItem, setNewItem] = useState(null);
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);
    const [result, setResult] = useState(null);

    const loadItems = useCallback(async () => setItems((await getStock()).data.filter(i => i.isActive)), []);
    useEffect(() => { loadItems(); }, [loadItems]);
    const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
    const setLine = (i, patch) => setLines(ls => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
    const itemOf = (id) => items.find(x => x.id === id);

    const lineNet = (l) => round2(Number(l.quantity || 0) * Number(l.rate || 0));
    const lineTax = (l) => round2(lineNet(l) * Number(l.taxRate || 0) / 100);
    const subtotal = lines.reduce((a, l) => a + lineNet(l), 0);
    const tax = lines.reduce((a, l) => a + lineTax(l), 0);
    const total = round2(subtotal + tax);
    const vendor = vendors.find(v => v.id === form.vendorId);

    const pickItem = (i, id) => {
        if (id === '__new') { setNewItem({ line: i, name: '', unit: 'pc' }); return; }
        const it = itemOf(id);
        const pack = (it?.units || []).slice(-1)[0];
        setLine(i, { itemId: id, unitName: pack ? pack.name : it?.unit || '', factor: pack ? Number(pack.factor) : 1 });
    };

    const addNewItem = async () => {
        try {
            const id = (await saveStockItem({ name: newItem.name, unit: newItem.unit, category: 'ingredient', vendorId: form.vendorId })).data;
            await loadItems();
            setLine(newItem.line, { itemId: id, unitName: newItem.unit, factor: 1 });
            setNewItem(null);
        } catch (err) {
            alert(errorText(err, 'Could not add item'));
        }
    };

    const submit = async (e) => {
        e.preventDefault();
        setSaving(true);
        setError('');
        try {
            const billPhotoUrl = photo ? await uploadStockPhoto(photo, 'bills') : '';
            const res = await recordPurchase({
                vendorId: form.vendorId, vendorName: form.vendorName, billNumber: form.billNumber, billDate: form.billDate,
                locationId: form.locationId, billPhotoUrl, note: form.note,
                paymentMode: form.paidAll ? form.paymentMode : (Number(form.paidAmount) > 0 ? form.paymentMode : 'credit'),
                paidAmount: form.paidAll ? total : Number(form.paidAmount || 0), dueDate: form.dueDate,
                lines: lines.filter(l => l.itemId).map(l => ({
                    itemId: l.itemId, unitName: l.unitName, factor: Number(l.factor), quantity: Number(l.quantity),
                    rate: Number(l.rate || 0), taxRate: Number(l.taxRate || 0),
                })),
            });
            if (res.data.priceAlerts.length) setResult(res.data);
            else onSaved();
        } catch (err) {
            setError(errorText(err, 'Could not save the purchase'));
        } finally {
            setSaving(false);
        }
    };

    if (result) {
        return (
            <Modal title="Purchase saved · price alert" onClose={onSaved}>
                <div className="modal-body">
                    <p className="price-alert"><FiAlertTriangle /> These items cost more than usual:</p>
                    <ul className="plain-list">
                        {result.priceAlerts.map(a => (
                            <li key={a.item}><strong>{a.item}</strong>
                                <span>{fmtUnitCost(a.previousCost, a.unit)} → {fmtUnitCost(a.newCost, a.unit)} <span className="pill warn">+{a.changePct}%</span></span>
                            </li>
                        ))}
                    </ul>
                    <p className="muted small">Average costs and dish costs have been updated. Check Recipes &amp; Costing for dishes whose margin dropped.</p>
                </div>
                <div className="modal-footer"><button className="btn btn-primary" onClick={onSaved}>OK</button></div>
            </Modal>
        );
    }

    return (
        <Modal title="New purchase" onClose={onClose} wide>
            <form onSubmit={submit}>
                <div className="modal-body">
                    <div className="form-grid three">
                        <div className="input-group">
                            <label>Vendor</label>
                            <select className="input" value={form.vendorId} onChange={e => set('vendorId', e.target.value)}>
                                <option value="">Other / walk-in</option>
                                {vendors.filter(v => v.isActive).map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                            </select>
                        </div>
                        {!form.vendorId && (
                            <div className="input-group">
                                <label>Shop name</label>
                                <input className="input" value={form.vendorName} onChange={e => set('vendorName', e.target.value)} placeholder="e.g. local market" />
                            </div>
                        )}
                        <div className="input-group">
                            <label>Bill no.</label>
                            <input className="input" value={form.billNumber} onChange={e => set('billNumber', e.target.value)} />
                        </div>
                        <div className="input-group">
                            <label>Bill date</label>
                            <input className="input" type="date" value={form.billDate} max={today()} onChange={e => set('billDate', e.target.value)} />
                        </div>
                        <div className="input-group">
                            <label>Received at</label>
                            <select className="input" value={form.locationId} onChange={e => set('locationId', e.target.value)}>
                                {locations.filter(l => l.isActive).map(l => <option key={l._id} value={l._id}>{l.name}</option>)}
                            </select>
                        </div>
                    </div>

                    <div className="purchase-lines">
                        <div className="line-row purchase head">
                            <span>Item</span><span>Qty</span><span>Unit</span><span>Rate / unit</span><span>GST %</span><span>Amount</span><span />
                        </div>
                        {lines.map((l, i) => {
                            const it = itemOf(l.itemId);
                            return (
                                <div className="line-row purchase" key={i}>
                                    <select className="input" value={l.itemId} onChange={e => pickItem(i, e.target.value)} aria-label="Item">
                                        <option value="">Choose item…</option>
                                        {items.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
                                        <option value="__new">＋ New item…</option>
                                    </select>
                                    <input className="input" type="number" min="0" step="any" value={l.quantity} aria-label="Quantity"
                                        onChange={e => setLine(i, { quantity: e.target.value })} required={!!l.itemId} />
                                    <select className="input" value={l.unitName} aria-label="Unit"
                                        onChange={e => { const u = unitOptions(it).find(x => x.name === e.target.value); setLine(i, { unitName: u.name, factor: u.factor }); }}>
                                        {unitOptions(it).map(u => <option key={u.name} value={u.name}>{u.name}{u.factor !== 1 ? ` (${fmtQty(u.factor, it?.unit)})` : ''}</option>)}
                                    </select>
                                    <input className="input" type="number" min="0" step="any" value={l.rate} aria-label="Rate"
                                        onChange={e => setLine(i, { rate: e.target.value })} placeholder="₹" />
                                    <input className="input" type="number" min="0" step="any" value={l.taxRate} aria-label="GST %"
                                        onChange={e => setLine(i, { taxRate: e.target.value })} placeholder="0" />
                                    <span className="num">{fmtMoney(lineNet(l) + lineTax(l))}</span>
                                    <button type="button" className="icon-btn delete" aria-label="Remove line" disabled={lines.length === 1}
                                        onClick={() => setLines(ls => ls.filter((_, j) => j !== i))}><FiTrash2 /></button>
                                </div>
                            );
                        })}
                        {newItem && (
                            <div className="new-item-row">
                                <input className="input" placeholder="New item name" value={newItem.name} autoFocus onChange={e => setNewItem({ ...newItem, name: e.target.value })} />
                                <input className="input" list="stock-units" placeholder="Base unit (g, ml, pc)" value={newItem.unit} onChange={e => setNewItem({ ...newItem, unit: e.target.value.trim() })} />
                                <datalist id="stock-units">{['g', 'ml', 'pc', 'kg', 'L', 'pack', 'box'].map(u => <option key={u} value={u} />)}</datalist>
                                <button type="button" className="btn btn-primary btn-sm" disabled={!newItem.name.trim() || !newItem.unit} onClick={addNewItem}>Add item</button>
                                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setNewItem(null)}>Cancel</button>
                            </div>
                        )}
                        <button type="button" className="link-btn" onClick={() => setLines(ls => [...ls, blankLine()])}><FiPlus /> Add line</button>
                    </div>

                    <div className="purchase-totals">
                        <span>Subtotal {fmtMoney(subtotal)}</span>
                        <span>GST {fmtMoney(tax)}</span>
                        <strong>Total {fmtMoney(total)}</strong>
                    </div>

                    <div className="form-grid three">
                        <label className="check">
                            <input type="checkbox" checked={form.paidAll} onChange={e => set('paidAll', e.target.checked)} /> Paid in full now
                        </label>
                        {!form.paidAll && (
                            <div className="input-group">
                                <label>Paid now (₹)</label>
                                <input className="input" type="number" min="0" step="any" value={form.paidAmount} onChange={e => set('paidAmount', e.target.value)} placeholder="0" />
                            </div>
                        )}
                        <div className="input-group">
                            <label>Paid by</label>
                            <select className="input" value={form.paymentMode} onChange={e => set('paymentMode', e.target.value)}>
                                {PAYMENT_MODES.filter(m => m.value !== 'credit').map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                            </select>
                        </div>
                        {!form.paidAll && (
                            <div className="input-group">
                                <label>Pay balance by</label>
                                <input className="input" type="date" value={form.dueDate} onChange={e => set('dueDate', e.target.value)} />
                                <small className="hint">{vendor ? `Default: bill date + ${vendor.paymentTermsDays} days` : ''}</small>
                            </div>
                        )}
                        <div className="input-group">
                            <label>Bill photo</label>
                            <input type="file" accept="image/*" capture="environment" onChange={e => setPhoto(e.target.files[0] || null)} />
                        </div>
                        <div className="input-group">
                            <label>Note</label>
                            <input className="input" value={form.note} onChange={e => set('note', e.target.value)} />
                        </div>
                    </div>
                    <p className="muted small">GST on purchases is counted as cost (restaurants on 5% GST can't claim input credit). Stock and average cost update when you save.</p>
                    {error && <p className="error-message">{error}</p>}
                </div>
                <div className="modal-footer">
                    <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
                    <button type="submit" className="btn btn-primary" disabled={saving || !lines.some(l => l.itemId)}>{saving ? 'Saving…' : `Save purchase · ${fmtMoney(total)}`}</button>
                </div>
            </form>
        </Modal>
    );
};

const PurchaseDetail = ({ id, onClose }) => {
    const [p, setP] = useState(null);
    useEffect(() => { getPurchase(id).then(r => setP(r.data)); }, [id]);
    return (
        <Modal title={p ? `${p.vendorName || 'Purchase'} · ${p.billNumber || fmtDate(p.billDate)}` : 'Purchase'} onClose={onClose} wide>
            <div className="modal-body">
                {p && (
                    <>
                        <p className="muted">{fmtDate(p.billDate)} · received at {p.location} · entered by {p.createdBy}{p.isVoid && <span className="pill warn">Undone</span>}</p>
                        <table className="staff-table">
                            <thead><tr><th>Item</th><th>Qty</th><th>Rate</th><th>GST</th><th>Amount</th><th>Cost per unit</th></tr></thead>
                            <tbody>
                                {p.lines.map((l, i) => (
                                    <tr key={i}>
                                        <td>{l.item}</td>
                                        <td>{l.quantity} {l.unitName}{l.factor !== 1 && <div className="muted small">{fmtQty(l.baseQuantity, l.unit)}</div>}</td>
                                        <td>{fmtMoney(l.rate)}</td>
                                        <td>{l.taxRate}%</td>
                                        <td>{fmtMoney(l.amount)}</td>
                                        <td>{fmtUnitCost(l.baseCost, l.unit)}
                                            {l.changePct != null && Number(l.changePct) !== 0 && (
                                                <span className={`pill ${l.changePct > 0 ? 'warn' : 'ok'}`}>{l.changePct > 0 ? '+' : ''}{l.changePct}%</span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {p.total != null && <p className="purchase-totals"><span>Subtotal {fmtMoney(p.subtotal)}</span><span>GST {fmtMoney(p.tax)}</span><strong>Total {fmtMoney(p.total)}</strong><span>Paid {fmtMoney(p.paid)}</span></p>}
                        {p.note && <p>{p.note}</p>}
                        {p.billPhotoUrl && <a href={p.billPhotoUrl} target="_blank" rel="noopener noreferrer"><img className="bill-photo" src={p.billPhotoUrl} alt="Bill" /></a>}
                    </>
                )}
            </div>
        </Modal>
    );
};

const PayForm = ({ purchase, onClose, onSaved }) => {
    const [amount, setAmount] = useState(purchase.due);
    const [mode, setMode] = useState('cash');
    const [error, setError] = useState('');
    const submit = async (e) => {
        e.preventDefault();
        try {
            await payPurchase(purchase.id, amount, mode);
            onSaved();
        } catch (err) {
            setError(errorText(err, 'Could not record payment'));
        }
    };
    return (
        <Modal title={`Pay ${purchase.vendorName || 'vendor'}`} onClose={onClose}>
            <form onSubmit={submit}>
                <div className="modal-body">
                    <p className="muted">Bill {purchase.billNumber || '—'} · due {fmtMoney(purchase.due)}</p>
                    <div className="input-group">
                        <label>Amount (₹)</label>
                        <input className="input" type="number" min="0" step="any" value={amount} onChange={e => setAmount(e.target.value)} required autoFocus />
                    </div>
                    <div className="input-group">
                        <label>Paid by</label>
                        <select className="input" value={mode} onChange={e => setMode(e.target.value)}>
                            {PAYMENT_MODES.filter(m => m.value !== 'credit').map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                        </select>
                    </div>
                    {error && <p className="error-message">{error}</p>}
                </div>
                <div className="modal-footer">
                    <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
                    <button type="submit" className="btn btn-primary">Record payment</button>
                </div>
            </form>
        </Modal>
    );
};

const PurchasesTab = ({ vendors, locations, reloadVendors }) => {
    const { hasPerm } = useAuth();
    const seeCost = hasPerm('sensitive.see_cost');
    const [rows, setRows] = useState([]);
    const [filters, setFilters] = useState({ vendorId: '', from: '', to: '', dueOnly: false });
    const [modal, setModal] = useState(null);

    const load = useCallback(async () => setRows((await getPurchases(filters)).data), [filters]);
    useEffect(() => { load(); }, [load]);
    const saved = () => { setModal(null); load(); reloadVendors(); };

    const undo = async (p) => {
        if (!window.confirm(`Undo the purchase from ${p.vendorName || 'this vendor'} (bill ${p.billNumber || '—'})? Its stock is taken back out.`)) return;
        try {
            await voidPurchase(p.id);
            saved();
        } catch (err) {
            alert(errorText(err, 'Could not undo'));
        }
    };

    const shown = rows.filter(r => !filters.dueOnly || (r.due > 0 && !r.isVoid));
    const totalDue = rows.filter(r => !r.isVoid).reduce((a, r) => a + Number(r.due || 0), 0);
    const totalSpent = shown.filter(r => !r.isVoid).reduce((a, r) => a + Number(r.total || 0), 0);

    return (
        <div>
            <div className="inv-toolbar">
                <select className="input compact" value={filters.vendorId} onChange={e => setFilters({ ...filters, vendorId: e.target.value })} aria-label="Vendor">
                    <option value="">All vendors</option>
                    {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
                <input className="input compact" type="date" value={filters.from} onChange={e => setFilters({ ...filters, from: e.target.value })} aria-label="From" />
                <input className="input compact" type="date" value={filters.to} onChange={e => setFilters({ ...filters, to: e.target.value })} aria-label="To" />
                {seeCost && (
                    <label className="check"><input type="checkbox" checked={filters.dueOnly} onChange={e => setFilters({ ...filters, dueOnly: e.target.checked })} /> Unpaid only</label>
                )}
                <div className="spacer" />
                {hasPerm('inventory.create') && (
                    <button className="btn btn-primary" onClick={() => setModal({ type: 'new' })}><FiPlus /> New purchase</button>
                )}
            </div>
            {seeCost && (
                <div className="inv-summary">
                    <span>Shown <strong>{fmtMoney(totalSpent, 0)}</strong></span>
                    <span className={totalDue > 0 ? 'warn' : ''}>To pay vendors <strong>{fmtMoney(totalDue, 0)}</strong></span>
                </div>
            )}
            <div className="table-scroll">
                <table className="staff-table">
                    <thead>
                        <tr>
                            <th>Date</th><th>Vendor</th><th>Bill</th><th>Items</th>
                            {seeCost && <><th>Total</th><th>Due</th></>}
                            <th>By</th><th aria-label="Actions" />
                        </tr>
                    </thead>
                    <tbody>
                        {shown.map(p => (
                            <tr key={p.id} className={p.isVoid ? 'inactive' : ''}>
                                <td>{fmtDate(p.billDate)}</td>
                                <td><strong>{p.vendorName || '—'}</strong>{p.isVoid && <span className="pill warn">Undone</span>}</td>
                                <td>{p.billNumber || '—'}</td>
                                <td className="small clip">{p.items}</td>
                                {seeCost && <td>{fmtMoney(p.total)}</td>}
                                {seeCost && <td>{p.due > 0 && !p.isVoid ? <span className="neg">{fmtMoney(p.due)}</span> : <span className="muted">—</span>}
                                    {p.due > 0 && p.dueDate && !p.isVoid && <div className="muted small">by {fmtDate(p.dueDate)}</div>}</td>}
                                <td className="small">{p.createdBy}</td>
                                <td>
                                    <span className="row-actions">
                                        <button className="icon-btn" title="View" aria-label="View purchase" onClick={() => setModal({ type: 'view', id: p.id })}><FiEye /></button>
                                        {seeCost && hasPerm('inventory.edit') && p.due > 0 && !p.isVoid && (
                                            <button className="icon-btn" title="Record payment" aria-label="Pay" onClick={() => setModal({ type: 'pay', purchase: p })}><FiCreditCard /></button>
                                        )}
                                        {hasPerm('inventory.delete') && !p.isVoid && (
                                            <button className="icon-btn delete" title="Undo purchase" aria-label="Undo purchase" onClick={() => undo(p)}><FiRotateCcw /></button>
                                        )}
                                    </span>
                                </td>
                            </tr>
                        ))}
                        {shown.length === 0 && <tr><td colSpan={8} className="empty muted">No purchases yet. Enter supplier bills here; stock and costs update automatically.</td></tr>}
                    </tbody>
                </table>
            </div>
            {modal?.type === 'new' && <PurchaseForm vendors={vendors} locations={locations} onClose={() => setModal(null)} onSaved={saved} />}
            {modal?.type === 'view' && <PurchaseDetail id={modal.id} onClose={() => setModal(null)} />}
            {modal?.type === 'pay' && <PayForm purchase={modal.purchase} onClose={() => setModal(null)} onSaved={saved} />}
        </div>
    );
};

export default PurchasesTab;
