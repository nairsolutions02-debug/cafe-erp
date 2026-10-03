import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FiPrinter } from 'react-icons/fi';
import {
    runPayroll, getPayroll, finalizePayroll, payPayslips, getEmployees, giveAdvance, addPenalty, decidePenalty,
    getPenaltiesAdvances, requestLeave, decideLeave, getLeaveOverview, getSettings,
} from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import Modal from '../inventory/Modal';
import { inr } from '../pos/money';
import '../AdminStaff.css';
import '../AdminCatalogue.css';
import '../inventory/Inventory.css';
import '../pos/POS.css';
import './Reports.css';
import '../rewards/Rewards.css';
import IncentivesTab from './IncentivesTab';

const errorText = (err) => err?.response?.data?.message || err?.message || 'Something went wrong';
const firstOfMonth = (offset = 0) => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth() + offset, 1).toLocaleDateString('en-CA'); };
const monthLabel = (m) => new Date(m + 'T00:00:00').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
const PAY_FROM = [['bank', 'Bank'], ['cash_office', 'Cash – Office / safe'], ['upi', 'UPI'], ['cash_counter', 'Cash – Counter drawer']];

// Payslip opened in a print window (Save as PDF from the print dialog)
function printPayslip(slip, month, cafe) {
    const w = window.open('', '_blank', 'width=600,height=800');
    if (!w) { alert('Allow pop-ups to print payslips.'); return; }
    const row = (k, v) => `<tr><td>${k}</td><td style="text-align:right">${v}</td></tr>`;
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Payslip ${slip.name}</title>
      <style>body{font-family:system-ui,sans-serif;max-width:560px;margin:24px auto;color:#222} h1{font-size:20px;margin:0}
      table{width:100%;border-collapse:collapse;margin:12px 0} td{padding:6px 0;border-bottom:1px solid #eee} .t td{font-weight:700;font-size:16px}</style></head>
      <body><h1>${cafe || ''}</h1><p>Payslip · ${monthLabel(month)}</p><h2>${slip.name}</h2><p>${slip.role || ''} · ${slip.payType} pay ${inr(slip.rate)}</p>
      <table>${row('Days in month', slip.daysInMonth)}${row('Present', slip.present)}${row('Half days', slip.halfDays)}${row('Paid leave', slip.paidLeave)}
      ${row('Holidays', slip.holidays)}${row('Weekly offs', slip.weeklyOffs)}${row('Absent / unpaid leave', Number(slip.absent) + Number(slip.unpaidLeave))}
      ${row('Payable days', slip.payableDays)}${slip.hours ? row('Hours worked', slip.hours) : ''}</table>
      <table>${row('Base pay', inr(slip.basePay))}${row(`Overtime (${slip.otHours} h)`, inr(slip.otPay))}${slip.incentives ? row('Incentives', inr(slip.incentives)) : ''}
      ${row('Gross', inr(slip.gross))}${row('Advance recovered', '− ' + inr(slip.advanceRecovery))}${row('Penalties', '− ' + inr(slip.penalties))}
      <tr class="t"><td>Net pay</td><td style="text-align:right">${inr(slip.net)}</td></tr></table>
      <p>${slip.paidAt ? `Paid on ${new Date(slip.paidAt).toLocaleDateString('en-IN')} from ${slip.paidFrom}` : 'Not paid yet'}</p>
      <p style="margin-top:48px">Employee signature ____________________</p>
      <script>window.onload=function(){window.print()}</script></body></html>`);
    w.document.close();
}

const PayrollTab = () => {
    const { hasPerm } = useAuth();
    const [month, setMonth] = useState(firstOfMonth(-1));
    const [d, setD] = useState(null);
    const [cafe, setCafe] = useState('');
    const [from, setFrom] = useState('bank');
    const [error, setError] = useState('');
    const load = useCallback(async () => {
        try { setD((await getPayroll(month)).data); setError(''); } catch (err) { setError(errorText(err)); }
    }, [month]);
    useEffect(() => { load(); getSettings().then(r => setCafe(r.data.restaurant_name || '')).catch(() => {}); }, [load]);
    const act = async (fn) => { try { await fn(); await load(); } catch (err) { alert(errorText(err)); } };
    if (error) return <p className="error-message">{error}</p>;
    if (!d) return null;
    return (
        <div>
            <div className="inv-toolbar">
                <input className="input compact" type="month" value={month.slice(0, 7)} aria-label="Month" onChange={e => setMonth(`${e.target.value}-01`)} />
                <span className={`pill ${d.status === 'final' ? 'ok' : d.status === 'draft' ? 'warn' : 'muted'}`}>{d.status === 'none' ? 'not run' : d.status}</span>
                <div className="spacer" />
                {hasPerm('employees.edit') && d.status !== 'final' && (
                    <button className="btn btn-secondary" onClick={() => act(() => runPayroll(month))}>{d.status === 'draft' ? 'Recalculate' : 'Run payroll'}</button>
                )}
                {hasPerm('employees.edit') && d.status === 'draft' && (
                    <button className="btn btn-primary" onClick={() => window.confirm(`Finalize ${monthLabel(month)}? It can't be recalculated after this.`) && act(() => finalizePayroll(month))}>Finalize</button>
                )}
                {hasPerm('finance.create') && d.status === 'final' && d.totals.paid < d.totals.net && (
                    <>
                        <select className="input compact" value={from} onChange={e => setFrom(e.target.value)} aria-label="Pay from">
                            {PAY_FROM.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                        <button className="btn btn-primary" onClick={() => act(() => payPayslips(month, from))}>Pay all ({inr(d.totals.net - d.totals.paid)})</button>
                    </>
                )}
            </div>
            {d.status !== 'none' && (
                <div className="inv-summary"><span>Gross <strong>{inr(d.totals.gross)}</strong></span><span>Net <strong>{inr(d.totals.net)}</strong></span>
                    <span>Paid <strong>{inr(d.totals.paid)}</strong></span></div>
            )}
            <div className="table-scroll">
                <table className="staff-table">
                    <thead><tr><th>Employee</th><th>Payable days</th><th>OT</th><th className="num">Base</th><th className="num">OT pay</th>
                        <th className="num">Advance</th><th className="num">Penalty</th><th className="num">Net</th><th aria-label="Actions" /></tr></thead>
                    <tbody>{d.slips.map(s => (
                        <tr key={s.id}>
                            <td><strong>{s.name}</strong><div className="muted small">{s.payType} · {inr(s.rate)}</div></td>
                            <td title={`present ${s.present}, half ${s.halfDays}, paid leave ${s.paidLeave}, holidays ${s.holidays}, offs ${s.weeklyOffs}, absent ${s.absent}`}>
                                {s.payableDays} / {s.daysInMonth}<div className="muted small">P {s.present} · ½ {s.halfDays} · L {s.paidLeave} · off {s.weeklyOffs} · A {s.absent}</div></td>
                            <td>{s.otHours} h</td><td className="num">{inr(s.basePay)}</td><td className="num">{inr(s.otPay)}</td>
                            <td className="num">{s.advanceRecovery ? `−${inr(s.advanceRecovery)}` : '—'}</td>
                            <td className="num">{s.penalties ? `−${inr(s.penalties)}` : '—'}</td>
                            <td className="num"><strong>{inr(s.net)}</strong>{s.paidAt && <div className="small pos-amt">paid</div>}</td>
                            <td className="row-actions">
                                <button className="icon-btn" aria-label={`Payslip ${s.name}`} onClick={() => printPayslip(s, month, cafe)}><FiPrinter /></button>
                                {hasPerm('finance.create') && d.status === 'final' && !s.paidAt && s.net > 0 && (
                                    <button className="btn btn-ghost btn-sm" onClick={() => act(() => payPayslips(month, from, s.id))}>Pay</button>
                                )}
                            </td>
                        </tr>
                    ))}{d.slips.length === 0 && <tr><td colSpan={9} className="empty muted">Run the payroll to calculate this month from attendance, leave, advances and penalties.</td></tr>}</tbody>
                </table>
            </div>
            <p className="formula">Monthly pay = salary × payable days ÷ days in month; payable days = present + ½ half-days + paid leave + holidays + weekly offs.
                Daily = wage × days worked; hourly = rate × hours. Overtime = hours beyond the shift × OT rate. Net = gross − advance instalment − approved penalties.</p>
        </div>
    );
};

