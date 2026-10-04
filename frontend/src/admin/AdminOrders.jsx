import React, { useState, useEffect } from 'react';
import { FiCheck, FiX, FiFileText, FiAlertTriangle, FiCreditCard, FiPrinter, FiMove, FiUsers } from 'react-icons/fi';
import { getActiveOrders, updateOrderStatus, settleOrder, cancelOrder, removeServiceCharge, confirmTableOrder, moveOrderTable, getTables } from '../utils/api';
import { useAuth } from '../context/AuthContext';
import OrderBill from '../components/OrderBill';
import Skeleton from './mobile/Skeleton';
import PhoneOrders from './mobile/PhoneOrders';
import useIsPhone from './mobile/useIsPhone';
import Modal from './inventory/Modal';
import { printKot, printBill } from '../lib/print';
import { inr } from './pos/money';
import './AdminOrders.css';
import './pos/POS.css';

const errText = (err) => err?.response?.data?.message || err?.message || 'Something went wrong';
const CHANNEL = { qr: 'QR', dine_in: 'Dine-in', takeaway: 'Takeaway', kiosk: 'Kiosk', aggregator: 'Aggregator' };

// Take payment: one method or split; cash shows change. Cash goes to the counter drawer.
const SettleModal = ({ order, onClose, onDone }) => {
    const due = Math.round((order.total - (order.amountPaid || 0)) * 100) / 100;
    const [amounts, setAmounts] = useState({ cash: '', upi: '', card: '' });
    const [method, setMethod] = useState('cash');
    const [tendered, setTendered] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const split = method === 'split';
    const sum = Number(amounts.cash || 0) + Number(amounts.upi || 0) + Number(amounts.card || 0);
    const change = method === 'cash' ? Math.max(0, Number(tendered || 0) - due) : 0;
    const submit = async () => {
        setBusy(true);
        try {
            const payments = split
                ? Object.entries(amounts).filter(([, v]) => Number(v) > 0).map(([m, v]) => ({ method: m, amount: Number(v) }))
                : [{ method, amount: method === 'cash' && Number(tendered) > due ? Number(tendered) : due }];
            const res = await settleOrder(order._id, payments);
            onDone(res.data);
        } catch (err) {
            setError(errText(err));
        } finally {
            setBusy(false);
        }
    };
    const dropSc = async () => {
        try { onDone((await removeServiceCharge(order._id, !order.serviceChargeRemoved)).data, true); } catch (err) { setError(errText(err)); }
    };
    return (
        <Modal title={`Payment · ${order.orderNumber}`} onClose={onClose}>
            <div className="modal-body">
                <div className="kv">
                    <span>Bill total</span><span>{inr(order.total)}</span>
                    {order.amountPaid > 0 && <><span>Already paid</span><span>{inr(order.amountPaid)}</span></>}
                    <span className="strong">Due</span><span className="strong">{inr(due)}</span>
                </div>
                {(order.serviceCharge > 0 || order.serviceChargeRemoved) && (
                    <p className="small">Service charge {inr(order.serviceCharge)} (optional) ·{' '}
                        <button className="link-btn" onClick={dropSc}>{order.serviceChargeRemoved ? 'Add it back' : 'Customer asked to remove it'}</button></p>
                )}
                <div className="pay-methods">
                    {['cash', 'upi', 'card', 'split'].map(m => <button key={m} className={method === m ? 'active' : ''} onClick={() => setMethod(m)}>{m === 'upi' ? 'UPI' : m[0].toUpperCase() + m.slice(1)}</button>)}
                </div>
                {method === 'cash' && (
                    <div className="input-group" style={{ marginTop: 10 }}><label>Cash received</label>
                        <input className="input" type="number" value={tendered} placeholder={String(due)} onChange={e => setTendered(e.target.value)} autoFocus />
                        {change > 0 && <p className="change">Change {inr(change)}</p>}</div>
                )}
                {split && ['cash', 'upi', 'card'].map(m => (
                    <div key={m} className="input-group"><label>{m === 'upi' ? 'UPI' : m[0].toUpperCase() + m.slice(1)}</label>
                        <input className="input" type="number" value={amounts[m]} onChange={e => setAmounts({ ...amounts, [m]: e.target.value })} /></div>
                ))}
                {split && <p className={Math.abs(sum - due) < 0.01 ? 'change' : 'change neg'}>Entered {inr(sum)} of {inr(due)}</p>}
                {error && <p className="error-message">{error}</p>}
            </div>
            <div className="modal-footer">
                <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
                <button className="btn btn-primary" disabled={busy || (split && sum <= 0) || (method === 'cash' && tendered !== '' && Number(tendered) < due)} onClick={submit}>Paid</button>
            </div>
        </Modal>
    );
};

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

