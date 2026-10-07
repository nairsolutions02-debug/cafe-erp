import React, { useState } from 'react';
import { cancelOrder } from '../utils/api';
import Modal from './inventory/Modal';
import RefundModal from './RefundModal';
import { inr } from './pos/money';
import './RefundModal.css';

const errText = (err) => err?.response?.data?.message || err?.message || 'Something went wrong';

// Cancel / void: reason always; a manager PIN when the person can't void bills.
// A paid bill can instead give back only some items (Refund some items).
const CancelModal = ({ order, canVoid, onClose, onDone, startWith = 'cancel', drawer = null }) => {
    const [reason, setReason] = useState('');
    const [phone, setPhone] = useState('');
    const [pin, setPin] = useState('');
    const [error, setError] = useState('');
    const canPartial = order.status === 'paid' && Number(order.amountPaid) > 0
        && (order.items || []).some(i => Number(i.quantity) > Number(i.refundedQty || 0));
    const [mode, setMode] = useState(startWith === 'refund' && canPartial ? 'refund' : 'cancel');
    const refunded = Number(order.refunded || 0);
    const submit = async () => {
        try {
            onDone((await cancelOrder(order._id, reason, phone || null, pin || null, drawer)).data);
        } catch (err) {
            setError(errText(err));
        }
    };
    if (mode === 'refund') {
        return <RefundModal order={order} canVoid={canVoid} drawer={drawer} onClose={onClose} onDone={onDone}
            onBack={startWith === 'refund' ? onClose : () => setMode('cancel')} />;
    }
    return (
        <Modal title={`Cancel ${order.orderNumber}`} onClose={onClose}>
            <div className="modal-body">
                {canPartial && (
                    <div className="cancel-or-refund">
                        <span>Customer returning only some items?</span>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setMode('refund')}>Refund some items</button>
                    </div>
                )}
                {order.amountPaid > 0 && (
                    <p className="neg">{inr(order.amountPaid - refunded)} {refunded > 0 ? `is left of what was paid (${inr(refunded)} already refunded)` : 'was paid'}; it will be refunded from where it came.</p>
                )}
                {['preparing', 'ready', 'served'].includes(order.status) && <p className="neg small">The kitchen already started: this is flagged in the daily report.</p>}
                <div className="input-group"><label>Reason *</label>
                    <input className="input" value={reason} onChange={e => setReason(e.target.value)} autoFocus /></div>
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
                <button className="btn btn-danger" disabled={!reason.trim()} onClick={submit}>Cancel whole order</button>
            </div>
        </Modal>
    );
};

export default CancelModal;
