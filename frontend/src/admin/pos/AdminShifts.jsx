import React, { useCallback, useEffect, useState } from 'react';
import { getCurrentShifts, openShift, closeShift, getShifts, getExpenseCategories } from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import { runOrQueue, newClientId } from '../../lib/outbox';
import Modal from '../inventory/Modal';
import { Denominations, denomTotal, inr } from './money';
import '../AdminStaff.css';
import '../inventory/Inventory.css';
import './POS.css';

const errorText = (err) => err?.response?.data?.message || err?.message || 'Something went wrong';
const fmt = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

const OpenForm = ({ drawer, onClose, onDone }) => {
    const [denoms, setDenoms] = useState({});
    const [error, setError] = useState('');
    const submit = async () => {
        try {
            await openShift(drawer.code, denoms);
            onDone();
        } catch (err) {
            setError(errorText(err));
        }
    };
    return (
        <Modal title={`Open shift · ${drawer.name}`} onClose={onClose}>
            <div className="modal-body">
                <p className="muted">Count the cash in the drawer note by note.{drawer.lastCloseCash != null && ` Last close counted ${inr(drawer.lastCloseCash)}.`}</p>
                <Denominations value={denoms} onChange={setDenoms} />
                {drawer.lastCloseCash != null && Math.abs(denomTotal(denoms) - drawer.lastCloseCash) > 0.5 && denomTotal(denoms) > 0 && (
                    <p className="neg small">Different from the last close by {inr(denomTotal(denoms) - drawer.lastCloseCash)}. The owner will be told.</p>
                )}
                {error && <p className="error-message">{error}</p>}
            </div>
            <div className="modal-footer">
                <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
                <button className="btn btn-primary" onClick={submit}>Open shift with {inr(denomTotal(denoms))}</button>
            </div>
        </Modal>
    );
};

const CloseForm = ({ shift, tolerance, onClose, onDone }) => {
    const [denoms, setDenoms] = useState({});
    const [upi, setUpi] = useState('');
    const [card, setCard] = useState('');
    const [reason, setReason] = useState('');
    const [error, setError] = useState('');
    const [result, setResult] = useState(null);
    const counted = denomTotal(denoms);
    const diff = counted - shift.expectedCash;
    const submit = async () => {
        try {
            setResult((await closeShift(shift.id, denoms, upi === '' ? null : Number(upi), card === '' ? null : Number(card), reason)).data);
        } catch (err) {
            setError(errorText(err));
        }
    };
    if (result) {
        return (
            <Modal title="Shift closed" onClose={onDone}>
                <div className="modal-body">
                    <div className="kv">
                        <span>Expected cash</span><span>{inr(result.expectedCash)}</span>
                        <span>Counted</span><span>{inr(result.countedCash)}</span>
                        <span className="strong">Difference</span><span className={`strong ${result.difference < 0 ? 'neg' : ''}`}>{inr(result.difference)}</span>
                        <span>UPI expected / app</span><span>{inr(result.upiExpected)} / {result.upiReported == null ? '—' : inr(result.upiReported)}</span>
                        <span>Card expected / machine</span><span>{inr(result.cardExpected)} / {result.cardReported == null ? '—' : inr(result.cardReported)}</span>
                    </div>
                </div>
                <div className="modal-footer"><button className="btn btn-primary" onClick={onDone}>Done</button></div>
            </Modal>
        );
    }
    return (
        <Modal title={`Close shift · ${shift.drawerName}`} onClose={onClose}>
            <div className="modal-body">
                <p className="muted">Count the drawer without looking at the expected amount, then compare.</p>
                <Denominations value={denoms} onChange={setDenoms} />
                <div className="form-grid" style={{ marginTop: 12 }}>
                    <div className="input-group"><label>UPI total in the UPI app</label>
                        <input className="input" type="number" value={upi} onChange={e => setUpi(e.target.value)} /></div>
                    <div className="input-group"><label>Card machine total</label>
                        <input className="input" type="number" value={card} onChange={e => setCard(e.target.value)} /></div>
                </div>
                {counted > 0 && (
                    <p className={Math.abs(diff) > tolerance ? 'neg' : 'muted'}>
                        Expected {inr(shift.expectedCash)} · difference {inr(diff)}{Math.abs(diff) > tolerance && ' — write the reason'}
                    </p>
                )}
                <div className="input-group"><label>Reason for any difference</label>
                    <input className="input" value={reason} onChange={e => setReason(e.target.value)} /></div>
                {error && <p className="error-message">{error}</p>}
            </div>
            <div className="modal-footer">
                <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
                <button className="btn btn-primary" onClick={submit}>Close shift</button>
            </div>
        </Modal>
    );
};