// Move an order (and the rest of that customer's group) to another table
const MoveModal = ({ order, onClose, onDone }) => {
    const [tables, setTables] = useState([]);
    const [to, setTo] = useState('');
    const [whole, setWhole] = useState(true);
    const [error, setError] = useState('');
    useEffect(() => { getTables().then(r => setTables(r.data.filter(t => t._id !== order.table))).catch(() => {}); }, [order.table]);
    const submit = async () => {
        try { onDone((await moveOrderTable(order._id, to, whole)).data); } catch (err) { setError(errText(err)); }
    };
    return (
        <Modal title={`Move ${order.orderNumber}`} onClose={onClose}>
            <div className="modal-body">
                <div className="input-group"><label>To table</label>
                    <select className="input" value={to} onChange={e => setTo(e.target.value)} autoFocus>
                        <option value="">Choose…</option>
                        {tables.map(t => <option key={t._id} value={t._id}>Table {t.tableNumber}</option>)}
                    </select></div>
                {order.user && order.table && (
                    <label className="check"><input type="checkbox" checked={whole} onChange={e => setWhole(e.target.checked)} /> Move all of {order.user.name}'s open orders at this table</label>
                )}
                {error && <p className="error-message">{error}</p>}
            </div>
            <div className="modal-footer">
                <button className="btn btn-ghost" onClick={onClose}>Back</button>
                <button className="btn btn-primary" disabled={!to} onClick={submit}>Move</button>
            </div>
        </Modal>
    );
};

