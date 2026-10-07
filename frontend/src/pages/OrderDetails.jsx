import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { FiFileText, FiCheckCircle, FiClock } from 'react-icons/fi';
import Header from '../components/Header';
import OrderStatus from '../components/OrderStatus';
import DishFeedback from '../components/DishFeedback';
import { useAuth } from '../context/AuthContext';
import { getOrder, requestBill, requestPayment, getCheckoutInfo, getCustomerScreen } from '../utils/api';
import { usePortal } from '../context/PortalContext';
import { clearQrTable, getQrTable } from '../lib/qrTable';
import Confetti from '../components/cx/Confetti';
import { useCart } from '../context/CartContext';
import { checkLines, lineFromOrderItem } from '../components/cx/reorder';
import { inr } from '../admin/pos/money';

// What staff typed as the reason, without the internal "(approved by …)" note
const customerReason = (r) => String(r || '').replace(/\s*\(approved by [^)]*\)\s*$/i, '').trim();
import './OrderDetails.css';
import useCxLang, { T } from '../lib/cxLang';

const W = {
    celebrateNth: T("Order placed! That's order #{n} with us. Thank you!", 'ऑर्डर हो गया! यह हमारे साथ आपका #{n} ऑर्डर है। धन्यवाद!', 'Order ho gaya! Ye hamare saath aapka #{n} order hai. Thank you!'),
    celebrate: T('Order placed! The kitchen has it.', 'ऑर्डर हो गया! किचन को मिल गया है।', 'Order ho gaya! Kitchen ko mil gaya hai.'),
    noStaff: T('Could not reach the staff, please ask at the counter', 'स्टाफ़ तक नहीं पहुँच पाए, कृपया काउंटर पर पूछें', 'Staff tak nahi pahunch paaye, please counter pe poocho'),
    details: T('Order Details', 'ऑर्डर की जानकारी', 'Order details'),
    notFound: T('Order not found', 'ऑर्डर नहीं मिला', 'Order nahi mila'),
    yourOrder: T('Your order', 'आपका ऑर्डर', 'Aapka order'),
    heldAccept: T('Got it! The cafe will accept your order in a moment, then the kitchen starts.', 'ऑर्डर मिल गया! कैफ़े अभी स्वीकार करेगा, फिर किचन में बनना शुरू होगा।', 'Order mil gaya! Cafe abhi accept karega, phir kitchen mein banna shuru hoga.'),
    heldTable: T('Got it! A staff member will confirm your table in a moment, then the kitchen starts.', 'ऑर्डर मिल गया! स्टाफ़ अभी आपकी टेबल पक्की करेगा, फिर किचन में बनना शुरू होगा।', 'Order mil gaya! Staff abhi aapki table confirm karega, phir kitchen mein banna shuru hoga.'),
    cancelled: T('This order was cancelled', 'यह ऑर्डर रद्द हो गया', 'Ye order cancel ho gaya'),
    reason: T('Reason: {reason}', 'कारण: {reason}', 'Reason: {reason}'),
    refund: T('You paid {amount}. The staff will return it to you.', 'आपने {amount} दिए थे। स्टाफ़ आपको लौटा देगा।', 'Aapne {amount} diye the. Staff aapko wapas kar dega.'),
    pointsBack: T('Your {n} points are back in your account.', 'आपके {n} पॉइंट वापस आपके खाते में आ गए।', 'Aapke {n} points wapas aapke account mein aa gaye.'),
    askStaff: T('Questions? Please ask the staff.', 'कोई सवाल? स्टाफ़ से पूछें।', 'Koi sawaal? Staff se poocho.'),
    orderAgain: T('Order again', 'फिर से ऑर्डर करें', 'Phir se order karo'),
    readyCollect: T('Ready! Collect at the counter', 'तैयार! काउंटर से ले लीजिए', 'Ready! Counter se le lo'),
    yourNumber: T('Your number', 'आपका नंबर', 'Aapka number'),
    showNumber: T('Show this number at the serving counter', 'यह नंबर सर्विंग काउंटर पर दिखाएँ', 'Ye number serving counter pe dikhao'),
    watchScreen: T('Watch for it on the screen at the counter', 'काउंटर की स्क्रीन पर इसे देखते रहें', 'Counter ki screen pe isko dekhte raho'),
    items: T('Order Items', 'ऑर्डर में क्या है', 'Order mein kya hai'),
    yourBill: T('Your Bill', 'आपका बिल', 'Aapka bill'),
    subtotal: T('Subtotal', 'सबटोटल', 'Subtotal'),
    discount: T('Discount ({code})', 'छूट ({code})', 'Discount ({code})'),
    service: T('Service charge (optional, ask staff to remove) + GST', 'सर्विस चार्ज (वैकल्पिक, हटवाने के लिए स्टाफ़ से कहें) + GST', 'Service charge (optional, hatwane ke liye staff ko bolo) + GST'),
    roundOff: T('Round off', 'राउंड ऑफ़', 'Round off'),
    total: T('Total', 'कुल', 'Total'),
    paid: T('Payment Received - Thank You!', 'पेमेंट हो गया - धन्यवाद!', 'Paid - Thank you!'),
    qrComing: T('Staff are bringing the UPI QR to your table.', 'स्टाफ़ UPI QR आपकी टेबल पर ला रहा है।', 'Staff UPI QR aapki table pe la raha hai.'),
    goCounter: T('Please proceed to the counter to complete payment', 'पेमेंट के लिए कृपया काउंटर पर जाएँ', 'Payment ke liye please counter pe jao'),
    payHow: T('How would you like to pay?', 'पेमेंट कैसे करेंगे?', 'Payment kaise karoge?'),
    bringBill: T('Bring the bill to my table', 'बिल टेबल पर लाइए', 'Bill table pe laao'),
    payUpi: T('Pay by UPI at my table', 'टेबल पर UPI से दूँगा', 'Table pe UPI se dunga'),
    payCounter: T("I'll pay at the counter", 'काउंटर पर दूँगा', 'Counter pe dunga'),
    billComing: T('The bill is on its way to your table…', 'बिल आपकी टेबल पर आ रहा है…', 'Bill aapki table pe aa raha hai…'),
    otherWay: T('Rather pay another way?', 'किसी और तरीके से पेमेंट करना है?', 'Kisi aur tarike se payment karna hai?'),
    info: T('Order Info', 'ऑर्डर की जानकारी', 'Order ki jaankari'),
    amount: T('Total (incl. taxes)', 'कुल (टैक्स सहित)', 'Total (tax ke saath)'),
    number: T('Order Number', 'ऑर्डर नंबर', 'Order number'),
    table: T('Table Number', 'टेबल नंबर', 'Table number'),
    time: T('Order Time', 'ऑर्डर का समय', 'Order ka time'),
    method: T('Payment Method', 'पेमेंट का तरीका', 'Payment ka tarika'),
    refunded: T('Refunded {amount}', '{amount} वापस किए गए', '{amount} wapas kiye gaye'),
    refundHow: T('{amount} back by {how} on {date}', '{date} को {how} से {amount} वापस', '{date} ko {how} se {amount} wapas'),
    refundKhata: T('{amount} taken off your khata on {date}', '{date} को आपके खाते से {amount} कम किए गए', '{date} ko aapke khata se {amount} kam kiye'),
    refundPoints: T('{n} points earned on these items were taken back.', 'इन चीज़ों पर मिले {n} पॉइंट वापस ले लिए गए।', 'In items pe mile {n} points wapas le liye gaye.'),
    youPaidNet: T('You paid in the end', 'आख़िर में आपने दिए', 'Aakhir mein aapne diye'),
};
const METHODS = { cash: T('Cash', 'नकद', 'Cash'), card: T('Card', 'कार्ड', 'Card'), upi: T('UPI', 'UPI', 'UPI'), online: T('Online', 'ऑनलाइन', 'Online'), split: T('Split', 'बँटा हुआ', 'Split') };

