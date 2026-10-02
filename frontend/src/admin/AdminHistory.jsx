import React, { useState, useEffect } from 'react';
import { FiSearch, FiFileText, FiClock, FiCheckCircle, FiXCircle, FiDownload, FiCalendar, FiX } from 'react-icons/fi';
import { getAllOrders } from '../utils/api';
import { exportToCSV, orderExportColumns, getFilenameDate } from '../utils/exportUtils';
import OrderBill from '../components/OrderBill';
import './AdminHistory.css';

const AdminHistory = () => {
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedOrder, setSelectedOrder] = useState(null);
    const [allTime, setAllTime] = useState(false);
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
                            {orders.map(order => (
                                <tr key={order._id}>
                                    <td className="font-bold">{order.orderNumber}</td>
                                    <td>
                                        <div className="cust-info">
                                            <span>{order.user?.name || 'Walk-in'}</span>
                                            <span className="text-muted">{order.user?.phone}</span>
                                        </div>
                                    </td>
                                    <td>
                                        <div className="items-preview">
                                            {order.items.length} items
                                        </div>
                                    </td>
                                    <td className="font-bold text-primary">₹{order.total.toFixed(2)}</td>
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
