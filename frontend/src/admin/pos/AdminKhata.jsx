import React, { useCallback, useEffect, useState } from 'react';
import { FiPlus } from 'react-icons/fi';
import { getKhataAccounts, getKhataHistory, settleKhata, setCreditLimit, findCustomers, getSettings } from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import { newClientId } from '../../lib/outbox';
import Modal from '../inventory/Modal';
import { whatsappLink } from '../inventory/shared';
import { inr } from './money';
import '../AdminStaff.css';
import '../inventory/Inventory.css';
import './POS.css';
import './Kiosk.css';

const errorText = (err) => err?.response?.data?.message || err?.message || 'Something went wrong';
const fmt = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
const KIND = { khata_sale: 'Credit sale', khata_settle: 'Paid', refund: 'Sale cancelled' };

const CollectForm = ({ acc, onClose, onDone }) => {
    const [amount, setAmount] = useState(acc.balance);
    const [method, setMethod] = useState('cash');
    const [drawer, setDrawer] = useState('cash_counter');
    const [error, setError] = useState('');
    const submit = async () => {
        try {
            await settleKhata(acc.customerId, amount, method, drawer, newClientId());
            onDone();
        } catch (err) {
            setError(errorText(err));
        }
    };
    return (
        <Modal title={`Collect from ${acc.name}`} onClose={onClose}>
            <div className="modal-body">
                <p className="muted">Due {inr(acc.balance)}</p>
                <div className="input-group"><label>Amount (₹)</label>
                    <input className="input" type="number" value={amount} onChange={e => setAmount(e.target.value)} autoFocus /></div>
                <div className="seg" style={{ marginBottom: 10 }}>
                    {['cash', 'upi', 'card'].map(m => <button key={m} className={method === m ? 'active' : ''} onClick={() => setMethod(m)}>{m === 'upi' ? 'UPI' : m[0].toUpperCase() + m.slice(1)}</button>)}
                </div>
                {method === 'cash' && (
                    <div className="input-group"><label>Into drawer</label>
                        <select className="input" value={drawer} onChange={e => setDrawer(e.target.value)}>
                            <option value="cash_counter">Cash – Counter</option><option value="cash_kiosk">Cash – Kiosk</option>
                        </select></div>
                )}
                {error && <p className="error-message">{error}</p>}
            </div>
            <div className="modal-footer">
                <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
                <button className="btn btn-primary" onClick={submit}>Collect {inr(amount)}</button>
            </div>
        </Modal>
    );
};

const History = ({ acc, onClose }) => {
    const [rows, setRows] = useState([]);
    useEffect(() => { getKhataHistory(acc.customerId).then(r => setRows(r.data)); }, [acc.customerId]);
    return (
        <Modal title={`Khata · ${acc.name}`} onClose={onClose} wide>
            <div className="modal-body table-scroll">
                <table className="staff-table">
                    <thead><tr><th>When</th><th>What</th><th>Amount</th><th>Details</th><th>By</th></tr></thead>
                    <tbody>{rows.map((r, i) => (
                        <tr key={i}><td className="small">{fmt(r.date)}</td><td>{KIND[r.kind] || r.kind}</td>
                            <td className={r.amount > 0 ? 'neg' : ''}>{r.amount > 0 ? '+' : ''}{inr(r.amount)}</td>
                            <td className="small">{[r.orderNumber, r.method && r.kind === 'khata_settle' ? r.method.toUpperCase() : '', r.note].filter(Boolean).join(' · ')}</td>
                            <td className="small">{r.by}</td></tr>
                    ))}{rows.length === 0 && <tr><td colSpan={5} className="muted">No entries.</td></tr>}</tbody>
                </table>
            </div>
        </Modal>
    );
};

