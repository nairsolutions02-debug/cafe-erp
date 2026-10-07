import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FiPrinter } from 'react-icons/fi';
import { getCurrentShifts, openShift, closeShift, getShifts, getExpenseCategories, settleOrder, handoverBill } from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import { runOrQueue, newClientId, useOutbox } from '../../lib/outbox';
import { printZReport } from '../../lib/print';
import Modal from '../inventory/Modal';
import CancelModal from '../CancelModal';
import InfoTip from '../help/InfoTip';
import { Denominations, denomTotal, inr } from './money';
import BalanceSheet, { BillsEquation, BalancedPill, SheetModal } from './BalanceSheet';
import { fmtWhen } from './when';
import DayClose from './DayClose';
import '../AdminStaff.css';
import '../inventory/Inventory.css';
import './POS.css';
import './ShiftBalance.css';

const errorText = (err) => err?.response?.data?.message || err?.message || 'Something went wrong';
const fmt = fmtWhen;
const n = (v) => Number(v || 0);
const r2 = (v) => Math.round(n(v) * 100) / 100;

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
                {drawer.handedOver?.length > 0 && (
                    <div className="sb-note">
                        <b>Bills handed over by the last shift</b> — they join your shift; collect them like any bill:
                        <ul>{drawer.handedOver.map(b => <li key={b.orderNumber}>{b.orderNumber} · {inr(b.due)} · {b.reason} <span className="muted">(by {b.by}, approved by {b.approvedBy})</span></li>)}</ul>
                    </div>
                )}
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

// Hand an open bill to the next shift of this drawer: reason + manager mobile and PIN
const HandoverForm = ({ bill, canVoid, onClose, onDone }) => {
    const [reason, setReason] = useState('');
    const [phone, setPhone] = useState('');
    const [pin, setPin] = useState('');
    const [error, setError] = useState('');
    const submit = async () => {
        try {
            await handoverBill(bill.id, reason, phone || null, pin || null);
            onDone();
        } catch (err) {
            setError(errorText(err));
        }
    };
    return (
        <Modal title={`Hand over ${bill.orderNumber}`} onClose={onClose}>
            <div className="modal-body">
                <p className="muted">{inr(bill.due)} is still due. The bill goes to the next shift of this drawer: it shows when that shift opens, and the owner sees it in the day close.</p>
                <div className="input-group"><label>Why it goes to the next shift *</label>
                    <input className="input" value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Table 4 still eating" autoFocus /></div>
                {!canVoid && (
                    <div className="form-grid">
                        <div className="input-group"><label>Manager mobile</label><input className="input" inputMode="numeric" value={phone} onChange={e => setPhone(e.target.value)} /></div>
                        <div className="input-group"><label>Manager PIN</label><input className="input" type="password" inputMode="numeric" value={pin} onChange={e => setPin(e.target.value)} /></div>
                    </div>
                )}
                {error && <p className="error-message">{error}</p>}
            </div>
            <div className="modal-footer">
                <button className="btn btn-ghost" onClick={onClose}>Back</button>
                <button className="btn btn-primary" disabled={!reason.trim() || (!canVoid && (!phone || !pin))} onClick={submit}>Hand over</button>
            </div>
        </Modal>
    );
};

