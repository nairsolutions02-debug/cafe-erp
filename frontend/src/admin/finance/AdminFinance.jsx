import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FiPlus, FiTrash2, FiRotateCcw, FiCreditCard } from 'react-icons/fi';
import {
    getDaySummary, getLedger, getExpenses, recordExpense, payExpense, voidExpense, getExpenseCategories, addExpenseCategory,
    getRecurringExpenses, saveRecurringExpense, deleteRecurringExpense, getPayables, payPurchase, getAccountBalances, uploadStockPhoto,
} from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import { runOrQueue, newClientId } from '../../lib/outbox';
import Modal from '../inventory/Modal';
import { inr } from '../pos/money';
import { whatsappLink } from '../inventory/shared';
import '../AdminStaff.css';
import '../AdminCatalogue.css';
import '../inventory/Inventory.css';
import '../pos/POS.css';

const errorText = (err) => err?.response?.data?.message || err?.message || 'Something went wrong';
const today = () => new Date().toLocaleDateString('en-CA');
const fmtD = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '');
const fmtDT = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
const KIND = {
    sale: 'Sale', refund: 'Refund', expense: 'Expense', purchase_payment: 'Vendor payment', payout: 'Pay-out', pay_in: 'From safe',
    drop: 'To safe', khata_sale: 'Khata sale', khata_settle: 'Khata collected', salary: 'Salary', advance: 'Advance',
    adjustment: 'Adjustment', reversal: 'Reversal', aggregator: 'Aggregator payout', transfer: 'Transfer',
};
const PAY_FROM = [
    ['cash_office', 'Cash – Office / safe'], ['cash_counter', 'Cash – Counter drawer'], ['upi', 'UPI'], ['bank', 'Bank'], ['card', 'Card'],
];
const CHANNEL = { qr: 'QR table', dine_in: 'Counter dine-in', takeaway: 'Takeaway', kiosk: 'Kiosk', aggregator: 'Aggregator' };

const TodayTab = () => {
    const [date, setDate] = useState('');
    const [d, setD] = useState(null);
    // No date = the cafe's today (the database knows the cafe's timezone)
    useEffect(() => { getDaySummary(date || null).then(r => setD(r.data)); }, [date]);
    if (!d) return null;
    return (
        <div>
            <div className="inv-toolbar"><input className="input compact" type="date" value={date || d.date} onChange={e => setDate(e.target.value)} aria-label="Day" /></div>
            <div className="stat-tiles">
                <div className="stat-tile"><span>Sales ({d.sales.orders} orders)</span><strong>{inr(d.sales.gross)}</strong></div>
                <div className="stat-tile"><span>GST collected</span><strong>{inr(d.sales.tax)}</strong></div>
                <div className="stat-tile"><span>Discounts</span><strong>{inr(d.sales.discounts)}</strong></div>
                <div className="stat-tile"><span>Average bill</span><strong>{inr(d.sales.avgBill)}</strong></div>
                <div className="stat-tile"><span>Not paid yet</span><strong className={d.sales.unpaid > 0 ? 'neg' : ''}>{inr(d.sales.unpaid)}</strong></div>
                <div className="stat-tile"><span>Cancelled ({d.sales.cancelled})</span><strong className={d.sales.voidsAfterKitchen ? 'neg' : ''}>{inr(d.sales.cancelledValue)}</strong></div>
            </div>
            <div className="finance-grid">
                <section className="panel">
                    <h2>Money in / out by account</h2>
                    <table className="staff-table"><thead><tr><th>Account</th><th>In</th><th>Out</th></tr></thead>
                        <tbody>{d.money.map(m => <tr key={m.code}><td>{m.account}</td><td className="pos-amt">{inr(m.in)}</td><td className="neg">{inr(m.out)}</td></tr>)}
                            {d.money.length === 0 && <tr><td colSpan={3} className="muted">No money movements.</td></tr>}</tbody></table>
                </section>
                <section className="panel">
                    <h2>Sales by channel</h2>
                    <table className="staff-table"><tbody>{d.channels.map(c => <tr key={c.channel}><td>{CHANNEL[c.channel] || c.channel}</td><td>{c.orders}</td><td>{inr(c.total)}</td></tr>)}
                        {d.channels.length === 0 && <tr><td className="muted">No sales.</td></tr>}</tbody></table>
                    <h2 style={{ marginTop: 16 }}>Expenses</h2>
                    <table className="staff-table"><tbody>{d.expenses.map(e => <tr key={e.category}><td>{e.category}</td><td>{inr(e.amount)}</td></tr>)}
                        {d.expenses.length === 0 && <tr><td className="muted">None.</td></tr>}</tbody></table>
                    <p className="muted small">Purchases billed today: {inr(d.purchases)}</p>
                </section>
                <section className="panel">
                    <h2>Shifts</h2>
                    <table className="staff-table"><thead><tr><th>Drawer</th><th>By</th><th>Expected</th><th>Counted</th><th>Diff</th></tr></thead>
                        <tbody>{d.shifts.map(s => <tr key={s.id}><td>{s.drawerName}</td><td className="small">{s.openedBy}{s.closedBy && ` → ${s.closedBy}`}</td>
                            <td>{inr(s.expectedCash)}</td><td>{s.countedCash == null ? 'open' : inr(s.countedCash)}</td>
                            <td className={s.difference < 0 ? 'neg' : ''}>{s.difference == null ? '' : inr(s.difference)}</td></tr>)}
                            {d.shifts.length === 0 && <tr><td colSpan={5} className="muted">No shifts.</td></tr>}</tbody></table>
                </section>
                <section className="panel">
                    <h2>Voids and discounts</h2>
                    {d.voids.map(v => <p key={v.orderNumber} className="small"><strong>{v.orderNumber}</strong> {inr(v.total)} · {v.reason}
                        {v.afterKitchen && <span className="pill warn">after kitchen</span>}</p>)}
                    {d.discounts.map(x => <p key={x.orderNumber} className="small"><strong>{x.orderNumber}</strong> −{inr(x.amount)} · {x.reason} · {x.by}
                        {x.approvedBy && ` (approved by ${x.approvedBy})`}</p>)}
                    {d.voids.length === 0 && d.discounts.length === 0 && <p className="muted">None.</p>}
                </section>
            </div>
        </div>
    );
};

