import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { getOrder, confirmTableOrder, updateOrderStatus } from '../../utils/api';
import useMenuLang from '../mobile/useMenuLang';
import './OrderAlert.css';

const T = (en, hi, hinglish) => ({ en, hi, hinglish });
const W = {
    newOrder: T('New table order', 'नया टेबल ऑर्डर', 'Naya table order'),
    firstOrder: T('First order on this table', 'इस टेबल का पहला ऑर्डर', 'Is table ka pehla order'),
    bill: T('Bill requested', 'बिल माँगा गया', 'Bill maanga gaya'),
    payUpi: T('Wants to pay by UPI', 'UPI से देना चाहते हैं', 'UPI se dena chahte hain'),
    payCounter: T('Coming to the counter to pay', 'काउंटर पर देने आ रहे हैं', 'Counter pe dene aa rahe hain'),
    alert: T('Alert', 'अलर्ट', 'Alert'),
    table: T('Table', 'टेबल', 'Table'), dishes: T('Dishes', 'डिश', 'Dishes'), total: T('Total', 'कुल', 'Total'), due: T('To pay', 'देना है', 'Dena hai'),
    justNow: T('just now', 'अभी', 'abhi'), min: T('min waiting', 'मिनट से इंतज़ार', 'min se wait'),
    accept: T('Accept · send to kitchen', 'स्वीकार · किचन भेजें', 'Accept · kitchen bhejo'),
    acceptOnly: T('Accept', 'स्वीकार', 'Accept'),
    inKitchen: T('The kitchen already has it', 'किचन को मिल चुका है', 'Kitchen ko mil chuka hai'),
    checkSeat: T('Check someone is sitting at the table, then accept', 'देखें कि टेबल पर कोई बैठा है, फिर स्वीकार करें', 'Dekho table pe koi baitha hai, phir accept karo'),
    pay: T('Take payment', 'पेमेंट लें', 'Payment lo'), ack: T('Acknowledge', 'देख लिया', 'Acknowledge'),
    open: T('Open order', 'ऑर्डर खोलें', 'Order kholo'), snooze: T('Snooze', 'बाद में', 'Snooze'),
    waiting: T('waiting', 'बाकी', 'baaki'),
    esc: T('Not answered — the owner has been alerted', 'जवाब नहीं — मालिक को अलर्ट गया', 'Jawab nahi — owner ko alert gaya'),
    loading: T('Loading the order…', 'ऑर्डर खुल रहा है…', 'Order khul raha hai…'),
};
const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const minutesSince = (iso) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
// Escalations point at the alert nobody answered; their order is on that one
const orderIdOf = (n, items) => n.payload?.orderId || items.find(x => x.id === n.payload?.from)?.payload?.orderId || null;
// Chip text: the table (or order) the alert is about, never cut mid-word
const chipLabel = (q) => (q.title.match(/Table \S+|Order \S+/) || [q.title.split(' · ')[0].replace(/^Not answered for \d+ min: /, '')])[0];
const kindOf = (n, items) => (n.kind === 'escalation' ? items.find(x => x.id === n.payload?.from)?.kind || 'other' : n.kind);

