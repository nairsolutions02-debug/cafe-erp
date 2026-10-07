import React, { useEffect, useMemo, useState } from 'react';
import { FiMinus, FiPlus, FiPrinter } from 'react-icons/fi';
import { previewRefund, refundItems } from '../utils/api';
import { printRefundSlip } from '../lib/print';
import Modal from './inventory/Modal';
import { inr } from './pos/money';
import './RefundModal.css';

const errText = (err) => err?.response?.data?.message || err?.message || 'Something went wrong';
const METHOD_LABEL = { cash: 'Cash', upi: 'UPI', card: 'Card', khata: 'Take off khata' };

// Refund some items of a paid bill: pick lines and how many, see exactly what goes back, choose how the money goes back.
// Food is not put back in stock unless ticked; packaged and restricted items are ticked to go back on the shelf.
const RefundModal = ({ order, canVoid, drawer = null, onClose, onDone, onBack }) => {
    const items = useMemo(() => (order.items || []).map(i => ({ ...i, left: Number(i.quantity) - Number(i.refundedQty || 0) })), [order]);
    const [qty, setQty] = useState({});
    const [restock, setRestock] = useState(() => Object.fromEntries(items.map(i => [i._id, !!i.restockDefault])));
    const paidKhata = (order.payments || []).some(p => p.method === 'khata' && Number(p.amount) > 0);
    const methods = ['cash', 'upi', 'card', ...(paidKhata ? ['khata'] : [])];
    const firstPaid = [...(order.payments || [])].sort((a, b) => Number(b.amount) - Number(a.amount))[0]?.method;
    const [method, setMethod] = useState(methods.includes(firstPaid) ? firstPaid : 'cash');
    const [reason, setReason] = useState('');
    const [phone, setPhone] = useState('');
    const [pin, setPin] = useState('');
    const [quote, setQuote] = useState(null);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [done, setDone] = useState(null);

    const picked = items.filter(i => (qty[i._id] || 0) > 0).map(i => ({ orderItemId: i._id, quantity: qty[i._id], restock: !!restock[i._id] }));
    const key = JSON.stringify(picked) + method;
    useEffect(() => {
        if (!picked.length) { setQuote(null); return undefined; }
        const t = setTimeout(() => {
            previewRefund(order._id, picked, method).then(r => { setQuote(r.data); setError(''); }).catch(e => { setQuote(null); setError(errText(e)); });
        }, 200);
        return () => clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key, order._id]);

    const step = (i, d) => setQty(q => ({ ...q, [i._id]: Math.max(0, Math.min(i.left, (q[i._id] || 0) + d)) }));
    const submit = async () => {
        setBusy(true);
        try {
            const res = (await refundItems(order._id, { lines: picked, method, reason, drawer, approverPhone: phone || null, approverPin: pin || null })).data;
            setDone(res);
        } catch (err) {
            setError(errText(err));
        } finally {
            setBusy(false);
        }
    };

    if (done) {
        return (
            <Modal title={`Refunded ${inr(done.refund.amount)}`} onClose={() => onDone(done)}>
                <div className="modal-body refund-done">
                    <p><strong>{inr(done.refund.amount)}</strong> {done.refund.method === 'khata' ? 'taken off the khata' : `given back by ${METHOD_LABEL[done.refund.method]}`} for order {done.orderNumber}.</p>
                    <ul className="refund-done-lines">{done.refund.lines.map(l => <li key={l.orderItemId}>{l.quantity} × {l.name} · {inr(l.amount)}{l.restock ? ' · back in stock' : ''}</li>)}</ul>
                    {done.refund.pointsReversed > 0 && <p className="muted small">{done.refund.pointsReversed} points taken back from the customer{done.refund.pointsShortfall > 0 ? ` (${done.refund.pointsShortfall} already spent)` : ''}.</p>}
                </div>
                <div className="modal-footer">
                    <button className="btn btn-ghost" onClick={() => printRefundSlip(done, done.refund)}><FiPrinter /> Print refund slip</button>
                    <button className="btn btn-primary" onClick={() => onDone(done)}>Done</button>
                </div>
            </Modal>
        );
    }

    const lineQuote = (id) => quote?.lines?.find(l => l.orderItemId === id);
    return (
        <Modal title={`Refund items · ${order.orderNumber}`} onClose={onClose} wide>
            <div className="modal-body refund-modal">
                <p className="muted small">Pick what the customer is returning. The amount is exactly what they paid for those items, with their share of any discount and GST.</p>
                <ul className="refund-lines">
                    {items.map(i => {
                        const n = qty[i._id] || 0;
                        const q = lineQuote(i._id);
                        return (
                            <li key={i._id} className={`refund-line${i.left === 0 ? ' gone' : ''}${n > 0 ? ' on' : ''}`}>
                                <div className="refund-line-name">
                                    <b>{i.name}</b>
                                    <span className="muted small">
                                        {i.quantity} sold{Number(i.refundedQty) > 0 ? ` · ${i.refundedQty} refunded before` : ''}{i.comboId ? ' · whole combo' : ''}
                                    </span>
                                </div>
                                {i.left > 0 ? (
                                    <div className="refund-step" role="group" aria-label={`How many ${i.name}`}>
                                        <button type="button" aria-label={`One less ${i.name}`} onClick={() => step(i, -1)} disabled={n === 0}><FiMinus /></button>
                                        <span className="qty">{n}</span>
                                        <button type="button" aria-label={`One more ${i.name}`} onClick={() => step(i, 1)} disabled={n >= i.left}><FiPlus /></button>
                                    </div>
                                ) : <span className="muted small">all refunded</span>}
                                <span className="refund-line-amt num">{n > 0 && q ? inr(q.amount) : ''}</span>
                                {i.left > 0 && (
                                    <label className="check small refund-restock">
                                        <input type="checkbox" checked={!!restock[i._id]} onChange={e => setRestock(r => ({ ...r, [i._id]: e.target.checked }))} />
                                        Put back in stock
                                    </label>
                                )}
                            </li>
                        );
                    })}
                </ul>

                <div className="refund-total">
                    <span>To give back</span>
                    <strong>{quote ? inr(quote.amount) : inr(0)}</strong>
                    {quote && <span className="muted small">incl. GST {inr(quote.tax)}{quote.discount > 0 ? ` · after discount ${inr(quote.discount)}` : ''}{quote.serviceCharge > 0 ? ` · service charge ${inr(Number(quote.serviceCharge) + Number(quote.serviceChargeTax))}` : ''}</span>}
                </div>

                <div className="input-group"><label>Give the money back by</label>
                    <div className="seg refund-methods" role="radiogroup">
                        {methods.map(m => (
                            <button key={m} type="button" role="radio" aria-checked={method === m} className={method === m ? 'active' : ''} onClick={() => setMethod(m)}>{METHOD_LABEL[m]}</button>
                        ))}
                    </div>
                </div>
                <div className="input-group"><label>Reason *</label>
                    <input className="input" value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. cold coffee, wrong item" /></div>
                {!canVoid && (
                    <div className="form-grid">
                        <div className="input-group"><label>Manager mobile</label><input className="input" inputMode="numeric" value={phone} onChange={e => setPhone(e.target.value)} /></div>
                        <div className="input-group"><label>Manager PIN</label><input className="input" type="password" inputMode="numeric" value={pin} onChange={e => setPin(e.target.value)} /></div>
                    </div>
                )}
                {error && <p className="error-message">{error}</p>}
            </div>
            <div className="modal-footer">
                <button className="btn btn-ghost" onClick={onBack || onClose}>Back</button>
                <button className="btn btn-danger" disabled={!picked.length || !quote || !reason.trim() || busy} onClick={submit}>
                    {busy ? 'Saving…' : `Refund ${quote ? inr(quote.amount) : ''}`}
                </button>
            </div>
        </Modal>
    );
};

export default RefundModal;
