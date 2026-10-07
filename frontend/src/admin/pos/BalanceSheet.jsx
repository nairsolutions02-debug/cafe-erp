import React from 'react';
import { FiPrinter } from 'react-icons/fi';
import Modal from '../inventory/Modal';
import { printZReport } from '../../lib/print';
import { inr } from './money';
import { fmtWhen } from './when';
import InfoTip from '../help/InfoTip';
import './ShiftBalance.css';

const n = (v) => Number(v || 0);
const sign = (v) => (n(v) > 0 ? `+${inr(v)}` : n(v) < 0 ? `−${inr(-n(v))}` : inr(0));
const MODE = { cash: 'Cash', upi: 'UPI', card: 'Card' };

// One line of the equation; hidden when zero unless `always`
const Row = ({ label, value, count, always, cls = '', tip }) => (always || n(value) !== 0) ? (
    <>
        <span className={cls}>{label}{count ? <span className="muted"> ({count})</span> : null}{tip && <InfoTip k={tip} />}</span>
        <span className={`num ${cls}`}>{inr(value)}</span>
    </>
) : null;

// The bills of a shift (or of a day): bills made = how each one ended
export const BillsEquation = ({ b, receivedLabel = 'Received from the last shift', handedLabel = 'Handed over to the next shift', extra = null }) => {
    if (!b) return null;
    const accounted = n(b.paidCash) + n(b.paidUpi) + n(b.paidCard) + n(b.khata) + n(b.online ?? b.upiOnline) + n(b.otherDrawer) + n(b.aggregator)
        + n(b.otherQr) + n(b.cancelled) + n(b.refunded) + n(b.handedOver) + n(b.open);
    return (
        <div className="sb-eq">
            <div className="kv">
                <span className="strong">Bills made <span className="muted">({n(b.madeCount)})</span></span><span className="num strong">{inr(b.madeTotal)}</span>
                <Row label={receivedLabel} value={b.receivedTotal ?? b.receivedBefore} count={b.receivedCount} cls="strong" />
            </div>
            <div className="sb-eq-sign" aria-hidden="true">=</div>
            <div className="kv">
                <Row label="Paid cash" value={b.paidCash} always />
                <Row label="Paid UPI" value={b.paidUpi} always />
                <Row label="Paid card" value={b.paidCard} always />
                <Row label="Khata (credit)" value={b.khata} />
                <Row label="UPI online (no drawer)" value={b.online ?? b.upiOnline} tip="upi_online" />
                <Row label="Paid at another drawer" value={b.otherDrawer} />
                <Row label="Aggregator (paid to bank)" value={b.aggregator} />
                <Row label="Paid elsewhere" value={b.otherQr} />
                <Row label="Cancelled" value={b.cancelled} count={b.cancelledCount} />
                <Row label="Refunded" value={b.refunded} count={b.refundedCount} />
                <Row label={handedLabel} value={b.handedOver} count={b.handedCount} tip="shift_handover" />
                <Row label="Still open" value={b.open} count={b.openCount} cls="neg" />
                {extra}
                <span className="strong sb-total">Adds up to</span><span className="num strong sb-total">{inr(accounted)}</span>
            </div>
        </div>
    );
};

export const BalancedPill = ({ ok, diff, okText = 'Bills add up' }) => (
    <span className={`sb-pill ${ok ? 'ok' : 'bad'}`}>{ok ? `✓ ${okText}` : `✗ Off by ${inr(diff)}`}</span>
);

// Expected vs counted, one row per kind of money
export const ModesTable = ({ rows }) => (
    <div className="table-scroll">
        <table className="staff-table sb-modes">
            <thead><tr><th>Money</th><th>Expected</th><th>Counted</th><th>Difference</th></tr></thead>
            <tbody>
                {rows.map(r => {
                    const off = r.diff != null && r.tol != null && Math.abs(r.diff) > r.tol + 0.001;
                    return (
                        <tr key={r.key}>
                            <td>{r.label}{r.note && <div className="muted small">{r.note}</div>}</td>
                            <td className="num">{inr(r.expected)}</td>
                            <td className="num">{r.counted == null ? '—' : inr(r.counted)}</td>
                            <td className={`num ${off ? 'neg strong' : r.diff ? 'warn-txt' : ''}`}>
                                {r.diff == null ? '—' : sign(r.diff)}{off && r.tol != null && <div className="small">limit ₹{r.tol}</div>}
                            </td>
                        </tr>
                    );
                })}
            </tbody>
        </table>
    </div>
);