const AdminOrders = () => {
    const { socket, hasPerm } = useAuth();
    const [settling, setSettling] = useState(null);
    const [cancelling, setCancelling] = useState(null);
    const [moving, setMoving] = useState(null);
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedOrdersForBill, setSelectedOrdersForBill] = useState([]);
    const [showBill, setShowBill] = useState(false);
    const isPhone = useIsPhone();
    useEffect(() => {
        fetchOrders();
    }, []);

    useEffect(() => {
        if (socket) {
            socket.on('new-order', (order) => {
                console.log('New order received:', order.orderNumber);
                setOrders(prev => [order, ...prev]);
            });
            socket.on('order-updated', (order) => {
                console.log('Order updated:', order.orderNumber, 'Status:', order.status);
                setOrders(prev => prev.map(o =>
                    o._id.toString() === order._id.toString() ? order : o
                ));
            });
            // Also listen for bill-requested to update UI in real-time
            socket.on('bill-requested', (order) => {
                console.log('Bill requested for:', order.orderNumber, 'Status:', order.status);
                setOrders(prev => prev.map(o =>
                    o._id.toString() === order._id.toString() ? order : o
                ));
            });
            return () => {
                socket.off('new-order');
                socket.off('order-updated');
                socket.off('bill-requested');
            };
        }
    }, [socket]);

    const fetchOrders = async () => {
        try {
            const res = await getActiveOrders();
            setOrders(res.data);
        } catch (error) {
            console.error('Error:', error);
        } finally {
            setLoading(false);
        }
    };

    // A table bill is per group (one customer's orders); wholeTable merges every group at the table
    const getSessionOrders = (targetOrder, allList, wholeTable = false) => {
        const getOrderId = (obj) => obj?._id?.toString() || obj?.toString() || '';
        const orderTime = new Date(targetOrder.createdAt).getTime();
        const ONE_HOUR = 60 * 60 * 1000;

        let sessionOrders = [];
        if (targetOrder.table) {
            const currentTableId = getOrderId(targetOrder.table);
            sessionOrders = allList.filter(o =>
                getOrderId(o.table) === currentTableId &&
                (wholeTable || !targetOrder.user || getOrderId(o.user) === getOrderId(targetOrder.user)) &&
                o.status !== 'cancelled' &&
                o.status !== 'paid' &&
                Math.abs(new Date(o.createdAt).getTime() - orderTime) < ONE_HOUR
            );
        } else {
            const currentUserId = getOrderId(targetOrder.user);
            sessionOrders = allList.filter(o =>
                getOrderId(o.user) === currentUserId &&
                targetOrder.user &&
                o.status !== 'cancelled' &&
                o.status !== 'paid' &&
                Math.abs(new Date(o.createdAt).getTime() - orderTime) < ONE_HOUR
            );
        }
        // Ensure at least current is included
        if (!sessionOrders.find(o => o._id === targetOrder._id)) {
            sessionOrders.push(targetOrder);
        }
        return sessionOrders;
    };

    const handleStatusChange = async (orderId, status) => {
        try {
            // Auto-grouping for Bill Generation
            if (status === 'bill_generated') {
                const targetOrder = orders.find(o => o._id === orderId);
                if (targetOrder) {
                    const sessionOrders = getSessionOrders(targetOrder, orders);

                    // Update ALL session orders to 'bill_generated'
                    await Promise.all(sessionOrders.map(o => {
                        if (o.status !== 'bill_generated') {
                            return updateOrderStatus(o._id, 'bill_generated');
                        }
                        return Promise.resolve();
                    }));

                    // Show Combined Bill
                    setSelectedOrdersForBill(sessionOrders);
                    setShowBill(true);

                    // Refresh Orders to reflect specific status changes
                    fetchOrders();
                    return;
                }
            }

            await updateOrderStatus(orderId, status);
        } catch (error) {
            alert('Failed to update status');
        }
    };

    const afterChange = (order, keepOpen) => {
        setOrders(prev => (order.status === 'paid' || order.status === 'cancelled'
            ? prev.filter(o => o._id !== order._id)
            : prev.map(o => (o._id === order._id ? order : o))));
        if (keepOpen) setSettling(order);
        else {
            setSettling(null);
            setCancelling(null);
        }
    };

    const handleShowBill = (order, wholeTable = false) => {
        const sessionOrders = getSessionOrders(order, orders, wholeTable);
        setSelectedOrdersForBill(sessionOrders);
        setShowBill(true);
    };

    const getNextStatus = (status) => {
        const flow = {
            pending: 'confirmed',
            confirmed: 'preparing',
            preparing: 'ready',
            ready: 'served',
            bill_requested: 'bill_generated'
        };
        return flow[status];
    };

    const getStatusLabel = (status) => ({
        pending: 'Confirm Order',
        confirmed: 'Start Preparing',
        preparing: 'Mark Ready',
        ready: 'Mark Served',
        bill_requested: 'Generate Bill'
    }[status]);

    const groupsAtTable = (order) => (order.table
        ? new Set(orders.filter(o => o.table === order.table && !['paid', 'cancelled'].includes(o.status)).map(o => o.user?._id || o._id)).size
        : 1);
    const confirmHeld = async (order) => {
        try { afterChange((await confirmTableOrder(order._id)).data); } catch (err) { alert(errText(err)); }
    };

    if (loading) return <Skeleton label="Cooking up some orders..." />;

    const modals = (
        <>
            {settling && <SettleModal order={settling} onClose={() => setSettling(null)} onDone={afterChange} />}
            {moving && <MoveModal order={moving} onClose={() => setMoving(null)} onDone={(o) => { setMoving(null); afterChange(o); fetchOrders(); }} />}
            {cancelling && <CancelModal order={cancelling} canVoid={hasPerm('sensitive.void_bill')} onClose={() => setCancelling(null)} onDone={afterChange} />}

            {showBill && selectedOrdersForBill.length > 0 && (
                <OrderBill
                    orders={selectedOrdersForBill}
                    onCancel={() => {
                        setShowBill(false);
                        setSelectedOrdersForBill([]);
                        fetchOrders(); // Refresh to remove paid ones
                    }}
                />
            )}
        </>
    );

    if (isPhone) {
        const canEdit = hasPerm('orders.edit');
        return (
            <div className="admin-orders">
                <PhoneOrders orders={orders} canEdit={canEdit} hasNext={(o) => !!getNextStatus(o.status)} groupsAtTable={groupsAtTable}
                    onNext={(o) => (o.held ? confirmHeld(o) : handleStatusChange(o._id, getNextStatus(o.status)))}
                    onPay={setSettling} onCancel={setCancelling} onMove={setMoving}
                    onBill={(o, whole) => handleShowBill(o, whole)} onKot={printKot} onPrint={printBill} />
                {modals}
            </div>
        );
    }

    return (
        <div className="admin-orders">
            <h1>Orders Management</h1>

            <div className="orders-board">
                {orders.length === 0 ? (
                    <div className="no-orders">
                        <p>No active orders</p>
                    </div>
                ) : (
                    <div className="orders-grid">
                        {orders.map(order => (
                            <div key={order._id} className={`order-card status-${order.status}`}>
                                <div className="order-header">
                                    <span className="order-num">#{order.orderNumber}</span>
                                    <span className={`status-badge ${order.status}`}>
                                        {order.status.replace('_', ' ')}
                                    </span>
                                </div>

                                {order.held && (
                                    <div className="pay-request held">
                                        First order on Table {order.tableNumber}. Check someone is sitting there, then confirm. The kitchen gets it after that.
                                    </div>
                                )}
                                {order.paymentRequest && (
                                    <div className={`pay-request ${order.paymentRequest}`}>
                                        {order.paymentRequest === 'qr' ? `Wants to pay ${inr(order.total - (order.amountPaid || 0))} by UPI — take the QR to the table`
                                            : 'Coming to the counter to pay'}
                                    </div>
                                )}
                                <div className="order-customer">
                                    <strong>{order.user?.name || 'Customer'}</strong>
                                    <span>{order.user?.phone}</span>
                                    {order.tableNumber && <span>Table: {order.tableNumber}{groupsAtTable(order) > 1 && <> · <FiUsers /> {groupsAtTable(order)} groups</>}</span>}
                                    {!order.tableNumber && order.tokenNumber && <span>Token: {order.tokenNumber}</span>}
                                    <span className="channel-tag">{CHANNEL[order.channel] || 'QR'}{order.staffName ? ` · ${order.staffName}` : ''}</span>
                                </div>

                                <div className="order-items">
                                    {order.items.map((item, i) => (
                                        <div key={i} className="order-item">
                                            <span>{item.name}</span>
                                            <span>x{item.quantity}</span>
                                        </div>
                                    ))}
                                </div>

                                {order.specialInstructions && (
                                    <div className="order-special-instructions">
                                        <strong><FiAlertTriangle /> Note:</strong> {order.specialInstructions}
                                    </div>
                                )}

                                <div className="order-total">
                                    <div className="total-row">
                                        <span>Total</span>
                                        <span>₹{order.total.toFixed(2)}</span>
                                    </div>
                                    <div className="payment-row">
                                        <div className="payment-status">
                                            <div
                                                className="payment-fill"
                                                style={{ width: `${Math.min((order.amountPaid || 0) / order.total * 100, 100)}%` }}
                                            ></div>
                                        </div>
                                        <div className="payment-labels">
                                            <span className="paid">Paid: ₹{order.amountPaid || 0}</span>
                                            <span className="pending">Bal: ₹{Math.max(order.total - (order.amountPaid || 0), 0).toFixed(2)}</span>
                                        </div>
                                    </div>
                                </div>

                                <div className="order-actions">
                                    {order.held && hasPerm('orders.edit') && (
                                        <button className="btn btn-primary btn-sm" onClick={() => confirmHeld(order)}>
                                            <FiCheck /> Confirm table
                                        </button>
                                    )}
                                    {!order.held && getNextStatus(order.status) && (
                                        <button
                                            className="btn btn-primary btn-sm"
                                            onClick={() => handleStatusChange(order._id, getNextStatus(order.status))}
                                        >
                                            <FiCheck /> {getStatusLabel(order.status)}
                                        </button>
                                    )}

                                    {hasPerm('orders.edit') && (
                                        <button className="btn btn-success btn-sm" onClick={() => setSettling(order)}>
                                            <FiCreditCard /> Take payment
                                        </button>
                                    )}

                                    {hasPerm('orders.edit') && (
                                        <button className="btn btn-danger btn-sm" onClick={() => setCancelling(order)}>
                                            <FiX /> Cancel
                                        </button>
                                    )}

                                    <button className="btn btn-ghost btn-sm" onClick={() => printKot(order)} title="Print kitchen ticket">
                                        <FiPrinter /> KOT
                                    </button>
                                    <button className="btn btn-ghost btn-sm" onClick={() => printBill(order)} title="Print bill on the thermal printer">
                                        <FiPrinter /> Print
                                    </button>

                                    <button
                                        className="btn btn-secondary btn-sm"
                                        onClick={() => handleShowBill(order)}
                                    >
                                        <FiFileText /> Bill
                                    </button>
                                    {groupsAtTable(order) > 1 && (
                                        <button className="btn btn-ghost btn-sm" onClick={() => handleShowBill(order, true)} title="One bill for every group at this table">
                                            <FiFileText /> Whole table
                                        </button>
                                    )}
                                    {hasPerm('orders.edit') && order.channel !== 'kiosk' && (
                                        <button className="btn btn-ghost btn-sm" onClick={() => setMoving(order)} title="Move to another table">
                                            <FiMove /> Move
                                        </button>
                                    )}
                                </div>

                                <div className="order-time">
                                    {new Date(order.createdAt).toLocaleTimeString()}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {modals}
        </div>
    );
};

export default AdminOrders;
