import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { FiFileText, FiCheckCircle } from 'react-icons/fi';
import Header from '../components/Header';
import OrderStatus from '../components/OrderStatus';
import DishFeedback from '../components/DishFeedback';
import { useAuth } from '../context/AuthContext';
import { getOrder, requestBill, requestPayment, getCheckoutInfo } from '../utils/api';
import { usePortal } from '../context/PortalContext';
import { clearQrTable, getQrTable } from '../lib/qrTable';
import Confetti from '../components/cx/Confetti';
import { useCart } from '../context/CartContext';
import { inr } from '../admin/pos/money';

// What staff typed as the reason, without the internal "(approved by …)" note
const customerReason = (r) => String(r || '').replace(/\s*\(approved by [^)]*\)\s*$/i, '').trim();
import './OrderDetails.css';

const OrderDetails = () => {
    const { id } = useParams();
    const { socket } = useAuth();
    const [order, setOrder] = useState(null);
    const [loading, setLoading] = useState(true);
    const location = useLocation();
    const { show, nudge } = usePortal();
    const justPlaced = !!location.state?.justPlaced;
    const navigate = useNavigate();
    const { addItem } = useCart();

    // Cancelled: put the same dishes back in the cart so ordering again is one tap
    const orderAgain = () => {
        (order.items || []).forEach(i => {
            if (!i.menuItem || i.isRestricted) return;
            for (let n = 0; n < i.quantity; n++) {
                addItem({ _id: i.menuItem._id, name: i.menuItem.name, price: i.menuItem.price, image: i.menuItem.image, isAvailable: true });
            }
        });
        navigate('/cart');
    };

    useEffect(() => {
        if (!justPlaced || !show('nudgeCelebrate')) return;
        const nth = location.state?.nth;
        nudge({ kind: `placed-${id}`, icon: '🎉', text: nth > 1 ? `Order placed! That's order #${nth} with us. Thank you!` : 'Order placed! The kitchen has it.' });
    }, [justPlaced, id]); // eslint-disable-line react-hooks/exhaustive-deps

    // Bill paid and nothing else open at this table: forget the table, so the next visit scans again
    useEffect(() => {
        if (order?.status !== 'paid' || !order.tableNumber) return;
        const t = getQrTable();
        if (!t || t.tableNumber !== order.tableNumber) return;
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
            alert(error.response?.data?.message || 'Could not reach the staff, please ask at the counter');
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
                <Header title="Order Details" showBack />
                <div className="empty-state">
                    <p>Order not found</p>
                </div>
            </div>
        );
    }

    return (
        <div className="order-details-page">
            <Header title={`Order #${order.orderNumber}`} showBack showCart={false} />

            {justPlaced && show('nudgeCelebrate') && <Confetti />}
            {order.held && !['paid', 'cancelled'].includes(order.status) && (
                <div className="held-note">⏳ <span>{order.holdReason === 'accept' ? 'Got it! The cafe will accept your order in a moment, then the kitchen starts.' : 'Got it! A staff member will confirm your table in a moment, then the kitchen starts.'}</span></div>
            )}

            {order.status === 'cancelled' && (
                <div className="cancelled-card" role="alert">
                    <strong>This order was cancelled</strong>
                    {customerReason(order.cancelReason) && <p>Reason: {customerReason(order.cancelReason)}</p>}
                    {order.amountPaid > 0 && <p>You paid {inr(order.amountPaid)}. The staff will return it to you.</p>}
                    {order.pointsRedeemed > 0 && <p>Your {order.pointsRedeemed} points are back in your account.</p>}
                    <p className="muted">Questions? Please ask the staff.</p>
                    {(order.items || []).some(i => i.menuItem && !i.isRestricted) && (
                        <button className="btn btn-primary btn-full" onClick={orderAgain}>Order again</button>
                    )}
                </div>
            )}

            {/* Takeaway / counter pickup: the number to watch for on the cafe screen */}
            {order.tokenNumber && !order.tableNumber && order.status !== 'cancelled'
                && (order.items || []).some(i => i.kitchenStatus !== 'served') && (() => {
                const ready = (order.items || []).every(i => ['ready', 'served'].includes(i.kitchenStatus));
                return (
                    <div className={`pickup-card ${ready ? 'ready' : ''}`}>
                        <span className="pickup-label">{ready ? 'Ready! Collect at the counter' : 'Your number'}</span>
                        <span className="pickup-num">{order.tokenNumber}</span>
                        <span className="pickup-hint">{ready ? 'Show this number at the serving counter' : 'Watch for it on the screen at the counter'}</span>
                    </div>
                );
            })()}

            {/* Order Status */}
            <div className="order-status-section">
                <OrderStatus status={order.status} />
            </div>

            {/* Order Items */}
            <div className="order-items-section">
                <h3>Order Items</h3>
                {order.items.map((item, index) => (
                    <div key={index} className="order-item">
                        <div className="order-item-info">
                            <span className="order-item-name">{item.name}</span>
                            <span className="order-item-qty">x{item.quantity}</span>
                        </div>
                        <span className="order-item-price">₹{item.total}</span>
                    </div>
                ))}
            </div>

            {/* Bill Section - Shown when bill is generated */}
            {order.status === 'bill_generated' || order.status === 'paid' ? (
                <div className="bill-section">
                    <h3><FiFileText /> Your Bill</h3>
                    <div className="bill-details">
                        <div className="bill-row">
                            <span>Subtotal</span>
                            <span>₹{order.subtotal.toFixed(2)}</span>
                        </div>
                        {order.discount > 0 && (
                            <div className="bill-row discount">
                                <span>Discount ({order.couponCode})</span>
                                <span>-₹{order.discount.toFixed(2)}</span>
                            </div>
                        )}
                        {(order.taxDetails?.length ? order.taxDetails : [{ name: 'GST', rate: order.gstRate, amount: order.tax }]).map(t => (
                            <div className="bill-row" key={`${t.name}${t.rate}`}>
                                <span>{t.name} ({t.rate}%)</span>
                                <span>₹{Number(t.amount).toFixed(2)}</span>
                            </div>
                        ))}
                        {order.serviceCharge > 0 && (
                            <div className="bill-row">
                                <span>Service charge (optional, ask staff to remove) + GST</span>
                                <span>₹{(order.serviceCharge + order.serviceChargeTax).toFixed(2)}</span>
                            </div>
                        )}
                        {Math.abs(order.roundOff || 0) > 0.001 && (
                            <div className="bill-row">
                                <span>Round off</span>
                                <span>₹{order.roundOff.toFixed(2)}</span>
                            </div>
                        )}
                        <div className="bill-row total">
                            <span>Total</span>
                            <span>₹{order.total.toFixed(2)}</span>
                        </div>
                    </div>

                    {order.status === 'paid' ? (
                        <div className="paid-badge">
                            <FiCheckCircle /> Payment Received - Thank You!
                        </div>
                    ) : order.paymentRequest === 'qr' ? (
                        <p className="payment-instruction">Staff are bringing the UPI QR to your table.</p>
                    ) : (
                        <p className="payment-instruction">
                            Please proceed to the counter to complete payment
                        </p>
                    )}
                </div>
            ) : null}

            {/* Action Buttons */}
            <div className="order-actions">
                {order.status === 'served' && (
                    <button onClick={handleRequestBill} className="btn btn-primary btn-full">
                        Request Bill
                    </button>
                )}

                {['served', 'bill_requested', 'bill_generated'].includes(order.status) && !order.paymentRequest && (
                    <div className="pay-choice">
                        <p>How would you like to pay?</p>
                        <button onClick={() => handlePay('counter')} className="btn btn-secondary btn-full">Pay at the counter</button>
                        <button onClick={() => handlePay('qr')} className="btn btn-primary btn-full">Pay by UPI at my table</button>
                    </div>
                )}

                {order.status === 'bill_requested' && (
                    <div className="waiting-message">
                        <div className="spinner"></div>
                        <p>Waiting for bill...</p>
                    </div>
                )}
            </div>

            {order.status === 'paid' && <DishFeedback orderId={order._id || order.id} />}

            {/* Order Info */}
            <div className="order-info-section">
                <h3>Order Info</h3>
                <div className="info-row">
                    <span>Order Number</span>
                    <span>{order.orderNumber}</span>
                </div>
                {order.tableNumber && (
                    <div className="info-row">
                        <span>Table Number</span>
                        <span>{order.tableNumber}</span>
                    </div>
                )}
                <div className="info-row">
                    <span>Order Time</span>
                    <span>{new Date(order.createdAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                {order.paymentMethod !== 'pending' && (
                    <div className="info-row">
                        <span>Payment Method</span>
                        <span className="capitalize">{order.paymentMethod}</span>
                    </div>
                )}
            </div>
        </div>
    );
};

export default OrderDetails;