const LedgerTab = () => {
    const [f, setF] = useState({ from: '', to: '', accountCode: '', kind: '' });
    const [rows, setRows] = useState([]);
    useEffect(() => { getLedger({ ...f, limit: 500 }).then(r => setRows(r.data)); }, [f]);
    return (
        <div>
            <div className="inv-toolbar">
                <input className="input compact" type="date" value={f.from} onChange={e => setF({ ...f, from: e.target.value })} aria-label="From" />
                <input className="input compact" type="date" value={f.to} onChange={e => setF({ ...f, to: e.target.value })} aria-label="To" />
                <select className="input compact" value={f.accountCode} onChange={e => setF({ ...f, accountCode: e.target.value })} aria-label="Account">
                    <option value="">All accounts</option>
                    {[...PAY_FROM, ['cash_kiosk', 'Cash – Kiosk'], ['khata', 'Khata']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                <select className="input compact" value={f.kind} onChange={e => setF({ ...f, kind: e.target.value })} aria-label="Type">
                    <option value="">All types</option>{Object.entries(KIND).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
            </div>
            <p className="muted small">Every rupee in or out is one line here. Lines are never edited; mistakes are corrected with a reversal.</p>
            <div className="table-scroll">
                <table className="staff-table">
                    <thead><tr><th>When</th><th>Account</th><th>Type</th><th>Amount</th><th>Details</th><th>By</th></tr></thead>
                    <tbody>
                        {rows.map(r => (
                            <tr key={r.id}>
                                <td className="small">{fmtDT(r.createdAt)}</td>
                                <td>{r.account}</td>
                                <td>{KIND[r.kind] || r.kind}{r.method && r.kind === 'sale' ? ` · ${r.method.toUpperCase()}` : ''}</td>
                                <td className={r.amount < 0 ? 'neg' : 'pos-amt'}>{r.amount > 0 ? '+' : ''}{inr(r.amount)}</td>
                                <td className="small">{[r.orderNumber, r.customer, r.note].filter(Boolean).join(' · ')}</td>
                                <td className="small">{r.by}</td>
                            </tr>
                        ))}
                        {rows.length === 0 && <tr><td colSpan={6} className="empty muted">No entries.</td></tr>}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

const ExpenseForm = ({ cats, onClose, onSaved }) => {
    const [f, setF] = useState({ date: today(), categoryId: cats[0]?._id || '', amount: '', status: 'paid', accountCode: 'cash_office', vendorName: '', note: '', spreadMonths: 1 });
    const [photo, setPhoto] = useState(null);
    const [error, setError] = useState('');
    const set = (k, v) => setF(x => ({ ...x, [k]: v }));
    const submit = async (e) => {
        e.preventDefault();
        try {
            const billPhotoUrl = photo && navigator.onLine ? await uploadStockPhoto(photo, 'bills') : '';
            const res = await runOrQueue('record_expense', { p: { ...f, amount: Number(f.amount), billPhotoUrl, clientId: newClientId() } },
                `Expense ${inr(f.amount)} ${f.note}`);
            onSaved(res.queued);
        } catch (err) {
            setError(errorText(err));
        }
    };
    return (
        <Modal title="Add expense" onClose={onClose} wide>
            <form onSubmit={submit}>
                <div className="modal-body form-grid">
                    <div className="input-group"><label>Category</label>
                        <select className="input" value={f.categoryId} onChange={e => set('categoryId', e.target.value)}>
                            {cats.filter(c => c.isActive).map(c => <option key={c._id} value={c._id}>{c.name}</option>)}</select></div>
                    <div className="input-group"><label>Amount (₹)</label>
                        <input className="input" type="number" min="0" step="any" value={f.amount} onChange={e => set('amount', e.target.value)} required autoFocus /></div>
                    <div className="input-group"><label>Date</label>
                        <input className="input" type="date" value={f.date} onChange={e => set('date', e.target.value)} /></div>
                    <div className="input-group"><label>Status</label>
                        <select className="input" value={f.status} onChange={e => set('status', e.target.value)}>
                            <option value="paid">Paid</option><option value="due">To pay later</option></select></div>
                    {f.status === 'paid' && (
                        <div className="input-group"><label>Paid from</label>
                            <select className="input" value={f.accountCode} onChange={e => set('accountCode', e.target.value)}>
                                {PAY_FROM.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
                    )}
                    <div className="input-group"><label>Paid to</label>
                        <input className="input" value={f.vendorName} onChange={e => set('vendorName', e.target.value)} placeholder="optional" /></div>
                    <div className="input-group"><label>Note</label>
                        <input className="input" value={f.note} onChange={e => set('note', e.target.value)} /></div>
                    <div className="input-group"><label>Spread over (months) <span className="hint">e.g. a yearly licence over 12</span></label>
                        <input className="input" type="number" min="1" max="12" value={f.spreadMonths} onChange={e => set('spreadMonths', e.target.value)} /></div>
                    <div className="input-group"><label>Bill photo</label>
                        <input type="file" accept="image/*" capture="environment" onChange={e => setPhoto(e.target.files[0] || null)} /></div>
                    {error && <p className="error-message span-2">{error}</p>}
                </div>
                <div className="modal-footer">
                    <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
                    <button type="submit" className="btn btn-primary">Save</button>
                </div>
            </form>
        </Modal>
    );
};

const RecurringPanel = ({ cats }) => {
    const { hasPerm } = useAuth();
    const [rows, setRows] = useState([]);
    const [f, setF] = useState({ name: '', categoryId: '', amount: '', dayOfMonth: 1 });
    const load = useCallback(async () => setRows((await getRecurringExpenses()).data), []);
    useEffect(() => { load(); }, [load]);
    const add = async (e) => {
        e.preventDefault();
        const d = new Date();
        let due = new Date(d.getFullYear(), d.getMonth(), Number(f.dayOfMonth));
        if (due < new Date(d.getFullYear(), d.getMonth(), d.getDate())) due = new Date(d.getFullYear(), d.getMonth() + 1, Number(f.dayOfMonth));
        try {
            await saveRecurringExpense({ ...f, categoryId: f.categoryId || cats[0]?._id, nextDue: due.toLocaleDateString('en-CA') });
            setF({ name: '', categoryId: '', amount: '', dayOfMonth: 1 });
            load();
        } catch (err) {
            alert(errorText(err));
        }
    };
    return (
        <section className="panel">
            <h2>Monthly bills</h2>
            <p className="muted small">Rent, internet… appear under Payables on their day each month.</p>
            <ul className="plain-list">
                {rows.map(r => (
                    <li key={r._id}>
                        <span><strong>{r.name}</strong> · {r.category?.name} · {inr(r.amount)} on day {r.dayOfMonth} · next {fmtD(r.nextDue)}</span>
                        {hasPerm('finance.delete') && <button className="icon-btn delete" aria-label={`Delete ${r.name}`}
                            onClick={async () => { if (window.confirm(`Stop "${r.name}"?`)) { await deleteRecurringExpense(r._id); load(); } }}><FiTrash2 /></button>}
                    </li>
                ))}
                {rows.length === 0 && <li className="muted">None yet.</li>}
            </ul>
            {hasPerm('finance.edit') && (
                <form className="form-grid three" onSubmit={add}>
                    <input className="input" placeholder="Name (e.g. Shop rent)" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} required />
                    <select className="input" value={f.categoryId} onChange={e => setF({ ...f, categoryId: e.target.value })} aria-label="Category">
                        {cats.map(c => <option key={c._id} value={c._id}>{c.name}</option>)}</select>
                    <input className="input" type="number" placeholder="₹ amount" value={f.amount} onChange={e => setF({ ...f, amount: e.target.value })} required />
                    <input className="input" type="number" min="1" max="28" placeholder="Day of month" value={f.dayOfMonth} onChange={e => setF({ ...f, dayOfMonth: e.target.value })} aria-label="Day of month" />
                    <button className="btn btn-primary" type="submit"><FiPlus /> Add</button>
                </form>
            )}
        </section>
    );
};

const ExpensesTab = () => {
    const { hasPerm } = useAuth();
    const [rows, setRows] = useState([]);
    const [cats, setCats] = useState([]);
    const [from, setFrom] = useState(new Date(Date.now() - 30 * 864e5).toLocaleDateString('en-CA'));
    const [modal, setModal] = useState(false);
    const [newCat, setNewCat] = useState('');
    const load = useCallback(async () => {
        setRows((await getExpenses(from)).data);
        setCats((await getExpenseCategories()).data);
    }, [from]);
    useEffect(() => { load(); }, [load]);
    const total = rows.filter(r => !r.isVoid && r.status === 'paid').reduce((a, r) => a + Number(r.amount), 0);
    const undo = async (r) => {
        const reason = window.prompt(`Cancel this expense of ${inr(r.amount)}? Reason:`);
        if (!reason) return;
        try { await voidExpense(r.id, reason); load(); } catch (err) { alert(errorText(err)); }
    };
    return (
        <div>
            <div className="inv-toolbar">
                <label className="small">From <input className="input compact" type="date" value={from} onChange={e => setFrom(e.target.value)} /></label>
                <div className="spacer" />
                {hasPerm('finance.create') && <button className="btn btn-primary" onClick={() => setModal(true)}><FiPlus /> Add expense</button>}
            </div>
            <div className="inv-summary"><span>Paid in this period <strong>{inr(total)}</strong></span></div>
            <div className="table-scroll">
                <table className="staff-table">
                    <thead><tr><th>Date</th><th>Category</th><th>Amount</th><th>Paid from</th><th>Note</th><th>By</th><th aria-label="Actions" /></tr></thead>
                    <tbody>
                        {rows.map(r => (
                            <tr key={r.id} className={r.isVoid ? 'inactive' : ''}>
                                <td>{fmtD(r.date)}</td>
                                <td>{r.category}{r.recurring && <span className="pill">monthly</span>}{r.spreadMonths > 1 && <span className="pill">over {r.spreadMonths} mo</span>}</td>
                                <td>{inr(r.amount)}</td>
                                <td>{r.status === 'due' ? <span className="pill warn">due</span> : r.account}</td>
                                <td className="small">{[r.vendorName, r.note, r.isVoid && `cancelled: ${r.voidReason}`].filter(Boolean).join(' · ')}
                                    {r.billPhotoUrl && <> · <a href={r.billPhotoUrl} target="_blank" rel="noopener noreferrer">bill</a></>}</td>
                                <td className="small">{r.by}</td>
                                <td>{!r.isVoid && hasPerm('finance.delete') && <button className="icon-btn delete" title="Cancel expense" aria-label="Cancel expense" onClick={() => undo(r)}><FiRotateCcw /></button>}</td>
                            </tr>
                        ))}
                        {rows.length === 0 && <tr><td colSpan={7} className="empty muted">No expenses in this period.</td></tr>}
                    </tbody>
                </table>
            </div>
            <div className="finance-grid" style={{ marginTop: 16 }}>
                <RecurringPanel cats={cats} />
                <section className="panel">
                    <h2>Categories</h2>
                    <p className="muted small">{cats.map(c => c.name).join(' · ')}</p>
                    {hasPerm('finance.edit') && (
                        <form className="inline-form" onSubmit={async (e) => { e.preventDefault(); if (!newCat.trim()) return; try { await addExpenseCategory(newCat.trim()); setNewCat(''); load(); } catch (err) { alert(errorText(err)); } }}>
                            <input className="input" value={newCat} onChange={e => setNewCat(e.target.value)} placeholder="New category" />
                            <button className="btn btn-primary" type="submit"><FiPlus /> Add</button>
                        </form>
                    )}
                </section>
            </div>
            {modal && <ExpenseForm cats={cats} onClose={() => setModal(false)} onSaved={(queued) => { setModal(false); if (queued) alert('Saved offline; it syncs when the internet is back.'); load(); }} />}
        </div>
    );
};

const PayablesTab = () => {
    const { hasPerm } = useAuth();
    const [d, setD] = useState(null);
    const [pay, setPay] = useState(null);
    const load = useCallback(async () => setD((await getPayables()).data), []);
    useEffect(() => { load(); }, [load]);
    if (!d) return null;
    const total = d.bills.reduce((a, b) => a + Number(b.due), 0) + d.expenses.reduce((a, e) => a + Number(e.amount), 0);
    const doPay = async () => {
        try {
            if (pay.kind === 'bill') await payPurchase(pay.row.id, pay.amount, pay.mode);
            else await payExpense(pay.row.id, pay.mode);
            setPay(null);
            load();
        } catch (err) {
            alert(errorText(err));
        }
    };
    return (
        <div>
            <div className="stat-tiles">
                <div className="stat-tile"><span>Total to pay</span><strong className={total > 0 ? 'neg' : ''}>{inr(total)}</strong></div>
                <div className="stat-tile"><span>Bills 0–7 days</span><strong>{inr(d.aging.d0_7)}</strong></div>
                <div className="stat-tile"><span>8–15 days</span><strong>{inr(d.aging.d8_15)}</strong></div>
                <div className="stat-tile"><span>16–30 days</span><strong>{inr(d.aging.d16_30)}</strong></div>
                <div className="stat-tile"><span>30+ days</span><strong className={d.aging.d30 > 0 ? 'neg' : ''}>{inr(d.aging.d30)}</strong></div>
            </div>
            <h2 className="section-title">Vendor bills</h2>
            <div className="table-scroll">
                <table className="staff-table">
                    <thead><tr><th>Vendor</th><th>Bill</th><th>Billed</th><th>Pay by</th><th>Due</th><th aria-label="Actions" /></tr></thead>
                    <tbody>
                        {d.bills.map(b => (
                            <tr key={b.id}>
                                <td><strong>{b.vendor || '—'}</strong></td><td>{b.billNumber || '—'}</td>
                                <td>{fmtD(b.billDate)} <span className="muted small">({b.age} d)</span></td>
                                <td className={b.overdue ? 'neg' : ''}>{b.dueDate ? fmtD(b.dueDate) : '—'}</td>
                                <td>{inr(b.due)}</td>
                                <td className="row-actions">
                                    {b.phone && <a className="link-btn" target="_blank" rel="noopener noreferrer" href={whatsappLink(b.phone, '')}>WhatsApp</a>}
                                    {hasPerm('inventory.edit') && <button className="icon-btn" aria-label="Pay bill" onClick={() => setPay({ kind: 'bill', row: b, amount: b.due, mode: 'bank' })}><FiCreditCard /></button>}
                                </td>
                            </tr>
                        ))}
                        {d.bills.length === 0 && <tr><td colSpan={6} className="empty muted">No unpaid vendor bills.</td></tr>}
                    </tbody>
                </table>
            </div>
            <h2 className="section-title">Bills and expenses due</h2>
            <div className="table-scroll">
                <table className="staff-table">
                    <thead><tr><th>Date</th><th>Category</th><th>Note</th><th>Amount</th><th aria-label="Actions" /></tr></thead>
                    <tbody>
                        {d.expenses.map(e => (
                            <tr key={e.id}>
                                <td className={e.overdue ? 'neg' : ''}>{fmtD(e.date)}</td><td>{e.category}</td><td>{e.note}</td><td>{inr(e.amount)}</td>
                                <td>{hasPerm('finance.edit') && <button className="icon-btn" aria-label="Pay expense" onClick={() => setPay({ kind: 'expense', row: e, amount: e.amount, mode: 'bank' })}><FiCreditCard /></button>}</td>
                            </tr>
                        ))}
                        {d.expenses.length === 0 && <tr><td colSpan={5} className="empty muted">Nothing due.</td></tr>}
                    </tbody>
                </table>
            </div>
            {pay && (
                <Modal title="Record payment" onClose={() => setPay(null)}>
                    <div className="modal-body">
                        {pay.kind === 'bill' && (
                            <div className="input-group"><label>Amount (₹)</label>
                                <input className="input" type="number" value={pay.amount} onChange={e => setPay({ ...pay, amount: e.target.value })} /></div>
                        )}
                        <div className="input-group"><label>Paid from</label>
                            <select className="input" value={pay.mode} onChange={e => setPay({ ...pay, mode: e.target.value })}>
                                {(pay.kind === 'bill'
                                    ? [['cash', 'Cash – Office / safe'], ['drawer', 'Cash – Counter drawer'], ['upi', 'UPI'], ['bank', 'Bank'], ['card', 'Card']]
                                    : PAY_FROM).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                            </select></div>
                    </div>
                    <div className="modal-footer">
                        <button className="btn btn-ghost" onClick={() => setPay(null)}>Cancel</button>
                        <button className="btn btn-primary" onClick={doPay}>Pay {inr(pay.amount)}</button>
                    </div>
                </Modal>
            )}
        </div>
    );
};

const AccountsTab = () => {
    const [rows, setRows] = useState([]);
    useEffect(() => { getAccountBalances().then(r => setRows(r.data)); }, []);
    return (
        <div>
            <p className="muted small">Balance = everything in minus everything out since the cafe started using the app (opening balances aren't included).</p>
            <div className="stat-tiles">
                {rows.map(a => <div key={a.code} className="stat-tile"><span>{a.name}</span><strong className={a.balance < 0 ? 'neg' : ''}>{inr(a.balance)}</strong></div>)}
            </div>
        </div>
    );
};

const TABS = [['today', 'Today'], ['ledger', 'Money ledger'], ['expenses', 'Expenses'], ['payables', 'Payables'], ['accounts', 'Accounts']];

const AdminFinance = () => {
    const [params, setParams] = useSearchParams();
    const tab = TABS.some(([k]) => k === params.get('tab')) ? params.get('tab') : 'today';
    return (
        <div className="finance-page inv">
            <div className="page-header"><h1>Finance</h1><p>Money in and out, expenses and what the cafe owes, from one money ledger.</p></div>
            <div className="tabs" role="tablist">
                {TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''}
                    onClick={() => setParams(k === 'today' ? {} : { tab: k })}>{l}</button>)}
            </div>
            {tab === 'today' && <TodayTab />}
            {tab === 'ledger' && <LedgerTab />}
            {tab === 'expenses' && <ExpensesTab />}
            {tab === 'payables' && <PayablesTab />}
            {tab === 'accounts' && <AccountsTab />}
        </div>
    );
};

export default AdminFinance;