// Khata (credit tab): who owes what, since when, with collection and WhatsApp reminders
const AdminKhata = () => {
    const { hasPerm } = useAuth();
    const [rows, setRows] = useState([]);
    const [cafe, setCafe] = useState('');
    const [modal, setModal] = useState(null);
    const [q, setQ] = useState('');
    const [found, setFound] = useState([]);
    const load = useCallback(async () => setRows((await getKhataAccounts()).data), []);
    useEffect(() => {
        load();
        getSettings().then(r => setCafe(r.data.restaurant_name || '')).catch(() => {});
    }, [load]);
    useEffect(() => {
        if (q.trim().length < 3) { setFound([]); return undefined; }
        const t = setTimeout(() => findCustomers(q).then(r => setFound(r.data)).catch(() => {}), 250);
        return () => clearTimeout(t);
    }, [q]);

    const limit = async (c) => {
        const v = window.prompt(`Khata limit for ${c.name} (₹, 0 = no credit)`, c.limit ?? 0);
        if (v === null) return;
        try { await setCreditLimit(c.customerId || c.id, Number(v)); setQ(''); load(); } catch (err) { alert(errorText(err)); }
    };
    const remind = (a) => whatsappLink(a.rawPhone || '', `Hi ${a.name}, your khata at ${cafe || 'our cafe'} is ${inr(a.balance)}. Please clear it on your next visit. Thank you!`);

    const due = rows.filter(r => r.balance > 0);
    const total = due.reduce((s, r) => s + Number(r.balance), 0);
    const bucket = (lo, hi) => due.filter(r => (r.oldestDays ?? 0) >= lo && (r.oldestDays ?? 0) <= hi).reduce((s, r) => s + Number(r.balance), 0);

    return (
        <div className="khata-page inv">
            <div className="page-header"><h1>Khata</h1><p>Credit given at the kiosk and counter, and what is still due.</p></div>
            <div className="stat-tiles">
                <div className="stat-tile"><span>To collect ({due.length})</span><strong className={total > 0 ? 'neg' : ''}>{inr(total)}</strong></div>
                <div className="stat-tile"><span>0–7 days</span><strong>{inr(bucket(0, 7))}</strong></div>
                <div className="stat-tile"><span>8–15 days</span><strong>{inr(bucket(8, 15))}</strong></div>
                <div className="stat-tile"><span>16–30 days</span><strong>{inr(bucket(16, 30))}</strong></div>
                <div className="stat-tile"><span>30+ days</span><strong className={bucket(31, 99999) > 0 ? 'neg' : ''}>{inr(bucket(31, 99999))}</strong></div>
            </div>
            {hasPerm('customers.edit') && (
                <div className="inv-toolbar">
                    <input className="input search" placeholder="Give khata to a customer: phone or name" value={q} onChange={e => setQ(e.target.value)} />
                    {found.map(c => <button key={c.id} className="btn btn-ghost btn-sm" onClick={() => limit({ ...c, customerId: c.id })}><FiPlus /> {c.name} · {c.phone}</button>)}
                </div>
            )}
            <div className="table-scroll">
                <table className="staff-table">
                    <thead><tr><th>Customer</th><th>Limit</th><th>Due</th><th>Oldest unpaid</th><th aria-label="Actions" /></tr></thead>
                    <tbody>
                        {rows.map(a => (
                            <tr key={a.customerId}>
                                <td><strong>{a.name}</strong><div className="muted small">{a.phone}</div></td>
                                <td>{inr(a.limit)}</td>
                                <td className={a.balance > a.limit ? 'neg' : ''}><strong>{inr(a.balance)}</strong></td>
                                <td className={a.oldestDays > 7 ? 'neg' : ''}>{a.oldestDays == null ? '—' : `${a.oldestDays} days`}</td>
                                <td className="row-actions">
                                    {a.balance > 0 && hasPerm('orders.edit') && <button className="btn btn-primary btn-sm" onClick={() => setModal({ type: 'collect', a })}>Collect</button>}
                                    {a.balance > 0 && a.rawPhone && <a className="btn btn-ghost btn-sm" href={remind(a)} target="_blank" rel="noopener noreferrer">WhatsApp</a>}
                                    <button className="btn btn-ghost btn-sm" onClick={() => setModal({ type: 'history', a })}>History</button>
                                    {hasPerm('customers.edit') && <button className="btn btn-ghost btn-sm" onClick={() => limit(a)}>Limit</button>}
                                </td>
                            </tr>
                        ))}
                        {rows.length === 0 && <tr><td colSpan={5} className="empty muted">No khata yet. Give a regular a limit above, then pick them at the kiosk and tap Khata.</td></tr>}
                    </tbody>
                </table>
            </div>
            {modal?.type === 'collect' && <CollectForm acc={modal.a} onClose={() => setModal(null)} onDone={() => { setModal(null); load(); }} />}
            {modal?.type === 'history' && <History acc={modal.a} onClose={() => setModal(null)} />}
        </div>
    );
};

export default AdminKhata;
