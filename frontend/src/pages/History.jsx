import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import Header from '../components/Header';
import { useAuth } from '../context/AuthContext';
import { getMyOrders } from '../utils/api';
import './History.css';

const History = () => {
    const { isAuthenticated } = useAuth();
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (isAuthenticated) {
            fetchOrders();
        } else {
            setLoading(false);
        }
    }, [isAuthenticated]);

    const fetchOrders = async () => {
        try {
            const res = await getMyOrders();
            setOrders(res.data);
        } catch (error) {
            console.error('Error fetching orders:', error);
        } finally {
            setLoading(false);
        }
    };

    const getStatusColor = (status) => {
        switch (status) {
            case 'paid': return 'success';
            case 'cancelled': return 'error';
            case 'preparing': return 'warning';
            default: return 'primary';
        }
    };

    const getStatusLabel = (status) => {
        const labels = {
            pending: 'Pending',
            confirmed: 'Confirmed',
            preparing: 'Preparing',
            ready: 'Ready',
            served: 'Served',
            bill_requested: 'Bill Requested',
            bill_generated: 'Bill Ready',
            paid: 'Completed',
            cancelled: 'Cancelled'
        };
        return labels[status] || status;
    };

    if (!isAuthenticated) {
        return (
            <div className="history-page">
                <Header title="Order History" />
                <div className="empty-state">
                    <div className="empty-state-icon">📋</div>
                    <h3>Login to see your orders</h3>
                    <p>Track your order history and reorder your favorites</p>
                    <Link to="/login" className="btn btn-primary">Login</Link>
                </div>
            </div>
        );
    }

    if (loading) {
        return (
            <div className="history-page">
                <Header title="Order History" />
                <div className="loading-state">
                    <div className="spinner"></div>
                </div>
            </div>
        );
    }

    return (
        <div className="history-page">
            <Header title="Order History" />

            {orders.length === 0 ? (
                <div className="empty-state">
                    <div className="empty-state-icon">📋</div>
                    <h3>No orders yet</h3>
                    <p>Your order history will appear here</p>
                    <Link to="/menu" className="btn btn-primary">Browse Menu</Link>
                </div>
            ) : (
                <div className="orders-list">
                    {orders.map(order => (
                        <Link key={order._id} to={`/order/${order._id}`} className="order-card">
                            <div className="order-card-header">
                                <span className="order-number">#{order.orderNumber}</span>
                                <span className={`order-status badge-${getStatusColor(order.status)}`}>
                                    {getStatusLabel(order.status)}
                                </span>
                            </div>
                            <div className="order-card-body">
                                <p className="order-items-summary">
                                    {order.items.map(i => `${i.name} x${i.quantity}`).slice(0, 2).join(', ')}
                                    {order.items.length > 2 ? ` +${order.items.length - 2} more` : ''}
                                </p>
                                <div className="order-card-footer">
                                    <span className="order-date">
                                        {new Date(order.createdAt).toLocaleDateString('en-IN', {
                                            day: 'numeric',
                                            month: 'short',
                                            year: 'numeric',
                                            hour: '2-digit',
                                            minute: '2-digit'
                                        })}
                                    </span>
                                    <span className="order-total">₹{order.total.toFixed(2)}</span>
                                </div>
                            </div>
                        </Link>
                    ))}
                </div>
            )}
        </div>
    );
};

export default History;
