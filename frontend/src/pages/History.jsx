import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import Header from '../components/Header';
import Art from '../components/cx/Art';
import { artFor } from '../components/cx/artKinds';
import { useAuth } from '../context/AuthContext';
import { getMyOrders } from '../utils/api';
import './History.css';
import useCxLang, { T } from '../lib/cxLang';

const W = {
    title: T('Order History', 'पुराने ऑर्डर', 'Purane order'),
    loginTitle: T('Login to see your orders', 'अपने ऑर्डर देखने के लिए लॉग इन करें', 'Apne order dekhne ke liye login karo'),
    loginSub: T('Track your order history and reorder your favorites', 'पुराने ऑर्डर देखें और अपनी पसंद फिर से मँगाएँ', 'Purane order dekho aur favourites phir se mangao'),
    login: T('Login', 'लॉग इन', 'Login'),
    emptyTitle: T('No orders yet', 'अभी तक कोई ऑर्डर नहीं', 'Abhi tak koi order nahi'),
    emptySub: T('Your order history will appear here', 'आपके पुराने ऑर्डर यहाँ दिखेंगे', 'Aapke purane order yahan dikhenge'),
    browse: T('Browse Menu', 'मेन्यू देखें', 'Menu dekho'),
    more: T(' +{n} more', ' +{n} और', ' +{n} aur'),
};
const STATUS = {
    pending: T('Placed', 'मिला', 'Mila'),
    confirmed: T('Confirmed', 'स्वीकार', 'Accept'),
    preparing: T('Preparing', 'बन रहा', 'Ban raha'),
    ready: T('Ready', 'तैयार', 'Ready'),
    served: T('Served', 'परोसा', 'Serve'),
    bill_requested: T('Bill Requested', 'बिल माँगा', 'Bill maanga'),
    bill_generated: T('Bill Ready', 'बिल तैयार', 'Bill ready'),
    paid: T('Paid', 'पेमेंट हो गया', 'Paid'),
    cancelled: T('Cancelled', 'रद्द', 'Cancel'),
};

const History = () => {
    const { lang, t } = useCxLang();
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

    const getStatusLabel = (status) => (STATUS[status] ? t(STATUS[status]) : status);

    if (!isAuthenticated) {
        return (
            <div className="history-page">
                <Header title={t(W.title)} />
                <div className="empty-state">
                    <Art kind="latte" className="empty-art" />
                    <h3>{t(W.loginTitle)}</h3>
                    <p>{t(W.loginSub)}</p>
                    <Link to="/login" className="btn btn-primary">{t(W.login)}</Link>
                </div>
            </div>
        );
    }

    if (loading) {
        return (
            <div className="history-page">
                <Header title={t(W.title)} />
                <div className="loading-state">
                    <div className="spinner"></div>
                </div>
            </div>
        );
    }

    return (
        <div className="history-page">
            <Header title={t(W.title)} />

            {orders.length === 0 ? (
                <div className="empty-state">
                    <Art kind="latte" className="empty-art" />
                    <h3>{t(W.emptyTitle)}</h3>
                    <p>{t(W.emptySub)}</p>
                    <Link to="/menu" className="btn btn-primary">{t(W.browse)}</Link>
                </div>
            ) : (
                <div className="orders-list">
                    {orders.map(order => (
                        <Link key={order._id} to={`/order/${order._id}`} className="order-card cx-glass">
                            <span className="order-pic" aria-hidden="true"><Art kind={artFor(order.items?.[0])} /></span>
                            <div className="order-main">
                            <div className="order-card-header">
                                <span className="order-number">#{order.orderNumber}</span>
                                <span className={`order-status badge-${getStatusColor(order.status)}`}>
                                    {getStatusLabel(order.status)}
                                </span>
                            </div>
                            <div className="order-card-body">
                                <p className="order-items-summary">
                                    {order.items.map(i => `${i.name} x${i.quantity}`).slice(0, 2).join(', ')}
                                    {order.items.length > 2 ? t(W.more, { n: order.items.length - 2 }) : ''}
                                </p>
                                <div className="order-card-footer">
                                    <span className="order-date">
                                        {new Date(order.createdAt).toLocaleDateString(lang === 'hi' ? 'hi-IN' : 'en-IN', {
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
                            </div>
                        </Link>
                    ))}
                </div>
            )}
        </div>
    );
};

export default History;