const LeaveTab = ({ employees }) => {
    const { hasPerm } = useAuth();
    const [d, setD] = useState(null);
    const [f, setF] = useState({ employeeId: '', typeId: '', from: '', to: '', half: false, reason: '' });
    const load = useCallback(async () => setD((await getLeaveOverview()).data), []);
    useEffect(() => { load(); }, [load]);
    const act = async (fn) => { try { await fn(); await load(); } catch (err) { alert(errorText(err)); } };
    if (!d) return null;
    return (
        <div>
            <h2 className="section-title">Requests</h2>
            <div className="table-scroll">
                <table className="staff-table">
                    <thead><tr><th>Employee</th><th>Type</th><th>Dates</th><th>Reason</th><th>Status</th><th aria-label="Actions" /></tr></thead>
                    <tbody>{d.requests.map(r => (
                        <tr key={r.id}><td>{r.employee}</td><td>{r.type}{r.halfDay && ' (half day)'}</td>
                            <td>{r.from}{r.to !== r.from ? ` → ${r.to}` : ''}</td><td className="small">{r.reason}</td>
                            <td><span className={`pill ${r.status === 'approved' ? 'ok' : r.status === 'pending' ? 'warn' : 'muted'}`}>{r.status}</span>
                                {r.decidedBy && <div className="muted small">{r.decidedBy}</div>}</td>
                            <td className="row-actions">{r.status === 'pending' && hasPerm('employees.edit') && <>
                                <button className="btn btn-primary btn-sm" onClick={() => act(() => decideLeave(r.id, true))}>Approve</button>
                                <button className="btn btn-ghost btn-sm" onClick={() => act(() => decideLeave(r.id, false))}>Reject</button></>}</td></tr>
                    ))}{d.requests.length === 0 && <tr><td colSpan={6} className="muted">No leave requests.</td></tr>}</tbody>
                </table>
            </div>
            {hasPerm('employees.edit') && (
                <form className="form-grid three panel" style={{ marginTop: 12 }} onSubmit={e => { e.preventDefault(); act(() => requestLeave(f.employeeId, f.typeId, f.from, f.to || f.from, f.half, f.reason)); }}>
                    <select className="input" required value={f.employeeId} onChange={e => setF({ ...f, employeeId: e.target.value })} aria-label="Employee">
                        <option value="">Employee…</option>{employees.map(e => <option key={e._id} value={e._id}>{e.name}</option>)}</select>
                    <select className="input" required value={f.typeId} onChange={e => setF({ ...f, typeId: e.target.value })} aria-label="Leave type">
                        <option value="">Leave type…</option>{d.types.map(t => <option key={t.id} value={t.id}>{t.name}{t.isPaid ? '' : ' (unpaid)'}</option>)}</select>
                    <input className="input" required type="date" value={f.from} onChange={e => setF({ ...f, from: e.target.value })} aria-label="From" />
                    <input className="input" type="date" value={f.to} onChange={e => setF({ ...f, to: e.target.value })} aria-label="To" />
                    <input className="input" placeholder="Reason" value={f.reason} onChange={e => setF({ ...f, reason: e.target.value })} />
                    <button className="btn btn-primary" type="submit">Add leave request</button>
                </form>
            )}
            <h2 className="section-title">Balances this year</h2>
            <div className="table-scroll">
                <table className="staff-table">
                    <thead><tr><th>Employee</th>{d.types.map(t => <th key={t.id}>{t.name} (used / {t.quota})</th>)}</tr></thead>
                    <tbody>{d.balances.map(b => (
                        <tr key={b.employeeId}><td>{b.name}</td>{b.leave.map(l => <td key={l.typeId} className={l.quota > 0 && l.used > l.quota ? 'neg' : ''}>{l.used} / {l.quota}</td>)}</tr>
                    ))}</tbody>
                </table>
            </div>
        </div>
    );
};