// Open bills of the shift, each with one-tap ways to end it
const OpenBills = ({ shift, canVoid, onChanged }) => {
    const [busy, setBusy] = useState('');
    const [error, setError] = useState('');
    const [cancelling, setCancelling] = useState(null);
    const [handing, setHanding] = useState(null);
    const collect = async (b, method) => {
        setBusy(b.id + method);
        setError('');
        try {
            await settleOrder(b.id, [{ method, amount: b.due }], shift.drawer);
            onChanged();
        } catch (err) {
            setError(`${b.orderNumber}: ${errorText(err)}`);
        } finally {
            setBusy('');
        }
    };
    if (!shift.openBills?.length) return null;
    return (
        <div className="sb-open">
            <h3 className="neg">Still open: {shift.openBills.length} bill{shift.openBills.length > 1 ? 's' : ''}<InfoTip k="shift_open_bills" /></h3>
            <p className="muted small">The shift closes only when every bill is paid, on khata, cancelled or handed over to the next shift.</p>
            {shift.openBills.map(b => (
                <div key={b.id} className="sb-bill">
                    <div className="sb-bill-head">
                        <b>{b.tokenNumber ? `Token ${b.tokenNumber}` : b.tableNumber ? `Table ${b.tableNumber}` : b.orderNumber}</b>
                        <span className="muted small">{b.orderNumber} · {fmt(b.createdAt)}{b.customerName ? ` · ${b.customerName}` : ''}</span>
                        <strong className="num">{inr(b.due)}</strong>
                    </div>
                    <div className="sb-bill-acts">
                        {['cash', 'upi', 'card'].map(m => (
                            <button key={m} className="btn btn-primary btn-sm" disabled={!!busy} onClick={() => collect(b, m)}>
                                {busy === b.id + m ? '…' : `Paid ${m === 'upi' ? 'UPI' : m[0].toUpperCase() + m.slice(1)}`}
                            </button>
                        ))}
                        <button className="btn btn-ghost btn-sm" disabled={!!busy || !b.customerId} title={b.customerId ? '' : 'No customer on this bill'}
                            onClick={() => collect(b, 'khata')}>Khata</button>
                        <button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => setCancelling(b)}>Cancel</button>
                        <button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => setHanding(b)}>Hand over</button>
                    </div>
                </div>
            ))}
            {error && <p className="error-message">{error}</p>}
            {cancelling && <CancelModal order={{ _id: cancelling.id, orderNumber: cancelling.orderNumber, status: cancelling.status, total: cancelling.total, amountPaid: cancelling.total - cancelling.due, items: [] }}
                canVoid={canVoid} drawer={shift.drawer} onClose={() => setCancelling(null)} onDone={() => { setCancelling(null); onChanged(); }} />}
            {handing && <HandoverForm bill={handing} canVoid={canVoid} onClose={() => setHanding(null)} onDone={() => { setHanding(null); onChanged(); }} />}
        </div>
    );
};

