import React, { useCallback, useEffect, useState } from 'react';
import { FiPrinter, FiLock, FiUnlock } from 'react-icons/fi';
import { getDayClose, closeDay, reopenDay } from '../../utils/api';
import { printDayClose } from '../../lib/print';
import Modal from '../inventory/Modal';
import InfoTip from '../help/InfoTip';
import { inr } from './money';
import { BillsEquation, BalancedPill, ModesTable, SheetModal } from './BalanceSheet';
import { fmtWhen } from './when';
import './ShiftBalance.css';

const errorText = (err) => err?.response?.data?.message || err?.message || 'Something went wrong';
const n = (v) => Number(v || 0);
const dayText = (d) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }) : '');
const addDays = (iso, k) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + k); return d.toISOString().slice(0, 10); };

// A list of exceptions; hidden when empty
const Exc = ({ title, rows, render, tone = '' }) => (rows?.length ? (
    <section className={`sb-exc ${tone}`}>
        <h4>{title} <span className="sb-count">{rows.length}</span></h4>
        <ul>{rows.map((r, i) => <li key={i}>{render(r)}</li>)}</ul>
    </section>
) : null);

// Owner day close: both drawers and QR / online together, the same balance equation, money by kind, exceptions
const DayClose = () => {
    const [from, setFrom] = useState('');
    const [to, setTo] = useState('');
    const [range, setRange] = useState(false);
    const [r, setR] = useState(null);
    const [error, setError] = useState('');
    const [ask, setAsk] = useState(null); // 'close' | 'reopen'
    const [note, setNote] = useState('');
    const [busy, setBusy] = useState(false);
    const [sheet, setSheet] = useState(null);

    const load = useCallback(async () => {
        setError('');
        try {
            setR((await getDayClose(from || null, range && to ? to : from || null)).data);
        } catch (err) {
            setError(errorText(err));
        }
    }, [from, to, range]);
    useEffect(() => { load(); }, [load]);

    const act = async () => {
        setBusy(true);
        setError('');
        try {
            setR((ask === 'close' ? await closeDay(r.from, note) : await reopenDay(r.from, note)).data);
            setAsk(null);
            setNote('');
        } catch (err) {
            setError(errorText(err));
        } finally {
            setBusy(false);
        }
    };

    if (!r) return error ? <p className="error-message">{error}</p> : <p className="muted">Loading…</p>;
    const c = r.combined;
    const single = r.from === r.to;
    const closed = single && r.closed?.status === 'closed';
    const m = r.modes;
    const x = r.exceptions;
    const day = from || r.from;

    return (
        <div className="dc">
            <div className="dc-bar">
                <button className="btn btn-ghost btn-sm" aria-label="Day before" onClick={() => setFrom(addDays(day, -1))}>‹</button>
                <input className="input compact" type="date" value={day} max={r.today} onChange={e => setFrom(e.target.value)} aria-label="Day" />
                <button className="btn btn-ghost btn-sm" aria-label="Next day" disabled={day >= r.today} onClick={() => setFrom(addDays(day, 1))}>›</button>
                <label className="check small"><input type="checkbox" checked={range} onChange={e => setRange(e.target.checked)} /> Several days</label>
                {range && <input className="input compact" type="date" value={to || day} min={day} max={r.today} onChange={e => setTo(e.target.value)} aria-label="To" />}
                <span className="dc-spacer" />
                <button className="btn btn-ghost btn-sm" onClick={() => printDayClose(r)}><FiPrinter /> Print</button>
            </div>

            <div className={`dc-status ${r.status.balanced ? 'ok' : 'bad'}`} role="status">
                <strong>{r.status.balanced ? '✓ Balanced' : '✗ Not balanced:'}</strong>
                <span>{single ? dayText(r.from) : `${dayText(r.from)} – ${dayText(r.to)}`}</span>
                {!r.status.balanced && <ul>{r.status.reasons.map(t => <li key={t}>{t}</li>)}</ul>}
                {r.status.balanced && <span className="small">All shifts closed, every bill ended, bills and money add up.</span>}
            </div>

            {closed && (
                <div className="dc-closed"><FiLock /><span>Day closed by <b>{r.closed.by}</b> on {fmtWhen(r.closed.at)}{r.closed.note && ` · ${r.closed.note}`}. Nothing new can be dated this day.</span>
                    {r.isOwner && <button className="btn btn-ghost btn-sm" onClick={() => setAsk('reopen')}><FiUnlock /> Open again</button>}</div>
            )}
            {single && r.closed?.status === 'reopened' && (
                <p className="sb-warn">Opened again by {r.closed.reopenedBy} on {fmtWhen(r.closed.reopenedAt)}: {r.closed.reopenReason}</p>
            )}
            {!single && r.closedDays?.length > 0 && <p className="muted small">Closed days in this range: {r.closedDays.map(d => dayText(d.day)).join(', ')}</p>}

            <div className="dc-grid">
                <section className="panel">
                    <div className="sb-head"><h2>All bills of the {single ? 'day' : 'days'}<InfoTip k="day_close" /></h2><BalancedPill ok={c.balanced} diff={c.difference} /></div>
                    <BillsEquation b={c} receivedLabel="Received from an earlier day" handedLabel="Handed over, still open at the end" />
                    <p className="muted small">Counter, kiosk, QR and online bills together. Each drawer and QR below add up to this.</p>
                </section>
                <section className="panel">
                    <h2>Money by kind</h2>
                    <ModesTable rows={[
                        { key: 'cash', label: 'Cash (all drawers)', expected: m.cash.expected, counted: m.cash.counted ?? null, diff: m.cash.difference ?? null },
                        { key: 'upi', label: 'UPI at drawers', expected: m.upi.expected, counted: m.upi.counted ?? null, diff: m.upi.difference ?? null },
                        { key: 'upio', label: 'UPI online', note: 'check with the UPI / bank statement', expected: m.upi.online, counted: null, diff: null },
                        { key: 'card', label: 'Card', expected: n(m.card.expected) + n(m.card.noDrawer), counted: m.card.counted ?? null, diff: m.card.difference ?? null },
                    ]} />
                    <div className="kv">
                        <span className="strong">Total difference</span><span className={`num strong ${n(r.money.totalVariance) < 0 ? 'neg' : ''}`}>{inr(r.money.totalVariance)}</span>
                        <span>Cash sent to the office / safe</span><span className="num">{inr(r.money.cashToOffice)}</span>
                        {n(r.money.khataCash) + n(r.money.khataUpi) + n(r.money.khataCard) !== 0 && <><span>Khata collected (cash / UPI / card)</span><span className="num">{inr(r.money.khataCash)} / {inr(r.money.khataUpi)} / {inr(r.money.khataCard)}</span></>}
                        {n(r.money.cashIn) !== 0 && <><span>Cash in from the safe</span><span className="num">{inr(r.money.cashIn)}</span></>}
                        {n(r.money.payouts) + n(r.money.expenses) !== 0 && <><span>Pay-outs and expenses from drawers</span><span className="num">−{inr(n(r.money.payouts) + n(r.money.expenses))}</span></>}
                        {n(r.money.otherBillsCash) + n(r.money.otherBillsUpi) + n(r.money.otherBillsCard) !== 0 && <><span>Refunds / payments of other days’ bills</span>
                            <span className="num">{inr(n(r.money.otherBillsCash) + n(r.money.otherBillsUpi) + n(r.money.otherBillsCard))}</span></>}
                    </div>
                </section>
            </div>

            <h2 className="section-title">Drawers and QR</h2>
            <div className="dc-drawers">
                {r.drawers.map(d => {
                    const shifts = r.shifts.filter(s => s.drawer === d.code);
                    return (
                        <section key={d.code} className="drawer-card">
                            <div className="sb-head"><h3>{d.name}</h3>{d.shifts > 0 && <BalancedPill ok={d.balanced} diff={d.bills?.difference} okText="adds up" />}</div>
                            {d.shifts === 0 ? <p className="muted small">No shift this day.</p> : (
                                <>
                                    <div className="kv">
                                        <span>Bills made</span><span className="num">{n(d.bills.madeCount)} · {inr(d.bills.madeTotal)}</span>
                                        <span>Cash expected / counted</span><span className="num">{inr(d.cash.expected)} / {d.cash.counted == null ? '—' : inr(d.cash.counted)}</span>
                                        <span>UPI expected / app</span><span className="num">{inr(d.upi.expected)} / {d.upi.counted == null ? '—' : inr(d.upi.counted)}</span>
                                        {(n(d.card.expected) !== 0 || d.card.counted != null) && <><span>Card expected / machine</span><span className="num">{inr(d.card.expected)} / {d.card.counted == null ? '—' : inr(d.card.counted)}</span></>}
                                        <span>To the office / safe</span><span className="num">{inr(d.cash.drops)}</span>
                                    </div>
                                    <ul className="dc-shifts">
                                        {shifts.map(s => (
                                            <li key={s.id}>
                                                <span>{fmtWhen(s.openedAt)} · {s.openedBy}{s.status === 'closed' ? ` → ${fmtWhen(s.closedAt)} · ${s.closedBy}` : ''}</span>
                                                {s.status === 'open' ? <span className="sb-pill bad">open</span>
                                                    : n(s.difference) !== 0 ? <span className={`sb-pill ${Math.abs(n(s.difference)) > n(s.tolerance?.cash) ? 'bad' : 'warn'}`}>cash {inr(s.difference)}</span> : <span className="sb-pill ok">counted ✓</span>}
                                                <button className="btn btn-ghost btn-sm" onClick={() => setSheet(s)}>Sheet</button>
                                            </li>
                                        ))}
                                    </ul>
                                </>
                            )}
                        </section>
                    );
                })}
                <section className="drawer-card">
                    <div className="sb-head"><h3>QR and online (no drawer)<InfoTip k="upi_online" /></h3>{n(r.qr.madeCount) > 0 && <BalancedPill ok={r.qr.balanced} diff={r.qr.difference} okText="adds up" />}</div>
                    <p className="muted small">QR bills that no drawer accepted or collected, and aggregator imports. A QR bill accepted or paid at a drawer is counted in that drawer.</p>
                    <div className="kv">
                        <span>Bills made</span><span className="num">{n(r.qr.madeCount)} · {inr(r.qr.madeTotal)}</span>
                        {n(r.qr.online) !== 0 && <><span>UPI online</span><span className="num">{inr(r.qr.online)}</span></>}
                        {n(r.qr.aggregator) !== 0 && <><span>Aggregator (to bank)</span><span className="num">{inr(r.qr.aggregator)}</span></>}
                        {n(r.qr.khata) !== 0 && <><span>Khata</span><span className="num">{inr(r.qr.khata)}</span></>}
                        {n(r.qr.cancelled) !== 0 && <><span>Cancelled</span><span className="num">{inr(r.qr.cancelled)}</span></>}
                        {n(r.qr.open) !== 0 && <><span className="neg">Still open</span><span className="num neg">{inr(r.qr.open)}</span></>}
                    </div>
                </section>
            </div>

            <h2 className="section-title">Things to check</h2>
            <div className="dc-excs">
                <Exc title="Shifts still open" tone="bad" rows={x.openShifts} render={s => <>{s.drawerName} · opened {fmtWhen(s.openedAt)} by {s.openedBy}</>} />
                <Exc title="Bills still open" tone="bad" rows={x.openBills} render={b => <>{b.orderNumber} · <b>{inr(b.due)}</b> · {b.drawerName || (b.channel === 'qr' ? 'QR, not taken by a drawer' : b.channel)}{b.tableNumber ? ` · Table ${b.tableNumber}` : ''}</>} />
                <Exc title="Handed over to the next shift" rows={x.handedOver} render={h => <>{h.orderNumber} · {inr(h.due)} · {h.drawerName} · {h.reason} · by {h.by}, approved by <b>{h.approvedBy}</b> · {h.billStatus === 'paid' ? `paid later${h.receivedBy ? ` (shift of ${h.receivedBy})` : ''}` : h.billStatus === 'cancelled' ? 'cancelled later' : <span className="neg">still open</span>}</>} />
                <Exc title="Differences at close" tone="warn" rows={x.variances} render={v => <>{v.drawerName} · closed by {v.closedBy}{n(v.cash) !== 0 && <> · cash <b className={v.cash < 0 ? 'neg' : ''}>{inr(v.cash)}</b></>}{n(v.upi) !== 0 && <> · UPI <b>{inr(v.upi)}</b></>}{n(v.card) !== 0 && <> · card <b>{inr(v.card)}</b></>}{v.approvedBy && <> · approved by <b>{v.approvedBy}</b></>}{v.reason && <> · “{v.reason}”</>}</>} />
                <Exc title="Cancelled after the kitchen started" tone="warn" rows={x.voidsAfterKitchen} render={v => <>{v.orderNumber} · {inr(v.total)} · {v.reason}</>} />
                <Exc title="Refunds" rows={x.refunds} render={f => <>{f.orderNumber} · {inr(f.amount)} {f.method ? `by ${String(f.method).toUpperCase()}` : ''} · {f.reason} · {f.by}{f.approvedBy && `, approved by ${f.approvedBy}`}{f.kind === 'cancel' ? ' (whole bill cancelled)' : ''}</>} />
                <Exc title="Discounts given by hand" rows={x.discounts} render={d => <>{d.orderNumber} · {inr(d.amount)}{d.pct != null && ` (${d.pct}%)`} · {d.reason} · {d.by}{d.approvedBy && `, approved by ${d.approvedBy}`}{d.big && <span className="sb-pill warn">big</span>}</>} />
                <Exc title="Bills printed again" rows={x.reprints} render={p => <>{p.orderNumber} · printed {p.prints} times · {p.by}</>} />
                {!Object.values(x).some(v => v?.length) && <p className="muted">Nothing unusual.</p>}
            </div>

            {error && <p className="error-message">{error}</p>}
            {single && !closed && (
                <div className="dc-close">
                    {r.isOwner ? (
                        <>
                            <button className="btn btn-primary btn-lg" disabled={!r.canClose} onClick={() => setAsk('close')}><FiLock /> Close the day</button>
                            <span className="muted small">{r.canClose ? 'Locks this day: no new bills, payments or expenses can be dated it. Later refunds go on the day they happen.' : 'Close every shift and end every bill first.'}</span>
                        </>
                    ) : <span className="muted small">Only the owner can close the day.</span>}
                </div>
            )}

            {ask && (
                <Modal title={ask === 'close' ? `Close ${dayText(r.from)}` : `Open ${dayText(r.from)} again`} onClose={() => setAsk(null)}>
                    <div className="modal-body">
                        {ask === 'close'
                            ? <p>Bills made {inr(c.madeTotal)} · total difference {inr(r.money.totalVariance)}. After closing, nothing new can be dated this day.</p>
                            : <p className="neg">Opening a closed day again is recorded and the owner alert goes out.</p>}
                        <div className="input-group"><label>{ask === 'close' ? 'Note (optional)' : 'Why *'}</label>
                            <input className="input" value={note} onChange={e => setNote(e.target.value)} autoFocus /></div>
                        {error && <p className="error-message">{error}</p>}
                    </div>
                    <div className="modal-footer">
                        <button className="btn btn-ghost" onClick={() => setAsk(null)}>Back</button>
                        <button className="btn btn-primary" disabled={busy || (ask === 'reopen' && !note.trim())} onClick={act}>{ask === 'close' ? 'Close the day' : 'Open again'}</button>
                    </div>
                </Modal>
            )}
            {sheet && <SheetModal shift={sheet} onClose={() => setSheet(null)} />}
        </div>
    );
};

export default DayClose;
