import React from 'react';
import './OrderStatus.css';
import { FiClipboard, FiCheck, FiCoffee, FiCheckCircle, FiFlag, FiFileText, FiXCircle } from 'react-icons/fi';
import { BiDish } from 'react-icons/bi';
import useCxLang, { T } from '../lib/cxLang';

const W = {
    placed: T('Order Placed', 'ऑर्डर मिला', 'Order mila'),
    confirmed: T('Confirmed', 'स्वीकार', 'Accept'),
    preparing: T('Preparing', 'बन रहा', 'Ban raha'),
    ready: T('Ready', 'तैयार', 'Ready'),
    served: T('Served', 'परोसा', 'Serve'),
    cancelled: T('Order Cancelled', 'ऑर्डर रद्द', 'Order cancel'),
    paid: T('Order Complete & Paid', 'ऑर्डर पूरा, पेमेंट हो गया', 'Order poora, paid'),
    billRequested: T('Bill Requested', 'बिल माँगा', 'Bill maanga'),
    billReady: T('Bill Ready', 'बिल तैयार', 'Bill ready'),
};

const statusSteps = [
    { key: 'pending', label: W.placed, icon: <FiClipboard /> },
    { key: 'confirmed', label: W.confirmed, icon: <FiCheck /> },
    { key: 'preparing', label: W.preparing, icon: <FiCoffee /> }, // Or a chef hat icon if available, using coffee/cooking metaphor
    { key: 'ready', label: W.ready, icon: <BiDish /> },
    { key: 'served', label: W.served, icon: <FiFlag /> },
];

const OrderStatus = ({ status }) => {
    const { t } = useCxLang();
    const currentIndex = statusSteps.findIndex(s => s.key === status);

    if (status === 'cancelled') {
        return (
            <div className="order-status-cancelled">
                <div className="cancelled-icon"><FiXCircle /></div>
                <span>{t(W.cancelled)}</span>
            </div>
        );
    }

    if (status === 'paid') {
        return (
            <div className="order-status-complete">
                <div className="complete-icon"><FiCheckCircle /></div>
                <span>{t(W.paid)}</span>
            </div>
        );
    }

    if (status === 'bill_requested' || status === 'bill_generated') {
        return (
            <div className="order-status-bill">
                <div className="bill-icon"><FiFileText /></div>
                <span>{t(status === 'bill_requested' ? W.billRequested : W.billReady)}</span>
            </div>
        );
    }

    return (
        <div className="order-status-tracker">
            {statusSteps.map((step, index) => (
                <div
                    key={step.key}
                    className={`status-step ${index <= currentIndex ? 'completed' : ''} ${index === currentIndex ? 'current' : ''}`}
                >
                    <div className="step-icon">{step.icon}</div>
                    <div className="step-label">{t(step.label)}</div>
                    {index < statusSteps.length - 1 && (
                        <div className={`step-line ${index < currentIndex ? 'completed' : ''}`}></div>
                    )}
                </div>
            ))}
        </div>
    );
};

export default OrderStatus;
