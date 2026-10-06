import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FiCheck, FiX, FiFileText, FiAlertTriangle, FiCreditCard, FiPrinter, FiMove, FiUsers, FiSearch } from 'react-icons/fi';
import { getActiveOrders, updateOrderStatus, settleOrder, removeServiceCharge, confirmTableOrder, moveOrderTable, getTables } from '../utils/api';
import { useAuth } from '../context/AuthContext';
import OrderBill from '../components/OrderBill';
import Skeleton from './mobile/Skeleton';
import PhoneOrders from './mobile/PhoneOrders';
import useIsPhone from './mobile/useIsPhone';
import Modal from './inventory/Modal';
import CancelModal from './CancelModal';
import { printKot, printBill } from '../lib/print';
import { inr } from './pos/money';
import { tableToken } from './mobile/useMenuLang';
import { LineNote } from './pos/ChoicePicker';
import './AdminOrders.css';
import './pos/POS.css';

const errText = (err) => err?.response?.data?.message || err?.message || 'Something went wrong';
const CHANNEL = { qr: 'QR', dine_in: 'Dine-in', takeaway: 'Takeaway', kiosk: 'Kiosk', aggregator: 'Aggregator' };

// Hand-over cards: a big token people can read from a metre away, the state as a coloured band,
// ready orders first. Token: Q1 / C12 if the order has one, else T5 for a table, else the last 4 of the order number.
const tokenOf = (o) => o.tokenNumber || (o.tableNumber ? tableToken(o.tableNumber) : String(o.orderNumber || '').slice(-4));
// ready → hand over; new → needs accepting; cook → in the kitchen; done → served / at the bill stage
// (a held order has not reached the kitchen yet, so it counts as new whatever its status says)
const stateOf = (o) => (o.held || o.status === 'pending' ? 'new'
    : o.status === 'ready' ? 'ready'
        : o.status === 'confirmed' || o.status === 'preparing' ? 'cook' : 'done');