const OrderDetails = () => {
    const { id } = useParams();
    const { lang, t } = useCxLang();
    const { socket } = useAuth();
    const [order, setOrder] = useState(null);
    // The cafe's ways to pay (on/off, own words) and pickup card colours
    const [screen, setScreen] = useState(null);
    useEffect(() => { getCustomerScreen().then(r => setScreen(r.data)).catch(() => {}); }, []);
    const payOn = (k) => screen?.pay?.[k]?.on !== false;
    const payText = (k, std) => (screen?.pay?.[k]?.text?.[lang] || '').trim() || t(std);
    const [loading, setLoading] = useState(true);
    const location = useLocation();
    const { show, nudge } = usePortal();
    const justPlaced = !!location.state?.justPlaced;
    const navigate = useNavigate();
    const { addLine } = useCart();

    // Cancelled: put the same dishes back in the cart (same size and choices, today's price) so ordering again is one tap
    const orderAgain = async () => {
        const { ok } = await checkLines((order.items || []).filter(i => !i.isRestricted).map(lineFromOrderItem));
        ok.forEach(addLine);
        navigate('/cart');
    };

    useEffect(() => {
        if (!justPlaced || !show('nudgeCelebrate')) return;
        const nth = location.state?.nth;
        nudge({ kind: `placed-${id}`, icon: '🎉', text: nth > 1 ? t(W.celebrateNth, { n: nth }) : t(W.celebrate) });
    }, [justPlaced, id]); // eslint-disable-line react-hooks/exhaustive-deps

    // Bill paid and nothing else open at this table: forget the table, so the next visit scans again
    useEffect(() => {
        if (order?.status !== 'paid' || !order.tableNumber) return;
        const qt = getQrTable();
        if (!qt || qt.tableNumber !== order.tableNumber) return;
        getCheckoutInfo().then(r => {
            if (!(r.data?.openAtTable || []).some(x => x.tableNumber === order.tableNumber)) clearQrTable();
        }).catch(() => {});
    }, [order?.status, order?.tableNumber]);

    useEffect(() => {
        fetchOrder();
    }, [id]);

    useEffect(() => {
        if (socket && order) {
            // Join user room with correct ID field
            if (order.user?._id) {
                socket.emit('join-user-room', order.user._id);
            }

            // Listen for personal order updates
            const handleMyOrderUpdate = (updatedOrder) => {
                if (updatedOrder._id === id) {
                    setOrder(updatedOrder);
                }
            };

            // Listen for general order updates (admin updating)
            const handleOrderUpdate = (updatedOrder) => {
                if (updatedOrder._id === id) {
                    setOrder(updatedOrder);
                }
            };

            socket.on('my-order-updated', handleMyOrderUpdate);
            socket.on('order-updated', handleOrderUpdate);

            return () => {
                socket.off('my-order-updated', handleMyOrderUpdate);
                socket.off('order-updated', handleOrderUpdate);
            };
        }
    }, [socket, id, order?.user?._id]);

    const fetchOrder = async () => {
        try {
            const res = await getOrder(id);
            setOrder(res.data);
        } catch (error) {
            console.error('Error fetching order:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleRequestBill = async () => {
        try {
            await requestBill(id);
            fetchOrder();
        } catch (error) {
            console.error('Error requesting bill:', error);
        }
    };

    const handlePay = async (mode) => {
        try {
            setOrder((await requestPayment(id, mode)).data);
        } catch (error) {
            alert(error.response?.data?.message || t(W.noStaff));
        }
    };

    if (loading) {
        return (
            <div className="loading-screen">
                <div className="spinner"></div>
            </div>
        );
    }

    if (!order) {
        return (
            <div className="order-details-page">
                <Header title={t(W.details)} showBack />
                <div className="empty-state">
                    <p>{t(W.notFound)}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="order-details-page">
            <Header title={t(W.yourOrder)} showBack showCart={false} />

            {justPlaced && show('nudgeCelebrate') && <Confetti />}
            {order.held && !['paid', 'cancelled'].includes(order.status) && (
                <div className="held-note"><FiClock aria-hidden="true" /> <span>{t(order.holdReason === 'accept' ? W.heldAccept : W.heldTable)}</span></div>
            )}

            {order.status === 'cancelled' && (
                <div className="cancelled-card" role="alert">
                    <strong>{t(W.cancelled)}</strong>
                    {customerReason(order.cancelReason) && <p>{t(W.reason, { reason: customerReason(order.cancelReason) })}</p>}
                    {order.amountPaid > 0 && <p>{t(W.refund, { amount: inr(order.amountPaid) })}</p>}
                    {order.pointsRedeemed > 0 && <p>{t(W.pointsBack, { n: order.pointsRedeemed })}</p>}
                    <p className="muted">{t(W.askStaff)}</p>
                    {(order.items || []).some(i => i.menuItem && !i.isRestricted) && (
                        <button className="btn btn-primary btn-full" onClick={orderAgain}>{t(W.orderAgain)}</button>
                    )}
                </div>
            )}

            {/* Takeaway / counter pickup: the number to watch for on the cafe screen */}
            {order.tokenNumber && !order.tableNumber && order.status !== 'cancelled'
                && (order.items || []).some(i => i.kitchenStatus !== 'served') && (() => {
                const ready = (order.items || []).every(i => ['ready', 'served'].includes(i.kitchenStatus));
                const pc = screen?.pickupColors || {};
                return (
                    <div className={`pickup-card ${ready ? 'ready' : ''} ${(ready ? pc.ready : pc.wait) ? 'tinted' : ''}`}
                        style={(ready ? pc.ready : pc.wait) ? { background: `linear-gradient(135deg, ${ready ? pc.ready : pc.wait}, color-mix(in srgb, ${ready ? pc.ready : pc.wait} 70%, #000))`, borderColor: 'transparent' } : undefined}>
                        <span className="pickup-label">{t(ready ? W.readyCollect : W.yourNumber)}</span>
                        <span className="pickup-num">{order.tokenNumber}</span>
                        <span className="pickup-oid">{String(order.orderNumber).replace(/[^-]+$/, '')}<b>{String(order.orderNumber).match(/[^-]+$/)?.[0]}</b></span>
                        <span className="pickup-hint">{t(ready ? W.showNumber : W.watchScreen)}</span>
                    </div>
                );
            })()}

            {/* Order Status */}
            <div className="order-status-section">
                <OrderStatus status={order.status} />
            </div>

            {/* Order Items */}
            <div className="order-items-section">
                <h3>{t(W.items)}</h3>
                {order.items.map((item, index) => (
                    <div key={index} className="order-item">
                        <div className="order-item-info">
                            <span className="order-item-name">{item.name}</span>
                            <span className="order-item-qty">x{item.quantity}</span>
                            {/* Size, choices and the customer note; a combo lists each dish on its own line */}
                            {item.note && (item.comboId
                                ? <ul className="order-item-picks">{String(item.note).split(' · ')[0].split(' + ').map((pk, i) => <li key={i}>{pk}</li>)}
                                    {String(item.note).includes(' · ') && <li className="order-item-own">“{String(item.note).split(' · ').slice(1).join(' · ')}”</li>}</ul>
                                : <span className="order-item-note">{item.note}</span>)}
                        </div>
                        <span className="order-item-price">₹{item.total}</span>
                    </div>
                ))}
            </div>

            {/* Bill Section - Shown when bill is generated */}
            {order.status === 'bill_generated' || order.status === 'paid' ? (
                <div className="bill-section">
                    <h3><FiFileText /> {t(W.yourBill)}</h3>
                    <div className="bill-details">
                        <div className="bill-row">
                            <span>{t(W.subtotal)}</span>
                            <span>₹{order.subtotal.toFixed(2)}</span>
                        </div>
                        {order.discount > 0 && (
                            <div className="bill-row discount">
                                <span>{t(W.discount, { code: order.couponCode || '' }).replace(/\s*\(\)/, '')}</span>
                                <span>-₹{order.discount.toFixed(2)}</span>
                            </div>
                        )}
                        {(order.taxDetails?.length ? order.taxDetails : [{ name: 'GST', rate: order.gstRate, amount: order.tax }]).map(tax => (
                            <div className="bill-row" key={`${tax.name}${tax.rate}`}>
                                <span>{tax.name} ({tax.rate}%)</span>
                                <span>₹{Number(tax.amount).toFixed(2)}</span>
                            </div>
                        ))}
                        {order.serviceCharge > 0 && (
                            <div className="bill-row">
                                <span>{t(W.service)}</span>
                                <span>₹{(order.serviceCharge + order.serviceChargeTax).toFixed(2)}</span>
                            </div>
                        )}
                        {Math.abs(order.roundOff || 0) > 0.001 && (
                            <div className="bill-row">
                                <span>{t(W.roundOff)}</span>
                                <span>₹{order.roundOff.toFixed(2)}</span>
                            </div>
                        )}
                        <div className="bill-row total">
                            <span>{t(W.total)}</span>
                            <span>₹{order.total.toFixed(2)}</span>
                        </div>
                    </div>

                    {Number(order.refunded) > 0 && (order.refunds || []).length > 0 && (
                        <div className="refund-card" role="status">
                            <strong>{t(W.refunded, { amount: `₹${Number(order.refunded).toFixed(2)}` })}</strong>
                            {order.refunds.map(r => (
                                <div key={r.id} className="refund-card-row">
                                    <span>{(r.lines || []).map(l => `${l.quantity} × ${l.name}`).join(', ')}</span>
                                    <span className="muted">{t(r.method === 'khata' ? W.refundKhata : W.refundHow, {
                                        amount: `₹${Number(r.amount).toFixed(2)}`, how: t(METHODS[r.method] || METHODS.cash),
                                        date: new Date(r.at).toLocaleDateString(lang === 'en' ? 'en-IN' : 'hi-IN', { day: 'numeric', month: 'short' }) })}</span>
                                    {r.pointsReversed > 0 && <span className="muted small">{t(W.refundPoints, { n: r.pointsReversed })}</span>}
                                </div>
                            ))}
                            <div className="bill-row total"><span>{t(W.youPaidNet)}</span><span>₹{(order.total - Number(order.refunded)).toFixed(2)}</span></div>
                        </div>
                    )}

                    {order.status === 'paid' ? (
                        <div className="paid-badge">
                            <FiCheckCircle /> {t(W.paid)}
                        </div>
                    ) : order.paymentRequest === 'qr' ? (
                        <p className="payment-instruction">{t(W.qrComing)}</p>
                    ) : (
                        <p className="payment-instruction">
                            {t(W.goCounter)}
                        </p>
                    )}
                </div>
            ) : null}

            {/* Action Buttons */}
            <div className="order-actions">
                {/* One question, three clear answers */}
                {order.status === 'served' && !order.paymentRequest && (
                    <div className="pay-choice">
                        <p>{t(W.payHow)}</p>
                        {[['bill', W.bringBill, handleRequestBill], ['upi', W.payUpi, () => handlePay('qr')], ['counter', W.payCounter, () => handlePay('counter')]]
                            .filter(([k]) => payOn(k))
                            .map(([k, std, go], i) => <button key={k} onClick={go} className={`btn ${i === 0 ? 'btn-primary' : 'btn-secondary'} btn-full`}>{payText(k, std)}</button>)}
                    </div>
                )}

                {order.status === 'bill_requested' && (
                    <div className="waiting-message">
                        <div className="spinner"></div>
                        <p>{t(W.billComing)}</p>
                    </div>
                )}

                {['bill_requested', 'bill_generated'].includes(order.status) && !order.paymentRequest && (payOn('upi') || payOn('counter')) && (
                    <div className="pay-choice">
                        <p className="small">{t(W.otherWay)}</p>
                        {payOn('upi') && <button onClick={() => handlePay('qr')} className="btn btn-secondary btn-full">{payText('upi', W.payUpi)}</button>}
                        {payOn('counter') && <button onClick={() => handlePay('counter')} className="btn btn-secondary btn-full">{payText('counter', W.payCounter)}</button>}
                    </div>
                )}
            </div>

            {order.status === 'paid' && <DishFeedback orderId={order._id || order.id} />}

            {/* Order Info */}
            <div className="order-info-section">
                <h3>{t(W.info)}</h3>
                <div className="info-row">
                    <span>{t(W.number)}</span>
                    <span>{order.orderNumber}</span>
                </div>
                {order.tableNumber && (
                    <div className="info-row">
                        <span>{t(W.table)}</span>
                        <span>{order.tableNumber}</span>
                    </div>
                )}
                <div className="info-row">
                    <span>{t(W.time)}</span>
                    <span>{new Date(order.createdAt).toLocaleString(lang === 'hi' ? 'hi-IN' : 'en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <div className="info-row info-total">
                    <span>{t(W.amount)}</span>
                    <span>₹{Number(order.total).toFixed(2)}</span>
                </div>
                {order.paymentMethod !== 'pending' && (
                    <div className="info-row">
                        <span>{t(W.method)}</span>
                        <span className="capitalize">{METHODS[order.paymentMethod] ? t(METHODS[order.paymentMethod]) : order.paymentMethod}</span>
                    </div>
                )}
            </div>
        </div>
    );
};

export default OrderDetails;
