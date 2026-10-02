import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { FiFileText, FiCheckCircle } from 'react-icons/fi';
import Header from '../components/Header';
import OrderStatus from '../components/OrderStatus';
import { useAuth } from '../context/AuthContext';
import { getOrder, requestBill } from '../utils/api';
import './OrderDetails.css';

const OrderDetails = () => {
    const { id } = useParams();
    const { socket } = useAuth();
    const [order, setOrder] = useState(null);
    const [loading, setLoading] = useState(true);

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
                        <div className="bill-row">
                            <span>GST (5%)</span>
                            <span>₹{order.tax.toFixed(2)}</span>
                        </div>
                        <div className="bill-row total">
                            <span>Total</span>
                            <span>₹{order.total.toFixed(2)}</span>
                        </div>
                    </div>

                    {order.status === 'paid' ? (
                        <div className="paid-badge">
                            <FiCheckCircle /> Payment Received - Thank You!
                        </div>
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

                {order.status === 'bill_requested' && (
                    <div className="waiting-message">
                        <div className="spinner"></div>
                        <p>Waiting for bill...</p>
                    </div>
                )}
            </div>

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
                    <span>{new Date(order.createdAt).toLocaleString()}</span>
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
