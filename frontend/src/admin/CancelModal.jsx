import React, { useState } from 'react';
import { cancelOrder } from '../utils/api';
import Modal from './inventory/Modal';
import { inr } from './pos/money';

const errText = (err) => err?.response?.data?.message || err?.message || 'Something went wrong';

// Cancel / void: reason always; a manager PIN when the person can't void bills
const CancelModal = ({ order, canVoid, onClose, onDone }) => {
    const [reason, setReason] = useState('');
    const [phone, setPhone] = useState('');
    const [pin, setPin] = useState('');
    const [error, setError] = useState('');
    const submit = async () => {
        try {
            onDone((await cancelOrder(order._id, reason, phone || null, pin || null)).data);
        } catch (err) {
            setError(errText(err));
        }
    };
    return (
        <Modal title={`Cancel ${order.orderNumber}`} onClose={onClose}>
            <div className="modal-body">
                {order.amountPaid > 0 && <p className="neg">{inr(order.amountPaid)} was paid; it will be refunded from where it came.</p>}
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
                <button className="btn btn-danger" disabled={!reason.trim()} onClick={submit}>Cancel order</button>
            </div>
        </Modal>
    );
};

export default CancelModal;
