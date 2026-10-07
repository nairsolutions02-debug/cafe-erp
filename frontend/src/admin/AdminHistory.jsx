import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FiSearch, FiFileText, FiClock, FiCheckCircle, FiXCircle, FiDownload, FiCalendar, FiX, FiCornerUpLeft } from 'react-icons/fi';
import { getAllOrders } from '../utils/api';
import { exportToCSV, orderExportColumns, getFilenameDate } from '../utils/exportUtils';
import OrderBill from '../components/OrderBill';
import CancelModal from './CancelModal';
import { useAuth } from '../context/AuthContext';
import { LineNote } from './pos/ChoicePicker';
import './AdminHistory.css';

const AdminHistory = () => {
    const { hasPerm } = useAuth();
    const [orders, setOrders] = useState([]);
    // Cancel a bill or refund some of its items, on any day (a manager PIN is asked for when the person cannot void bills).
    // A refund on a later day counts on the day it is given, not on the day of the bill.
    const [cancelling, setCancelling] = useState(null);
    const canRefund = (o) => hasPerm('orders.create') && o.status === 'paid';
    const itemsLeft = (o) => (o.items || []).some(i => Number(i.quantity) > Number(i.refundedQty || 0));
    const [loading, setLoading] = useState(true);
    const [selectedOrder, setSelectedOrder] = useState(null);
    const [searchParams] = useSearchParams();
    const orderQuery = (searchParams.get('q') || '').trim().toLowerCase();
    // Opened from global search with an order number: look across all dates
    const [allTime, setAllTime] = useState(!!orderQuery);
    const [filters, setFilters] = useState({
        status: '',
        date: new Date().toISOString().split('T')[0]
    });
    const [showExportModal, setShowExportModal] = useState(false);
    const [exportRange, setExportRange] = useState({
        startDate: '',
        endDate: ''
    });

    useEffect(() => {
        fetchOrders();
    }, [filters, allTime]);

    const fetchOrders = async () => {
        setLoading(true);
        try {
            const apiFilters = { ...filters };
            if (allTime) delete apiFilters.date;

            const res = await getAllOrders(apiFilters);
            setOrders(res.data);
        } catch (error) {
            console.error('Error fetching history:', error);
        } finally {
            setLoading(false);
        }
    };

    const getStatusIcon = (status) => {
        switch (status) {
            case 'paid': return <FiCheckCircle className="text-success" />;
            case 'cancelled': return <FiXCircle className="text-danger" />;
            default: return <FiClock className="text-warning" />;
        }
    };

    const handleExport = async () => {
        try {
            const params = {
                ...(exportRange.startDate && { startDate: exportRange.startDate }),
                ...(exportRange.endDate && { endDate: exportRange.endDate })
            };
            const res = await getAllOrders(params);
            const dataToExport = res.data || [];

            const filename = exportRange.startDate && exportRange.endDate
                ? `orders_${exportRange.startDate}_to_${exportRange.endDate}`
                : `orders_${getFilenameDate()}`;

            exportToCSV(dataToExport, orderExportColumns, filename);
            setShowExportModal(false);
            setExportRange({ startDate: '', endDate: '' });
        } catch (error) {
            console.error('Export error:', error);
            alert('Failed to export data');
        }
    };

    return (
        <div className="admin-history">
            <div className="page-header">
                <div className="header-main">
                    <h1>Order History</h1>
                    <div className="history-tabs">
                        <button
                            className={`tab-btn ${!allTime ? 'active' : ''}`}
                            onClick={() => setAllTime(false)}
                        >
                            Daily
                        </button>
                        <button
                            className={`tab-btn ${allTime ? 'active' : ''}`}
                            onClick={() => setAllTime(true)}
                        >
                            All Time
                        </button>
                        <button className="btn btn-primary export-btn" onClick={() => setShowExportModal(true)}>
                            <FiDownload /> Export
                        </button>
                    </div>
                </div>
                <div className="filters">
                    {!allTime && (
                        <input
                            type="date"
                            className="input"
                            value={filters.date}
                            onChange={(e) => setFilters({ ...filters, date: e.target.value })}
                        />
                    )}
                    <select
                        className="input"
                        value={filters.status}
                        onChange={(e) => setFilters({ ...filters, status: e.target.value })}
                    >
                        <option value="">All Status</option>
                        <option value="paid">Paid</option>
                        <option value="cancelled">Cancelled</option>
                        <option value="pending">Pending</option>
                    </select>
                </div>
            </div>

            <div className="history-table-container">
                {loading ? (
                    <div className="admin-loading"><div className="spinner"></div></div>
                ) : (
                    <table className="admin-table">
                        <thead>
                            <tr>
                                <th>Order #</th>
                                <th>Customer</th>
                                <th>Items</th>
                                <th>Total</th>
                                <th>Status</th>
                                <th>Time</th>
                                <th>Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {orders.filter(o => !orderQuery || o.orderNumber.toLowerCase().includes(orderQuery)).map(order => (
                                <tr key={order._id}>
                                    <td className="font-bold">{order.orderNumber}
                                        {order.printCount > 1 && <span className="hist-refunded" title={`Last printed by ${order.lastPrintBy}`}>Printed {order.printCount}× · {order.lastPrintBy}</span>}
                                        {order.shiftNote && <span className="hist-refunded">{order.shiftNote}</span>}
                                    </td>
                                    <td>
                                        <div className="cust-info">
                                            <span>{order.user?.name || 'Walk-in'}</span>
                                            <span className="text-muted">{order.user?.phone}</span>
                                        </div>
                                    </td>
                                    <td>
                                        <ul className="items-preview hist-items">
                                            {order.items.map((it, n) => (
                                                <li key={n}><b>{it.quantity}×</b> {it.name}<LineNote item={it} /></li>
                                            ))}
                                        </ul>
                                    </td>
                                    <td className="font-bold text-primary">₹{order.total.toFixed(2)}
                                        {Number(order.refunded) > 0 && order.status !== 'cancelled' && <span className="hist-refunded">Refunded ₹{Number(order.refunded).toFixed(2)}</span>}
                                    </td>
                                    <td>
                                        <span className={`status-pill ${order.status}`}>
                                            {getStatusIcon(order.status)} {order.status}
                                        </span>
                                    </td>
                                    <td>
                                        {allTime ? (
                                            new Date(order.createdAt).toLocaleDateString('en-IN', {
                                                day: '2-digit',
                                                month: 'short',
                                                year: 'numeric'
                                            })
                                        ) : (
                                            new Date(order.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                                        )}
                                    </td>
                                    <td>
                                        <button
                                            className="btn-view-bill"
                                            onClick={() => setSelectedOrder(order)}
                                        >
                                            <FiFileText /> Bill
                                        </button>
                                        {canRefund(order) && itemsLeft(order) && (
                                            <button className="btn-view-bill refund" onClick={() => setCancelling({ order, startWith: 'refund' })} title="Give back the money for some items">
                                                <FiCornerUpLeft /> Refund items
                                            </button>
                                        )}
                                        {canRefund(order) && (
                                            <button className="btn-view-bill refund" onClick={() => setCancelling({ order, startWith: 'cancel' })} title="Cancel this bill and refund the money">
                                                <FiXCircle /> Cancel bill
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}

                {!loading && orders.length === 0 && (
                    <div className="no-data">
                        <FiSearch size={48} />
                        <p>No orders found for this selection</p>
                    </div>
                )}
            </div>

            {cancelling && (
                <CancelModal order={cancelling.order} startWith={cancelling.startWith} canVoid={hasPerm('sensitive.void_bill')} onClose={() => setCancelling(null)}
                    onDone={() => { setCancelling(null); fetchOrders(); }} />
            )}

            {selectedOrder && (
                <OrderBill
                    order={selectedOrder}
                    onCancel={() => setSelectedOrder(null)}
                />
            )}

            {/* Export Modal */}
            {showExportModal && (
                <div className="modal-overlay" onClick={() => setShowExportModal(false)}>
                    <div className="export-modal" onClick={e => e.stopPropagation()}>
                        <button className="close-btn" onClick={() => setShowExportModal(false)}><FiX /></button>
                        <h2><FiDownload /> Export Orders</h2>
                        <p>Download order history as CSV file</p>

                        <div className="date-range-section">
                            <h4><FiCalendar /> Date Range</h4>
                            <p className="hint">Select dates or leave empty for all orders</p>
                            <div className="date-inputs">
                                <div className="input-group">
                                    <label>From Date</label>
                                    <input
                                        type="date"
                                        value={exportRange.startDate}
                                        onChange={(e) => setExportRange({ ...exportRange, startDate: e.target.value })}
                                    />
                                </div>
                                <div className="input-group">
                                    <label>To Date</label>
                                    <input
                                        type="date"
                                        value={exportRange.endDate}
                                        onChange={(e) => setExportRange({ ...exportRange, endDate: e.target.value })}
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="export-info">
                            <p>📋 Export includes: Order ID, Date, Customer, Items, Total, Payment Method, Status</p>
                        </div>

                        <div className="modal-actions">
                            <button className="btn btn-secondary" onClick={() => setShowExportModal(false)}>Cancel</button>
                            <button className="btn btn-primary" onClick={handleExport}>
                                <FiDownload /> Download CSV
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AdminHistory;