// Close: 1 bills must end in a state, 2 blind count (UPI and card totals when taken), 3 balance sheet + approval
const CloseForm = ({ shift, isOwner, canVoid, onClose, onDone, onChanged }) => {
    const { pending, online } = useOutbox();
    const [step, setStep] = useState('bills');
    const [denoms, setDenoms] = useState({});
    const [upi, setUpi] = useState('');
    const [card, setCard] = useState('');
    const [reason, setReason] = useState('');
    const [phone, setPhone] = useState('');
    const [pin, setPin] = useState('');
    const [error, setError] = useState('');
    const [refused, setRefused] = useState('');
    const [result, setResult] = useState(null);
    const [busy, setBusy] = useState(false);
    const needUpi = shift.upiTaken || n(shift.upiExpected) !== 0;
    const needCard = shift.cardTaken || n(shift.cardExpected) !== 0;
    const tol = shift.tolerance || {};
    const counted = { cash: denomTotal(denoms), upi: upi === '' ? null : Number(upi), card: card === '' ? null : Number(card) };
    const diffs = {
        cash: r2(counted.cash - n(shift.expectedCash)),
        upi: r2(n(counted.upi) - n(shift.upiExpected)),
        card: r2(n(counted.card) - n(shift.cardExpected)),
    };
    const over = Object.entries(diffs).filter(([m, d]) => Math.abs(d) > n(tol[m]) + 0.001);
    const openBills = shift.openBills?.length || 0;
    const unsent = pending.length;

    const submit = async () => {
        setBusy(true);
        setError('');
        try {
            const res = (await closeShift(shift.id, denoms, counted.upi, counted.card, reason, '', phone || null, pin || null)).data;
            if (res.refused) setRefused(res.message);
            else setResult(res);
        } catch (err) {
            setError(errorText(err));
        } finally {
            setBusy(false);
        }
    };

    if (result) {
        return (
            <Modal title={`Shift closed · ${result.drawerName}`} onClose={onDone} wide>
                <div className="modal-body"><BalanceSheet shift={result} /></div>
                <div className="modal-footer">
                    <button className="btn btn-ghost" onClick={() => printZReport(result)}><FiPrinter /> Print balance sheet</button>
                    <button className="btn btn-primary" onClick={onDone}>Done</button>
                </div>
            </Modal>
        );
    }
    return (
        <Modal title={`Close shift · ${shift.drawerName}`} onClose={onClose} wide>
            <div className="modal-body">
                <ol className="sb-steps" aria-label="Steps">
                    <li className={step === 'bills' ? 'on' : 'done'}>1 · Bills</li>
                    <li className={step === 'count' ? 'on' : step === 'check' ? 'done' : ''}>2 · Count</li>
                    <li className={step === 'check' ? 'on' : ''}>3 · Check and close</li>
                </ol>
                {unsent > 0 && (
                    <p className="sb-warn">This device still has {unsent} sale{unsent > 1 ? 's' : ''} waiting to be sent{online ? ' (sending now)' : ' (offline)'}. Wait until they are sent, then close: they belong to this shift.</p>
                )}
                {refused && <p className="sb-warn bad">{refused}</p>}
                {step === 'bills' && (
                    <>
                        <OpenBills shift={shift} canVoid={canVoid} onChanged={onChanged} />
                        {shift.balance && (
                            <div className="sb-sec">
                                <div className="sb-head"><h3>Bills of this shift<InfoTip k="shift_balance" /></h3><BalancedPill ok={shift.balance.balanced} diff={shift.balance.difference} /></div>
                                <BillsEquation b={shift.balance.bills} />
                            </div>
                        )}
                    </>
                )}
                {step === 'count' && (
                    <>
                        <p className="muted">Count the drawer note by note, then type the totals from the UPI app and the card machine. What was expected shows after you finish.</p>
                        <Denominations value={denoms} onChange={setDenoms} />
                        <div className="form-grid" style={{ marginTop: 12 }}>
                            <div className="input-group"><label>UPI total in the UPI app{needUpi ? ' *' : ''}<InfoTip k="shift_counts" /></label>
                                <input className="input" type="number" inputMode="decimal" value={upi} onChange={e => setUpi(e.target.value)} placeholder={needUpi ? 'Needed: UPI was taken' : 'No UPI this shift'} /></div>
                            <div className="input-group"><label>Card machine total{needCard ? ' *' : ''}</label>
                                <input className="input" type="number" inputMode="decimal" value={card} onChange={e => setCard(e.target.value)} placeholder={needCard ? 'Needed: card was taken' : 'No card this shift'} /></div>
                        </div>
                    </>
                )}
                {step === 'check' && (
                    <>
                        <BalanceSheet shift={shift} counted={counted} />
                        {over.length > 0 && (
                            <div className="sb-approve">
                                <p className="neg strong">Off by more than allowed: {over.map(([m, d]) => `${m === 'upi' ? 'UPI' : m} ${d < 0 ? 'short' : 'over'} ${inr(Math.abs(d))}`).join(', ')}.<InfoTip k="shift_variance" /></p>
                                <div className="input-group"><label>Reason for the difference *</label>
                                    <input className="input" value={reason} onChange={e => setReason(e.target.value)} autoFocus /></div>
                                {isOwner
                                    ? <p className="muted small">You are the owner: you can approve it yourself, or ask the manager to enter their PIN.</p>
                                    : <p className="muted small">Another person (manager or owner) must check the count and approve with their mobile and PIN. You cannot approve your own close.</p>}
                                <div className="form-grid">
                                    <div className="input-group"><label>Approver mobile</label><input className="input" inputMode="numeric" value={phone} onChange={e => setPhone(e.target.value)} /></div>
                                    <div className="input-group"><label>Approver PIN</label><input className="input" type="password" inputMode="numeric" value={pin} onChange={e => setPin(e.target.value)} /></div>
                                </div>
                            </div>
                        )}
                        {over.length === 0 && Object.values(diffs).some(d => d !== 0) && (
                            <div className="input-group"><label>Note on the small difference (optional)</label>
                                <input className="input" value={reason} onChange={e => setReason(e.target.value)} /></div>
                        )}
                    </>
                )}
                {error && <p className="error-message">{error}</p>}
            </div>
            <div className="modal-footer">
                {step === 'bills' && <>
                    <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
                    <button className="btn btn-primary" disabled={openBills > 0 || unsent > 0} onClick={() => setStep('count')}>
                        {openBills > 0 ? `${openBills} bill${openBills > 1 ? 's' : ''} still open` : 'Next: count the money'}
                    </button>
                </>}
                {step === 'count' && <>
                    <button className="btn btn-ghost" onClick={() => setStep('bills')}>Back</button>
                    <button className="btn btn-primary" disabled={(needUpi && upi === '') || (needCard && card === '')} onClick={() => { setError(''); setStep('check'); }}>Done counting</button>
                </>}
                {step === 'check' && <>
                    <button className="btn btn-ghost" onClick={() => setStep('count')}>Count again</button>
                    <button className="btn btn-primary" disabled={busy || unsent > 0 || (over.length > 0 && (!reason.trim() || (!isOwner && (!phone || !pin))))} onClick={submit}>
                        {busy ? 'Closing…' : 'Close shift'}
                    </button>
                </>}
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
            const res = await runOrQueue('cash_movement_view', { p_drawer: shift.drawer, p_kind: kind, p_amount: Number(amount), p_note: note,
                p_category_id: categoryId && categoryId !== 'none' ? categoryId : null, p_client_id: newClientId() }, `${kind} ${inr(amount)} ${note}`);
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
                    <div className="input-group"><label>Expense category (records it as an expense) *</label>
                        <select className="input" value={categoryId} onChange={e => setCategoryId(e.target.value)}>
                            <option value="" disabled>Choose what it was for…</option>
                            <option value="none">Not an expense (e.g. salary advance)</option>
                            {cats.map(c => <option key={c._id} value={c._id}>{c.name}</option>)}
                        </select></div>
                )}
                <div className="input-group"><label>What for</label>
                    <input className="input" value={note} onChange={e => setNote(e.target.value)} placeholder={kind === 'payout' ? 'e.g. 2 L milk' : ''} /></div>
                {error && <p className="error-message">{error}</p>}
            </div>
            <div className="modal-footer">
                <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
                <button className="btn btn-primary" disabled={!(Number(amount) > 0) || (kind === 'payout' && !categoryId)} onClick={submit}>Save</button>
            </div>
        </Modal>
    );
};