// Full-screen alert for alarm-level alerts: shows the order itself and lets staff act on it.
// Several alerts stack (a chip each); one left unanswered for the escalation minutes flashes faster and rings louder.
const OrderAlert = ({ queue, items, escMinutes, onDone, onSnooze, onOpen, onEscalated }) => {
    const { t } = useMenuLang();
    const [pick, setPick] = useState(0);
    const [orders, setOrders] = useState({});
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [, tick] = useState(0);
    const i = Math.min(pick, queue.length - 1);
    const n = queue[i];
    const kind = kindOf(n, items);
    const orderId = orderIdOf(n, items);
    const order = orderId ? orders[orderId] : null;

    useEffect(() => { const id = setInterval(() => tick(x => x + 1), 20000); return () => clearInterval(id); }, []);
    useEffect(() => {
        if (!orderId || orders[orderId]) return;
        let live = true;
        getOrder(orderId).then(r => { if (live) setOrders(o => ({ ...o, [orderId]: r.data })); }).catch(() => {});
        return () => { live = false; };
    }, [orderId, orders]);

    const oldest = Math.max(...queue.map(q => minutesSince(q.createdAt)));
    const escalated = escMinutes > 0 && oldest >= escMinutes;
    useEffect(() => { onEscalated(escalated); }, [escalated, onEscalated]);

    const run = async (fn) => {
        setBusy(true); setError('');
        try { await fn(); } catch (err) { setError(err.response?.data?.message || err.message || 'Could not do that'); } finally { setBusy(false); }
    };
    // Accept: a held first order is released to the kitchen; any other new order is marked confirmed
    const accept = () => run(async () => {
        if (order?.held) await confirmTableOrder(order._id || order.id);
        else if (order?.status === 'pending') await updateOrderStatus(order._id || order.id, 'confirmed');
        await onDone(n);
    });
    const takePayment = () => run(async () => { await onDone(n); onOpen(n, orderId ? `/admin/orders?pay=${orderId}` : n.link); });
    const openIt = () => run(async () => { await onDone(n); onOpen(n, n.link); });

    const isBill = kind === 'payment_request';
    const isOrder = kind === 'new_order';
    const held = !!order?.held;
    const head = isBill ? t(W.bill) : isOrder ? (held ? t(W.firstOrder) : t(W.newOrder)) : t(W.alert);
    const wait = minutesSince(n.createdAt);
    const due = order ? order.total - (order.amountPaid || 0) : 0;
    const where = order?.tableNumber ? `${t(W.table)} ${order.tableNumber}` : order?.tokenNumber ? `#${order.tokenNumber}` : '';
    const who = order?.user?.name || '';

    return createPortal(
        <div className={`oa${isBill ? ' bill' : ''}${escalated ? ' esc' : ''}`} role="alertdialog" aria-modal="true" aria-label={`${head} ${where}`}>
            <div className="oa-head">
                <span className="oa-ic" aria-hidden="true">{isBill ? '🧾' : '🔔'}</span>
                <div className="oa-ttl"><small>{head}</small><b>{order ? [where, who].filter(Boolean).join(' · ') || n.title : n.title}</b></div>
                <span className="oa-age">⏱ {wait < 1 ? t(W.justNow) : `${wait} ${t(W.min)}`}</span>
            </div>
            {queue.length > 1 && (
                <div className="oa-queue" role="group" aria-label={`${queue.length} ${t(W.waiting)}`}>
                    {queue.map((q, k) => (
                        <button key={q.id} type="button" aria-current={k === i} onClick={() => setPick(k)}>
                            {kindOf(q, items) === 'payment_request' ? '🧾' : '🔔'} {chipLabel(q)}
                        </button>
                    ))}
                    <b>{queue.length} {t(W.waiting)}</b>
                </div>
            )}
            {escalated && <p className="oa-esc">⚠ {t(W.esc)}</p>}
            <div className="oa-body">
                {orderId ? (
                    <>
                        <div className="oa-card">
                            <h3>{t(W.dishes)}</h3>
                            {!order ? <p>{t(W.loading)}</p> : (
                                <ul className="oa-items">
                                    {(order.items || []).map((it, k) => (
                                        <li key={k}><span className="q">{it.quantity}×</span><span>{it.name || it.menuItem?.name}{it.note && <small>{it.note}</small>}</span></li>
                                    ))}
                                </ul>
                            )}
                            {order?.specialInstructions && <p className="oa-note">📝 {order.specialInstructions}</p>}
                        </div>
                        <div className="oa-card oa-meta">
                            <span>{isBill ? t(W.due) : t(W.total)}</span>
                            <b>{order ? inr(isBill ? due : order.total) : '…'}</b>
                            {isBill && order?.paymentRequest && <span className="oa-strong">{order.paymentRequest === 'qr' ? t(W.payUpi) : t(W.payCounter)}</span>}
                            {isOrder && held && <span className="oa-tag">🪑 {t(W.checkSeat)}</span>}
                            {isOrder && order && !held && <span className="oa-quiet">{t(W.inKitchen)}</span>}
                        </div>
                    </>
                ) : (
                    <div className="oa-card"><p className="oa-big">{n.title}</p>{n.body && <p>{n.body}</p>}</div>
                )}
            </div>
            {error && <p className="oa-error" role="alert">{error}</p>}
            <div className="oa-actions">
                {isOrder && <button type="button" className="go" disabled={busy || !order} onClick={accept}>{held ? t(W.accept) : t(W.acceptOnly)}</button>}
                {isBill && <button type="button" className="go" disabled={busy} onClick={takePayment}>{t(W.pay)}</button>}
                {!isOrder && !isBill && <button type="button" className="go" disabled={busy} onClick={openIt}>{t(W.ack)}</button>}
                {(isOrder || isBill) && <button type="button" className="alt" disabled={busy} onClick={openIt}>{t(W.open)}</button>}
                {[5, 10].map(m => <button key={m} type="button" className="snz" disabled={busy} onClick={() => onSnooze(n, m)}>{t(W.snooze)} {m} min</button>)}
            </div>
        </div>,
        document.body,
    );
};

export default OrderAlert;