const MoveForm = ({ shift, kind, onClose, onDone }) => {
    const [amount, setAmount] = useState('');
    const [note, setNote] = useState('');
    const [categoryId, setCategoryId] = useState('');
    const [cats, setCats] = useState([]);
    const [error, setError] = useState('');
    useEffect(() => { if (kind === 'payout') getExpenseCategories().then(r => setCats(r.data.filter(c => c.isActive))).catch(() => {}); }, [kind]);
    const submit = async () => {
        try {
            const res = await runOrQueue('cash_movement', { p_drawer: shift.drawer, p_kind: kind, p_amount: Number(amount), p_note: note,
                p_category_id: categoryId || null, p_client_id: newClientId() }, `${kind} ${inr(amount)} ${note}`);
            onDone(res.queued);
        } catch (err) {
            setError(errorText(err));
        }
    };
    const title = { payout: 'Pay out from drawer', drop: 'Move cash to safe', pay_in: 'Add cash from safe' }[kind];
    return (
        <Modal title={title} onClose={onClose}>
            <div className="modal-body">
                <div className="input-group"><label>Amount (₹)</label>
                    <input className="input" type="number" value={amount} onChange={e => setAmount(e.target.value)} autoFocus /></div>
                {kind === 'payout' && (
                    <div className="input-group"><label>Expense category (records it as an expense)</label>
                        <select className="input" value={categoryId} onChange={e => setCategoryId(e.target.value)}>
                            <option value="">Not an expense (e.g. advance)</option>
                            {cats.map(c => <option key={c._id} value={c._id}>{c.name}</option>)}
                        </select></div>
                )}
                <div className="input-group"><label>What for</label>
                    <input className="input" value={note} onChange={e => setNote(e.target.value)} placeholder={kind === 'payout' ? 'e.g. 2 L milk' : ''} /></div>
                {error && <p className="error-message">{error}</p>}
            </div>
            <div className="modal-footer">
                <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
                <button className="btn btn-primary" disabled={!(Number(amount) > 0)} onClick={submit}>Save</button>
            </div>
        </Modal>
    );
};