// Cash drawers: open with a count, pay-outs and drops during the shift, close when every bill is done and the money is counted
const Drawers = () => {
    const { hasPerm } = useAuth();
    const [data, setData] = useState(null);
    const [history, setHistory] = useState([]);
    const [modal, setModal] = useState(null);
    const [error, setError] = useState('');
    const canVoid = hasPerm('sensitive.void_bill');

    const load = useCallback(async () => {
        try {
            const d = (await getCurrentShifts()).data;
            setData(d);
            // keep the close screen on the fresh shift after a bill is collected or handed over
            setModal(m => (m?.type === 'close' ? { ...m, shift: d.open.find(s => s.id === m.shift.id) || m.shift } : m));
            if (hasPerm('finance.view')) setHistory((await getShifts()).data);
        } catch (err) {
            setError(errorText(err));
        }
    }, [hasPerm]);
    useEffect(() => { load(); }, [load]);
    const done = () => { setModal(null); load(); };

    if (!data) return error ? <p className="error-message">{error}</p> : <p className="muted">Loading…</p>;

    return (
        <>
            {data.dayClosed && <p className="sb-warn">The owner has closed today’s accounts. Bills and payments cannot be added to today.</p>}
            <div className="drawers">
                {data.drawers.map(d => {
                    const s = data.open.find(x => x.drawer === d.code);
                    return (
                        <div key={d.code} className="drawer-card">
                            <h2>{d.name}</h2>
                            {s ? (
                                <>
                                    <p className="muted small">Opened {fmt(s.openedAt)} by {s.openedBy}</p>
                                    {new Date(s.openedAt).toDateString() !== new Date().toDateString() && (
                                        <p className="shift-old">Open since {fmt(s.openedAt)}. Count the cash and close it, then open a fresh shift for today.</p>
                                    )}
                                    {!s.canSee && <p className="muted">Only {s.openedBy} (who opened it) and the manager see the cash in this drawer. You can still record a pay-out or move cash.</p>}
                                    {s.canSee && s.openBills?.length > 0 && (
                                        <p className="sb-chip-row"><span className="sb-pill bad">{s.openBills.length} bill{s.openBills.length > 1 ? 's' : ''} open · {inr(s.openBills.reduce((t, b) => t + n(b.due), 0))}</span></p>
                                    )}
                                    {s.canSee && s.receivedBills?.length > 0 && (
                                        <p className="small">Handed over to this shift: {s.receivedBills.map(b => `${b.orderNumber} (${inr(b.due)})`).join(', ')}</p>
                                    )}
                                    {s.canSee && !(modal?.type === 'close' && modal.shift.id === s.id) && <div className="kv">
                                        <span>Opening cash</span><span>{inr(s.openingCash)}</span>
                                        <span>Bills made</span><span>{s.balance ? `${s.balance.bills.madeCount} · ${inr(s.balance.bills.madeTotal)}` : '—'}</span>
                                        <span>Cash sales (net of refunds)</span><span>{inr(s.cashSales)}</span>
                                        {s.khataSettled > 0 && <><span>Khata collected</span><span>{inr(s.khataSettled)}</span></>}
                                        <span>Pay-outs</span><span>-{inr(s.payouts)}</span>
                                        <span>To safe</span><span>-{inr(s.drops)}</span>
                                        {s.payIns > 0 && <><span>From safe</span><span>{inr(s.payIns)}</span></>}
                                        <span className="strong">Cash expected</span><span className="strong">{inr(s.expectedCash)}</span>
                                        <span>UPI in this shift</span><span>{inr(s.upiExpected)}</span>
                                        <span>Card in this shift</span><span>{inr(s.cardExpected)}</span>
                                        <span>Orders paid</span><span>{s.orders}</span>
                                    </div>}
                                    <div className="btn-row">
                                        <button className="btn btn-ghost btn-sm" onClick={() => setModal({ type: 'move', kind: 'payout', shift: s })}>Pay out</button>
                                        <button className="btn btn-ghost btn-sm" onClick={() => setModal({ type: 'move', kind: 'drop', shift: s })}>To safe</button>
                                        <button className="btn btn-ghost btn-sm" onClick={() => setModal({ type: 'move', kind: 'pay_in', shift: s })}>From safe</button>
                                        {s.canSee && s.balance && <button className="btn btn-ghost btn-sm" onClick={() => setModal({ type: 'sheet', shift: s })}>Balance sheet</button>}
                                        {s.canClose && <button className="btn btn-primary btn-sm" onClick={() => setModal({ type: 'close', shift: s })}>Close shift</button>}
                                    </div>
                                </>
                            ) : (
                                <>
                                    <p className="muted">No open shift. Bills and payments at this drawer wait until a shift is open.{d.lastCloseCash != null && ` Last close counted ${inr(d.lastCloseCash)}.`}</p>
                                    {d.handedOver?.length > 0 && (
                                        <p className="small"><span className="sb-pill warn">{d.handedOver.length} handed over</span> {d.handedOver.map(b => `${b.orderNumber} (${inr(b.due)})`).join(', ')} — they join the next shift.</p>
                                    )}
                                    <button className="btn btn-primary" disabled={data.dayClosed} onClick={() => setModal({ type: 'open', drawer: d })}>Open shift</button>
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
                        <table className="staff-table sb-history">
                            <thead><tr><th>Drawer</th><th>Opened</th><th>Closed</th><th>Bills</th><th>Expected</th><th>Counted</th><th>Difference</th><th>UPI exp. / app</th><th>Approved / reason</th><th></th></tr></thead>
                            <tbody>
                                {history.map(s => (
                                    <tr key={s.id}>
                                        <td>{s.drawerName}</td>
                                        <td className="small">{fmt(s.openedAt)}<br />{s.openedBy}</td>
                                        <td className="small">{s.status === 'open' ? <span className="pill warn">open</span> : <>{fmt(s.closedAt)}<br />{s.closedBy}</>}</td>
                                        <td className="small">{s.balance ? <>{inr(s.balance.bills.madeTotal)}<br /><BalancedPill ok={s.balance.balanced} diff={s.balance.difference} okText="adds up" /></> : '—'}</td>
                                        <td>{inr(s.expectedCash)}</td>
                                        <td>{s.countedCash == null ? '—' : inr(s.countedCash)}</td>
                                        <td className={s.difference < 0 ? 'neg' : ''}>{s.difference == null ? '' : inr(s.difference)}</td>
                                        <td>{inr(s.upiExpected)} / {s.upiReported == null ? '—' : inr(s.upiReported)}</td>
                                        <td className="small">{s.varianceApprovedBy && <b>{s.varianceApprovedBy}</b>}{s.varianceApprovedBy && s.reason && ' · '}{s.reason}</td>
                                        <td><button className="btn btn-ghost btn-sm" onClick={() => setModal({ type: 'sheet', shift: s })}>Sheet</button></td>
                                    </tr>
                                ))}
                                {history.length === 0 && <tr><td colSpan={10} className="empty muted">No shifts yet.</td></tr>}
                            </tbody>
                        </table>
                    </div>
                </>
            )}

            {modal?.type === 'open' && <OpenForm drawer={modal.drawer} onClose={() => setModal(null)} onDone={done} />}
            {modal?.type === 'close' && <CloseForm shift={modal.shift} isOwner={data.isOwner} canVoid={canVoid} onClose={() => { setModal(null); load(); }} onDone={done} onChanged={load} />}
            {modal?.type === 'sheet' && <SheetModal shift={modal.shift} onClose={() => setModal(null)} />}
            {modal?.type === 'move' && <MoveForm shift={modal.shift} kind={modal.kind} onClose={() => setModal(null)}
                onDone={(queued) => { if (queued) alert('Saved offline; it syncs when the internet is back.'); done(); }} />}
        </>
    );
};

const AdminShifts = () => {
    const { hasPerm } = useAuth();
    const [params, setParams] = useSearchParams();
    const owner = hasPerm('finance.view');
    const tab = owner && params.get('tab') === 'day' ? 'day' : 'drawers';
    return (
        <div className="shifts-page">
            <div className="page-header"><h1>Cash &amp; Shifts</h1><p>Each drawer is opened and closed with a cash count. Every bill belongs to a shift, and a shift closes only when its bills and money add up.</p></div>
            {owner && (
                <div className="seg sb-tabs" role="tablist">
                    <button role="tab" aria-selected={tab === 'drawers'} className={tab === 'drawers' ? 'active' : ''} onClick={() => setParams({})}>Drawers</button>
                    <button role="tab" aria-selected={tab === 'day'} className={tab === 'day' ? 'active' : ''} onClick={() => setParams({ tab: 'day' })}>Day close</button>
                </div>
            )}
            {tab === 'day' ? <DayClose /> : <Drawers />}
        </div>
    );
};

export default AdminShifts;