const RANK = { ready: 0, new: 1, cook: 2, done: 3 };
const PILL = {
    pending: 'NEW · CONFIRM', confirmed: 'CONFIRMED', preparing: 'COOKING', ready: 'READY · HAND OVER',
    served: 'SERVED', bill_requested: 'WANTS BILL', bill_generated: 'BILL GIVEN',
};
const pillOf = (o) => (o.held ? (o.holdReason === 'accept' ? 'NEW · ACCEPT' : 'CONFIRM TABLE') : PILL[o.status] || o.status.replace('_', ' ').toUpperCase());
const dueOf = (o) => Math.max(0, Math.round((o.total - (o.amountPaid || 0)) * 100) / 100);
const minsOf = (o) => Math.max(0, Math.floor((Date.now() - new Date(o.createdAt).getTime()) / 60000));
const ageText = (m) => (m < 60 ? `${m} min` : m < 1440 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${Math.floor(m / 1440)} d`);
const digits = (v) => String(v || '').replace(/\D/g, '');
// Find box: token, customer name, any part of the order number, or phone digits
const matches = (o, q) => {
    const s = q.trim().toLowerCase();
    if (!s) return true;
    if ([tokenOf(o), o.user?.name, o.orderNumber].some(v => v && String(v).toLowerCase().includes(s))) return true;
    const d = digits(s);
    return /^[\d\s+-]+$/.test(s) && d.length >= 3 && digits(o.user?.phone).includes(d);
};
const FILTERS = [
    ['all', 'All', () => true],
    ['ready', 'Ready to hand over', (o) => !o.held && o.status === 'ready'],
    ['cook', 'Cooking', (o) => !o.held && (o.status === 'confirmed' || o.status === 'preparing')],
    ['new', 'New', (o) => o.held || o.status === 'pending'],
    ['unpaid', 'Unpaid', (o) => (o.amountPaid || 0) < o.total],
];
// ORD-261006-F0E034 → ORD-261006-<b>F0E034</b>
const OrderNo = ({ n }) => {
    const s = String(n || '');
    const i = s.lastIndexOf('-');
    return <>{s.slice(0, i + 1)}<b>{s.slice(i + 1)}</b></>;
};

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
    // Taking money, cancelling, moving and accepting are front-of-house work (orders.create); the kitchen only moves dishes along
    const canMoney = hasPerm('orders.create');
    const [settling, setSettling] = useState(null);
    const [cancelling, setCancelling] = useState(null);
    const [moving, setMoving] = useState(null);
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedOrdersForBill, setSelectedOrdersForBill] = useState([]);
    const [showBill, setShowBill] = useState(false);
    const isPhone = useIsPhone();
    const [params, setParams] = useSearchParams();
    const [find, setFind] = useState('');
    const [filter, setFilter] = useState('all');
    const [, tick] = useState(0);
    // Keeps the "N min" on each card fresh
    useEffect(() => { const t = setInterval(() => tick(n => n + 1), 30000); return () => clearInterval(t); }, []);
    useEffect(() => {
        fetchOrders();
    }, []);
    // ?pay=<order id> (from the full-screen alert's Take payment) opens that order's payment once
    const payFor = params.get('pay');
    useEffect(() => {
        if (!payFor || loading) return;
        const o = orders.find(x => String(x._id) === payFor);
        setParams({}, { replace: true });
        if (o && hasPerm('orders.create')) setSettling(o);
    }, [payFor, loading, orders, setParams, hasPerm]);

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
                <PhoneOrders orders={orders} canEdit={canEdit} canMoney={canMoney} hasNext={(o) => !!getNextStatus(o.status)} groupsAtTable={groupsAtTable}
                    onNext={(o) => (o.held ? confirmHeld(o) : handleStatusChange(o._id, getNextStatus(o.status)))}
                    onPay={setSettling} onCancel={setCancelling} onMove={setMoving}
                    onBill={(o, whole) => handleShowBill(o, whole)} onKot={printKot} onPrint={printBill} />
                {modals}
            </div>
        );
    }

    const counts = Object.fromEntries(FILTERS.map(([k, , fn]) => [k, orders.filter(fn).length]));
    const passFilter = FILTERS.find(([k]) => k === filter)[2];
    const shown = orders
        .filter(o => passFilter(o) && matches(o, find))
        .sort((a, b) => RANK[stateOf(a)] - RANK[stateOf(b)] || new Date(a.createdAt) - new Date(b.createdAt));

    return (
        <div className="admin-orders">
            <h1>Orders Management</h1>

            <div className="orders-board">
                {orders.length === 0 ? (
                    <div className="no-orders">
                        <p>No active orders</p>
                    </div>
                ) : (
                    <>
                        <div className="ao-tools">
                            <label className="ao-find">
                                <FiSearch aria-hidden="true" />
                                <input type="search" value={find} onChange={e => setFind(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'Escape') setFind(''); }}
                                    placeholder="Find: token, name, order no., phone" aria-label="Find an order" />
                            </label>
                            <div className="ao-chips" role="group" aria-label="Show orders">
                                {FILTERS.map(([k, label]) => (
                                    <button key={k} type="button" aria-pressed={filter === k} className={`ao-chip f-${k}`} onClick={() => setFilter(k)}>
                                        {label}<i>{counts[k]}</i>
                                    </button>
                                ))}
                            </div>
                        </div>

                        {shown.length === 0 ? (
                            <div className="no-orders ao-none">
                                <p>No orders match.</p>
                                {(find || filter !== 'all') && (
                                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setFind(''); setFilter('all'); }}>Show all orders</button>
                                )}
                            </div>
                        ) : (
                            <div className="orders-grid">
                                {shown.map(order => {
                                    const st = stateOf(order);
                                    const due = dueOf(order);
                                    const groups = groupsAtTable(order);
                                    const name = order.user?.name ? order.user.name.trim().split(/\s+/)[0]
                                        : order.tableNumber ? `Table ${order.tableNumber}` : 'Walk-in';
                                    const phone4 = digits(order.user?.phone).slice(-4);
                                    const time = new Date(order.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
                                    return (
                                        <article key={order._id} className={`ao-card st-${st} status-${order.status}`}>
                                            <header className="ao-band">
                                                <span className="ao-tok">{tokenOf(order)}</span>
                                                <span className="ao-who">
                                                    <b title={order.user?.name || undefined}>{name}</b>
                                                    <span className="ao-meta">
                                                        {CHANNEL[order.channel] || 'QR'}
                                                        {order.tableNumber && <> · Table {order.tableNumber}</>}
                                                        {groups > 1 && <> · <FiUsers aria-hidden="true" /> {groups} groups</>}
                                                        {order.staffName && <> · {order.staffName}</>}
                                                        {' · '}<span title={`Placed at ${time}`}>{ageText(minsOf(order))}</span>
                                                    </span>
                                                    <span className="ao-pill">{pillOf(order)}</span>
                                                </span>
                                            </header>

                                            <div className="ao-body">
                                                <div className="ao-id">
                                                    <OrderNo n={order.orderNumber} />
                                                    {phone4 && <span className="ao-ph" title={order.user?.phone}> · …{phone4}</span>}
                                                </div>

                                                <ul className="ao-items">
                                                    {order.items.map((item, i) => (
                                                        <li key={i}><b>{item.quantity}</b><span>{item.name}<LineNote item={item} /></span></li>
                                                    ))}
                                                </ul>

                                                <div className="ao-money">
                                                    <span className="ao-total">{inr(order.total)}</span>
                                                    {due === 0
                                                        ? <span className="ao-paid">PAID</span>
                                                        : <span className="ao-due">DUE {inr(due)}{order.amountPaid > 0 && <small> · paid {inr(order.amountPaid)}</small>}</span>}
                                                </div>
                                            </div>

                                            <div className="ao-foot">
                                                {order.held && (
                                                    <div className="pay-request held">
                                                        {order.holdReason === 'accept' ? 'New order. Tap Accept to send it to the kitchen.'
                                                            : `First order on Table ${order.tableNumber}. Check someone is sitting there, then confirm. The kitchen gets it after that.`}
                                                    </div>
                                                )}
                                                {order.paymentRequest && (
                                                    <div className={`pay-request ${order.paymentRequest}`}>
                                                        {order.paymentRequest === 'qr' ? `Wants to pay ${inr(order.total - (order.amountPaid || 0))} by UPI — take the QR to the table`
                                                            : 'Coming to the counter to pay'}
                                                    </div>
                                                )}
                                                {order.specialInstructions && (
                                                    <div className="order-special-instructions">
                                                        <strong><FiAlertTriangle /> Note:</strong> {order.specialInstructions}
                                                    </div>
                                                )}

                                                <div className="order-actions">
                                                    {order.held && canMoney && (
                                                        <button className="btn btn-primary btn-sm" onClick={() => confirmHeld(order)}>
                                                            <FiCheck /> {order.holdReason === 'accept' ? 'Accept' : 'Confirm table'}
                                                        </button>
                                                    )}
                                                    {!order.held && getNextStatus(order.status) && (['confirmed', 'preparing', 'ready'].includes(order.status) ? hasPerm('orders.edit') : canMoney) && (
                                                        <button
                                                            className="btn btn-primary btn-sm"
                                                            onClick={() => handleStatusChange(order._id, getNextStatus(order.status))}
                                                        >
                                                            <FiCheck /> {getStatusLabel(order.status)}
                                                        </button>
                                                    )}

                                                    {canMoney && (
                                                        <button className="btn btn-success btn-sm" onClick={() => setSettling(order)}>
                                                            <FiCreditCard /> Take payment
                                                        </button>
                                                    )}

                                                    {canMoney && (
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
                                                    {canMoney && order.channel !== 'kiosk' && (
                                                        <button className="btn btn-ghost btn-sm" onClick={() => setMoving(order)} title="Move to another table">
                                                            <FiMove /> Move
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        </article>
                                    );
                                })}
                            </div>
                        )}
                    </>
                )}
            </div>

            {modals}
        </div>
    );
};

export default AdminOrders;