// Z-report of one shift. counted = { cash, upi, card } typed on the close screen (before the server has them)
const BalanceSheet = ({ shift, counted = null, hideMoney = false }) => {
    const bal = shift?.balance;
    if (!bal) return <p className="muted">No balance sheet: this shift was closed before balance sheets existed.</p>;
    const b = bal.bills;
    const c = bal.cash || {};
    const u = bal.upi || {};
    const k = bal.card || {};
    const tol = shift.tolerance || {};
    const got = (m, server) => (counted && counted[m] !== undefined ? counted[m] : server);
    const diff = (exp, cnt) => (cnt == null ? null : Math.round((n(cnt) - n(exp)) * 100) / 100);
    const rows = [
        { key: 'cash', label: MODE.cash, expected: c.expected, counted: got('cash', c.counted), tol: n(tol.cash) },
        { key: 'upi', label: MODE.upi, expected: u.expected, counted: got('upi', u.counted), tol: n(tol.upi), note: 'UPI app total' },
        { key: 'card', label: MODE.card, expected: k.expected, counted: got('card', k.counted), tol: n(tol.card), note: 'card machine total' },
    ].map(r => ({ ...r, diff: diff(r.expected, r.counted) }))
        .filter(r => r.key === 'cash' || n(r.expected) !== 0 || r.counted != null);
    const notFromBills = [
        ['Khata collected (cash)', c.khata], ['Khata collected (UPI)', u.khata], ['Khata collected (card)', k.khata],
        ['Cash in from the safe', c.payIns], ['Pay-outs', -n(c.payouts)], ['Expenses paid from the drawer', -n(c.expenses)],
        ['Cash to the safe / office', -n(c.drops)],
        ['Other bills paid or refunded here (cash)', c.otherBills], ['Other bills paid or refunded here (UPI)', u.otherBills],
        ['Other bills paid or refunded here (card)', k.otherBills], ['Other cash entries', c.other], ['Other UPI entries', u.other],
    ].filter(([, v]) => n(v) !== 0);
    return (
        <div className="sb">
            <section className="sb-sec">
                <div className="sb-head"><h3>Bills of this shift<InfoTip k="shift_balance" /></h3><BalancedPill ok={bal.balanced} diff={bal.difference} /></div>
                <BillsEquation b={b} />
                {!bal.balanced && b.problems?.length > 0 && (
                    <p className="neg small">These bills do not match their payments: {b.problems.map(p => `${p.orderNumber} (${inr(p.off)})`).join(', ')}. The owner has been told.</p>
                )}
            </section>
            {!hideMoney && (
                <>
                    <section className="sb-sec">
                        <h3>Money not from this shift’s bills</h3>
                        {notFromBills.length ? (
                            <div className="kv">{notFromBills.map(([l, v]) => <React.Fragment key={l}><span>{l}</span><span className="num">{sign(v)}</span></React.Fragment>)}</div>
                        ) : <p className="muted small">None.</p>}
                    </section>
                    <section className="sb-sec">
                        <h3>Expected and counted</h3>
                        <p className="muted small sb-formula">
                            Cash expected = opening {inr(c.opening)} {sign(c.fromBills)} from bills
                            {n(c.khata) !== 0 && <> {sign(c.khata)} khata</>}{n(c.payIns) !== 0 && <> {sign(c.payIns)} from safe</>}
                            {n(c.payouts) !== 0 && <> {sign(-n(c.payouts))} pay-outs</>}{n(c.expenses) !== 0 && <> {sign(-n(c.expenses))} expenses</>}
                            {n(c.drops) !== 0 && <> {sign(-n(c.drops))} to safe</>}{n(c.otherBills) !== 0 && <> {sign(c.otherBills)} other bills</>}
                            {n(c.other) !== 0 && <> {sign(c.other)} other</>} = <b>{inr(c.expected)}</b>
                        </p>
                        <ModesTable rows={rows} />
                        {shift.varianceApprovedBy && <p className="small">Difference approved by <b>{shift.varianceApprovedBy}</b>{shift.reason && <> · {shift.reason}</>}</p>}
                        {!shift.varianceApprovedBy && shift.reason && <p className="small">Reason: {shift.reason}</p>}
                    </section>
                </>
            )}
        </div>
    );
};

// A past shift: its balance sheet, printable
export const SheetModal = ({ shift, onClose }) => (
    <Modal title={`${shift.drawerName} · ${fmtWhen(shift.openedAt)}${shift.closedAt ? ` → ${fmtWhen(shift.closedAt)}` : ''}`} onClose={onClose} wide>
        <div className="modal-body"><BalanceSheet shift={shift} /></div>
        <div className="modal-footer">
            {shift.balance && <button className="btn btn-ghost" onClick={() => printZReport(shift)}><FiPrinter /> Print</button>}
            <button className="btn btn-primary" onClick={onClose}>Close</button>
        </div>
    </Modal>
);

export default BalanceSheet;
