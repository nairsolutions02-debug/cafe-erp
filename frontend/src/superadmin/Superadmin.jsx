import React, { useEffect, useState, useCallback } from 'react';
import { FiPlus, FiLogOut, FiCreditCard, FiEdit2, FiKey, FiLock, FiUnlock } from 'react-icons/fi';
import { useAuth } from '../context/AuthContext';
import { saOverview, saCreateTenant, saUpdateTenant, saRecordPayment, saResetOwnerPin, saSavePlan } from '../utils/api';
import SupportPanel from './SupportPanel';
import './Superadmin.css';

const errorText = (err, fallback) => err.response?.data?.message || fallback;
const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;
const day = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const slugify = (s) => s.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
const inDays = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

const PlatformLogin = () => {
    const { adminLogin } = useAuth();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const submit = async (e) => {
        e.preventDefault();
        setError('');
        try {
            await adminLogin(email, password, { platform: true });
        } catch (err) {
            setError(errorText(err, 'Login failed'));
        }
    };
    return (
        <div className="sa-login">
            <form className="sa-card" onSubmit={submit}>
                <h1>Platform console</h1>
                <p className="muted">N.A.I.R. Solutions only</p>
                <input className="input" type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} required />
                <input className="input" type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} required />
                {error && <p className="error-message">{error}</p>}
                <button className="btn btn-primary btn-full" type="submit">Log in</button>
            </form>
        </div>
    );
};

const Modal = ({ title, onClose, children, onSubmit, submitLabel = 'Save' }) => (
    <div className="modal-overlay" onClick={onClose}>
        <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
                <h2>{title}</h2>
                <button className="modal-close" onClick={onClose}>×</button>
            </div>
            <form onSubmit={onSubmit}>
                <div className="modal-body sa-form">{children}</div>
                <div className="modal-footer">
                    <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
                    <button type="submit" className="btn btn-primary">{submitLabel}</button>
                </div>
            </form>
        </div>
    </div>
);