// Cash drawers: open with a count, pay-outs and drops during the shift, close with a count
const AdminShifts = () => {
    const { hasPerm } = useAuth();
    const [data, setData] = useState(null);
    const [history, setHistory] = useState([]);
    const [modal, setModal] = useState(null);
    const [error, setError] = useState('');

    const load = useCallback(async () => {
        try {
            setData((await getCurrentShifts()).data);
            if (hasPerm('finance.view')) setHistory((await getShifts()).data);
        } catch (err) {
            setError(errorText(err));
        }
    }, [hasPerm]);
    useEffect(() => { load(); }, [load]);
    const done = () => { setModal(null); load(); };

    if (!data) return <div className="shifts-page">{error ? <p className="error-message">{error}</p> : 'Loading…'}</div>;

    return (
        <div className="shifts-page">
            <div className="page-header"><h1>Cash &amp; Shifts</h1><p>Each drawer is opened and closed with a cash count.</p></div>
            <div className="drawers">
                {data.drawers.map(d => {
                    const s = data.open.find(x => x.drawer === d.code);
                    return (
                        <div key={d.code} className="drawer-card">
                            <h2>{d.name}</h2>
                            {s ? (
                                <>
                                    <p className="muted small">Opened {fmt(s.openedAt)} by {s.openedBy}</p>
                                    <div className="kv">
                                        <span>Opening cash</span><span>{inr(s.openingCash)}</span>
                                        <span>Cash sales (net of refunds)</span><span>{inr(s.cashSales)}</span>
                                        {s.khataSettled > 0 && <><span>Khata collected</span><span>{inr(s.khataSettled)}</span></>}
                                        <span>Pay-outs</span><span>-{inr(s.payouts)}</span>
                                        <span>To safe</span><span>-{inr(s.drops)}</span>
                                        {s.payIns > 0 && <><span>From safe</span><span>{inr(s.payIns)}</span></>}
                                        <span className="strong">Cash expected</span><span className="strong">{inr(s.expectedCash)}</span>
                                        <span>UPI in this shift</span><span>{inr(s.upiExpected)}</span>
                                        <span>Card in this shift</span><span>{inr(s.cardExpected)}</span>
                                        <span>Orders paid</span><span>{s.orders}</span>
                                    </div>
                                    <div className="btn-row">
                                        <button className="btn btn-ghost btn-sm" onClick={() => setModal({ type: 'move', kind: 'payout', shift: s })}>Pay out</button>
                                        <button className="btn btn-ghost btn-sm" onClick={() => setModal({ type: 'move', kind: 'drop', shift: s })}>To safe</button>
                                        <button className="btn btn-ghost btn-sm" onClick={() => setModal({ type: 'move', kind: 'pay_in', shift: s })}>From safe</button>
                                        <button className="btn btn-primary btn-sm" onClick={() => setModal({ type: 'close', shift: s })}>Close shift</button>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <p className="muted">No open shift.{d.lastCloseCash != null && ` Last close counted ${inr(d.lastCloseCash)}.`}</p>
                                    <button className="btn btn-primary" onClick={() => setModal({ type: 'open', drawer: d })}>Open shift</button>
                                </>
                            )}
                        </div>
                    );
                })}
            </div>

            {hasPerm('finance.view') && (
                <>
                    <h2 className="section-title">Past shifts</h2>
                    <div className="table-scroll">
                        <table className="staff-table">
                            <thead><tr><th>Drawer</th><th>Opened</th><th>Closed</th><th>Expected</th><th>Counted</th><th>Difference</th><th>UPI exp. / app</th><th>Reason</th></tr></thead>
                            <tbody>
                                {history.map(s => (
                                    <tr key={s.id}>
                                        <td>{s.drawerName}</td>
                                        <td className="small">{fmt(s.openedAt)}<br />{s.openedBy}</td>
                                        <td className="small">{s.status === 'open' ? <span className="pill warn">open</span> : <>{fmt(s.closedAt)}<br />{s.closedBy}</>}</td>
                                        <td>{inr(s.expectedCash)}</td>
                                        <td>{s.countedCash == null ? '—' : inr(s.countedCash)}</td>
                                        <td className={s.difference < 0 ? 'neg' : ''}>{s.difference == null ? '' : inr(s.difference)}</td>
                                        <td>{inr(s.upiExpected)} / {s.upiReported == null ? '—' : inr(s.upiReported)}</td>
                                        <td className="small">{s.reason}</td>
                                    </tr>
                                ))}
                                {history.length === 0 && <tr><td colSpan={8} className="empty muted">No shifts yet.</td></tr>}
                            </tbody>
                        </table>
                    </div>
                </>
            )}

            {modal?.type === 'open' && <OpenForm drawer={modal.drawer} onClose={() => setModal(null)} onDone={done} />}
            {modal?.type === 'close' && <CloseForm shift={modal.shift} tolerance={data.tolerance} onClose={() => setModal(null)} onDone={done} />}
            {modal?.type === 'move' && <MoveForm shift={modal.shift} kind={modal.kind} onClose={() => setModal(null)}
                onDone={(queued) => { if (queued) alert('Saved offline; it syncs when the internet is back.'); done(); }} />}
        </div>
    );
};

export default AdminShifts;