const MoneyTab = ({ employees }) => {
    const { hasPerm } = useAuth();
    const [d, setD] = useState(null);
    const [modal, setModal] = useState(null);
    const load = useCallback(async () => setD((await getPenaltiesAdvances()).data), []);
    useEffect(() => { load(); }, [load]);
    const act = async (fn) => { try { await fn(); setModal(null); await load(); } catch (err) { alert(errorText(err)); } };
    if (!d) return null;
    return (
        <div>
            {hasPerm('employees.edit') && (
                <div className="inv-toolbar">
                    <button className="btn btn-secondary" onClick={() => setModal({ type: 'advance', employeeId: '', amount: '', instalment: '', account: 'cash_office', note: '' })}>Give advance</button>
                    <button className="btn btn-secondary" onClick={() => setModal({ type: 'penalty', employeeId: '', amount: '', reason: '', date: '' })}>Add penalty</button>
                </div>
            )}
            <div className="finance-grid">
                <section className="panel">
                    <h2>Advances</h2>
                    <table className="staff-table"><thead><tr><th>Employee</th><th>Given</th><th>Per month</th><th>Left</th></tr></thead>
                        <tbody>{d.advances.map(a => <tr key={a.id}><td>{a.employee}<div className="muted small">{a.date}{a.note && ` · ${a.note}`}</div></td>
                            <td>{inr(a.amount)}</td><td>{inr(a.instalment)}</td><td>{inr(a.remaining)}</td></tr>)}
                            {d.advances.length === 0 && <tr><td colSpan={4} className="muted">None.</td></tr>}</tbody></table>
                </section>
                <section className="panel">
                    <h2>Penalties</h2>
                    <table className="staff-table"><thead><tr><th>Employee</th><th>Reason</th><th>₹</th><th>Status</th></tr></thead>
                        <tbody>{d.penalties.map(p => <tr key={p.id}><td>{p.employee}<div className="muted small">{p.date} · by {p.requestedBy}</div></td><td>{p.reason}</td><td>{inr(p.amount)}</td>
                            <td>{p.status === 'pending' && hasPerm('employees.edit') ? <span className="row-actions start">
                                <button className="btn btn-primary btn-sm" onClick={() => act(() => decidePenalty(p.id, true))}>Approve</button>
                                <button className="btn btn-ghost btn-sm" onClick={() => act(() => decidePenalty(p.id, false))}>Reject</button></span>
                                : <span className={`pill ${p.status === 'approved' ? 'ok' : 'muted'}`}>{p.status}</span>}</td></tr>)}
                            {d.penalties.length === 0 && <tr><td colSpan={4} className="muted">None.</td></tr>}</tbody></table>
                    <p className="muted small">A penalty needs a second person to approve. Approved penalties are deducted in that month's payroll and shown on the payslip.</p>
                </section>
            </div>
            {modal && (
                <Modal title={modal.type === 'advance' ? 'Give advance' : 'Add penalty'} onClose={() => setModal(null)}>
                    <div className="modal-body">
                        <select className="input" value={modal.employeeId} onChange={e => setModal({ ...modal, employeeId: e.target.value })} aria-label="Employee">
                            <option value="">Employee…</option>{employees.map(e => <option key={e._id} value={e._id}>{e.name}</option>)}</select>
                        <input className="input" type="number" placeholder="Amount ₹" value={modal.amount} onChange={e => setModal({ ...modal, amount: e.target.value })} aria-label="Amount" style={{ marginTop: 8 }} />
                        {modal.type === 'advance' ? <>
                            <input className="input" type="number" placeholder="Recover per month ₹ (blank = all next month)" value={modal.instalment} onChange={e => setModal({ ...modal, instalment: e.target.value })} aria-label="Instalment" style={{ marginTop: 8 }} />
                            <select className="input" value={modal.account} onChange={e => setModal({ ...modal, account: e.target.value })} aria-label="Paid from" style={{ marginTop: 8 }}>
                                {PAY_FROM.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                            <input className="input" placeholder="Note" value={modal.note} onChange={e => setModal({ ...modal, note: e.target.value })} style={{ marginTop: 8 }} />
                        </> : <>
                            <input className="input" placeholder="Reason (late, breakage…)" value={modal.reason} onChange={e => setModal({ ...modal, reason: e.target.value })} aria-label="Reason" style={{ marginTop: 8 }} />
                            <input className="input" type="date" value={modal.date} onChange={e => setModal({ ...modal, date: e.target.value })} aria-label="Date" style={{ marginTop: 8 }} />
                        </>}
                    </div>
                    <div className="modal-footer">
                        <button className="btn btn-ghost" onClick={() => setModal(null)}>Cancel</button>
                        <button className="btn btn-primary" disabled={!modal.employeeId || !(Number(modal.amount) > 0)} onClick={() => act(() => (modal.type === 'advance'
                            ? giveAdvance(modal.employeeId, modal.amount, modal.instalment || modal.amount, modal.account, modal.note)
                            : addPenalty(modal.employeeId, modal.date || null, modal.reason, modal.amount)))}>Save</button>
                    </div>
                </Modal>
            )}
        </div>
    );
};

const TABS = [['payroll', 'Payroll'], ['leave', 'Leave'], ['money', 'Advances & penalties'], ['incentives', 'Incentives']];

const AdminPayroll = () => {
    const [params, setParams] = useSearchParams();
    const tab = TABS.some(([k]) => k === params.get('tab')) ? params.get('tab') : (params.get('tab') === 'penalties' ? 'money' : 'payroll');
    const [employees, setEmployees] = useState([]);
    useEffect(() => { getEmployees({ isActive: true }).then(r => setEmployees(r.data)).catch(() => {}); }, []);
    return (
        <div className="finance-page inv">
            <div className="page-header"><h1>Payroll</h1><p>Monthly pay from attendance, leave, overtime, advances and penalties; payslips; paid through the money ledger.</p></div>
            <div className="tabs" role="tablist">
                {TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''}
                    onClick={() => setParams(k === 'payroll' ? {} : { tab: k })}>{l}</button>)}
            </div>
            {tab === 'payroll' && <PayrollTab />}
            {tab === 'leave' && <LeaveTab employees={employees} />}
            {tab === 'money' && <MoneyTab employees={employees} />}
            {tab === 'incentives' && <IncentivesTab />}
        </div>
    );
};

export default AdminPayroll;