const Superadmin = () => {
    const { isPlatform, loading: authLoading, logout } = useAuth();
    const [data, setData] = useState(null);
    const [error, setError] = useState('');
    const [dialog, setDialog] = useState(null); // {type, tenant?}
    const [form, setForm] = useState({});

    const load = useCallback(async () => {
        try {
            setData((await saOverview()).data);
        } catch (err) {
            setError(errorText(err, 'Could not load'));
        }
    }, []);

    useEffect(() => { if (isPlatform) load(); }, [isPlatform, load]);

    if (authLoading) return <div className="loading-screen"><div className="spinner"></div></div>;
    if (!isPlatform) return <PlatformLogin />;
    if (!data) return <div className="sa-page"><p>{error || 'Loading…'}</p></div>;

    const open = (type, tenant, initial) => { setDialog({ type, tenant }); setForm(initial); };
    const close = () => setDialog(null);
    const run = async (fn, message) => {
        try {
            await fn();
            close();
            await load();
            if (message) alert(message);
        } catch (err) {
            alert(errorText(err, 'Something went wrong'));
        }
    };

    const totals = data.tenants.reduce((acc, t) => ({
        active: acc.active + (t.status === 'active' ? 1 : 0),
        due: acc.due + (t.status !== 'active' ? 1 : 0),
        mrr: acc.mrr + Number(t.billingAmount || 0),
    }), { active: 0, due: 0, mrr: 0 });

    return (
        <div className="sa-page">
            <header className="sa-header">
                <div>
                    <h1>Platform console</h1>
                    <p className="muted">{data.tenants.length} cafes · {totals.active} active · {totals.due} due or locked · {inr(totals.mrr)} billed per month</p>
                </div>
                <div className="sa-actions">
                    <button className="btn btn-primary" onClick={() => open('create', null, {
                        name: '', slug: '', planId: data.plans[0]?.id, paidUntil: inDays(30), ownerName: '', ownerPhone: '', ownerPin: '', ownerEmail: '',
                    })}><FiPlus /> New cafe</button>
                    <button className="btn btn-ghost" onClick={logout}><FiLogOut /> Log out</button>
                </div>
            </header>

            <div className="sa-grid">
                {data.tenants.map(t => (
                    <article key={t.id} className={`sa-tenant status-${t.status}`}>
                        <div className="sa-tenant-head">
                            <div>
                                <h2>{t.name}</h2>
                                <code>{t.slug}</code>
                            </div>
                            <span className={`sa-status ${t.status}`}>{t.status}</span>
                        </div>
                        <dl>
                            <dt>Plan</dt><dd>{t.planName || '—'} · {t.staffActive}/{t.maxStaff} staff</dd>
                            <dt>Paid until</dt><dd>{day(t.paidUntil)} (+{t.graceDays} days grace)</dd>
                            <dt>Billing</dt><dd>{inr(t.billingAmount)} / month{t.billingNote ? ` · ${t.billingNote}` : ''}</dd>
                            <dt>Owner</dt><dd>{t.ownerName || '—'} {t.ownerPhone && `· ${t.ownerPhone}`}</dd>
                            <dt>Last 30 days</dt><dd>{t.orders30d} orders · {inr(t.sales30d)} paid sales</dd>
                        </dl>
                        <div className="sa-tenant-actions">
                            <button className="btn btn-primary" onClick={() => open('payment', t, { months: 1, amount: t.billingAmount || '', note: '' })}>
                                <FiCreditCard /> Record payment
                            </button>
                            <button className="btn btn-ghost" onClick={() => open('edit', t, {
                                name: t.name, planId: t.planId, paidUntil: t.paidUntil || '', graceDays: t.graceDays,
                                billingAmount: t.billingAmount, billingNote: t.billingNote,
                                ownerName: t.ownerName, ownerPhone: t.ownerPhone, ownerEmail: t.ownerEmail,
                            })}><FiEdit2 /> Edit</button>
                            <button className="btn btn-ghost" onClick={() => open('pin', t, { pin: '' })}><FiKey /> Owner PIN</button>
                            <button className="btn btn-ghost" onClick={() => run(() => saUpdateTenant(t.id, { locked: !t.locked }))}>
                                {t.locked ? <><FiUnlock /> Unlock</> : <><FiLock /> Lock now</>}
                            </button>
                        </div>
                        {t.payments.length > 0 && (
                            <details className="sa-payments">
                                <summary>{t.payments.length} payments</summary>
                                <ul>
                                    {t.payments.map((p, i) => <li key={i}>{day(p.paidOn)} · {inr(p.amount)} · {p.months} month(s){p.note ? ` · ${p.note}` : ''}</li>)}
                                </ul>
                            </details>
                        )}
                    </article>
                ))}
            </div>

            <SupportPanel />

            <section className="sa-plans">
                <div className="sa-plans-head">
                    <h2>Plans</h2>
                    <button className="btn btn-ghost" onClick={() => open('plan', null, { name: '', maxStaff: 5, maxKiosks: 0, maxDevices: 5, monthlyPrice: 5000 })}>
                        <FiPlus /> Add plan
                    </button>
                </div>
                <table className="sa-table">
                    <thead><tr><th>Plan</th><th>Staff users</th><th>Kiosks</th><th>Devices</th><th>Price / month</th><th></th></tr></thead>
                    <tbody>
                        {data.plans.map(p => (
                            <tr key={p.id}>
                                <td>{p.name}</td><td>{p.max_staff}</td><td>{p.max_kiosks}</td><td>{p.max_devices}</td><td>{inr(p.monthly_price)}</td>
                                <td><button className="icon-btn" aria-label="Edit plan" onClick={() => open('plan', null, {
                                    id: p.id, name: p.name, maxStaff: p.max_staff, maxKiosks: p.max_kiosks, maxDevices: p.max_devices, monthlyPrice: p.monthly_price,
                                })}><FiEdit2 /></button></td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </section>

            {dialog?.type === 'create' && (
                <Modal title="New cafe" onClose={close} submitLabel="Create cafe" onSubmit={(e) => {
                    e.preventDefault();
                    run(() => saCreateTenant(form), `Cafe created. Deploy its site with VITE_TENANT_SLUG=${form.slug}. Owner logs in at /admin/login with ${form.ownerPhone} and the PIN.`);
                }}>
                    <label>Cafe name<input className="input" required value={form.name}
                        onChange={e => setForm({ ...form, name: e.target.value, slug: form.slugTouched ? form.slug : slugify(e.target.value) })} /></label>
                    <label>Slug (used in the site settings)<input className="input" required pattern="[a-z0-9][a-z0-9\-]{1,39}" value={form.slug}
                        onChange={e => setForm({ ...form, slug: slugify(e.target.value), slugTouched: true })} /></label>
                    <label>Plan<select className="input" value={form.planId} onChange={e => setForm({ ...form, planId: e.target.value })}>
                        {data.plans.map(p => <option key={p.id} value={p.id}>{p.name} ({p.max_staff} staff)</option>)}
                    </select></label>
                    <label>Paid until<input className="input" type="date" value={form.paidUntil} onChange={e => setForm({ ...form, paidUntil: e.target.value })} /></label>
                    <label>Owner name<input className="input" required value={form.ownerName} onChange={e => setForm({ ...form, ownerName: e.target.value })} /></label>
                    <label>Owner mobile (their login)<input className="input" required inputMode="numeric" value={form.ownerPhone}
                        onChange={e => setForm({ ...form, ownerPhone: e.target.value.replace(/\D/g, '').slice(0, 10) })} /></label>
                    <label>Owner PIN (4–6 digits)<input className="input" required inputMode="numeric" value={form.ownerPin}
                        onChange={e => setForm({ ...form, ownerPin: e.target.value.replace(/\D/g, '').slice(0, 6) })} /></label>
                    <label>Owner email (optional)<input className="input" type="email" value={form.ownerEmail} onChange={e => setForm({ ...form, ownerEmail: e.target.value })} /></label>
                </Modal>
            )}

            {dialog?.type === 'payment' && (
                <Modal title={`Payment · ${dialog.tenant.name}`} onClose={close} submitLabel="Record" onSubmit={(e) => {
                    e.preventDefault();
                    run(() => saRecordPayment(dialog.tenant.id, form.months, form.amount, form.note), 'Payment recorded and account unlocked.');
                }}>
                    <label>Months paid<input className="input" type="number" min="1" required value={form.months} onChange={e => setForm({ ...form, months: e.target.value })} /></label>
                    <label>Amount (₹)<input className="input" type="number" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} /></label>
                    <label>Note (UPI ref, cash…)<input className="input" value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} /></label>
                    <p className="muted">Extends "paid until" by the months from the later of today or the current due date, and unlocks the cafe.</p>
                </Modal>
            )}

            {dialog?.type === 'edit' && (
                <Modal title={`Edit · ${dialog.tenant.name}`} onClose={close} onSubmit={(e) => {
                    e.preventDefault();
                    run(() => saUpdateTenant(dialog.tenant.id, {
                        ...form, paidUntil: form.paidUntil || null,
                        graceDays: Number(form.graceDays) || 0, billingAmount: Number(form.billingAmount) || 0,
                    }));
                }}>
                    <label>Cafe name<input className="input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
                    <label>Plan<select className="input" value={form.planId || ''} onChange={e => setForm({ ...form, planId: e.target.value })}>
                        {data.plans.map(p => <option key={p.id} value={p.id}>{p.name} ({p.max_staff} staff)</option>)}
                    </select></label>
                    <label>Paid until<input className="input" type="date" value={form.paidUntil} onChange={e => setForm({ ...form, paidUntil: e.target.value })} /></label>
                    <label>Grace days<input className="input" type="number" min="0" value={form.graceDays} onChange={e => setForm({ ...form, graceDays: e.target.value })} /></label>
                    <label>Monthly amount (₹)<input className="input" type="number" value={form.billingAmount} onChange={e => setForm({ ...form, billingAmount: e.target.value })} /></label>
                    <label>Billing note<input className="input" value={form.billingNote} onChange={e => setForm({ ...form, billingNote: e.target.value })} /></label>
                    <label>Owner name<input className="input" value={form.ownerName} onChange={e => setForm({ ...form, ownerName: e.target.value })} /></label>
                    <label>Owner phone<input className="input" value={form.ownerPhone} onChange={e => setForm({ ...form, ownerPhone: e.target.value })} /></label>
                    <label>Owner email<input className="input" value={form.ownerEmail} onChange={e => setForm({ ...form, ownerEmail: e.target.value })} /></label>
                </Modal>
            )}

            {dialog?.type === 'pin' && (
                <Modal title={`Owner PIN · ${dialog.tenant.name}`} onClose={close} submitLabel="Set PIN" onSubmit={(e) => {
                    e.preventDefault();
                    run(() => saResetOwnerPin(dialog.tenant.id, form.pin), 'Owner PIN updated.');
                }}>
                    <label>New PIN (4–6 digits)<input className="input" required inputMode="numeric" value={form.pin}
                        onChange={e => setForm({ ...form, pin: e.target.value.replace(/\D/g, '').slice(0, 6) })} /></label>
                    <p className="muted">Resets the first Owner-role staff account of this cafe and signs it out everywhere.</p>
                </Modal>
            )}

            {dialog?.type === 'plan' && (
                <Modal title={form.id ? 'Edit plan' : 'New plan'} onClose={close} onSubmit={(e) => { e.preventDefault(); run(() => saSavePlan(form)); }}>
                    <label>Name<input className="input" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
                    <label>Staff users<input className="input" type="number" min="0" value={form.maxStaff} onChange={e => setForm({ ...form, maxStaff: e.target.value })} /></label>
                    <label>Kiosks<input className="input" type="number" min="0" value={form.maxKiosks} onChange={e => setForm({ ...form, maxKiosks: e.target.value })} /></label>
                    <label>Devices<input className="input" type="number" min="0" value={form.maxDevices} onChange={e => setForm({ ...form, maxDevices: e.target.value })} /></label>
                    <label>Price per month (₹)<input className="input" type="number" min="0" value={form.monthlyPrice} onChange={e => setForm({ ...form, monthlyPrice: e.target.value })} /></label>
                </Modal>
            )}
        </div>
    );
};

export default Superadmin;
