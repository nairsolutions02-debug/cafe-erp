import React, { useState, useEffect } from 'react';
import { FiSearch, FiUser, FiPhone, FiDollarSign, FiShoppingBag, FiChevronDown, FiChevronUp, FiX, FiStar, FiGift, FiDownload, FiCalendar } from 'react-icons/fi';
import { getCustomerAnalytics, getCustomerDetail } from '../utils/api';
import { exportToCSV, customerExportColumns, getFilenameDate } from '../utils/exportUtils';
import Loader from '../components/Loader';
import './AdminCustomers.css';

const AdminCustomers = () => {
    const [customers, setCustomers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [sortBy, setSortBy] = useState('totalSpent');
    const [sortOrder, setSortOrder] = useState('desc');
    const [selectedCustomer, setSelectedCustomer] = useState(null);
    const [customerDetail, setCustomerDetail] = useState(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [pagination, setPagination] = useState({ total: 0, page: 1, pages: 1 });
    const [showExportModal, setShowExportModal] = useState(false);
    const [dateRange, setDateRange] = useState({
        startDate: '',
        endDate: ''
    });

    useEffect(() => {
        fetchCustomers();
    }, [search, sortBy, sortOrder]);

    const fetchCustomers = async () => {
        try {
            setLoading(true);
            const res = await getCustomerAnalytics({
                search,
                sortBy,
                order: sortOrder,
                page: pagination.page,
                limit: 20
            });
            console.log('Customers API Response:', res.data);
            setCustomers(res.data.customers);
            setPagination(res.data.pagination);
        } catch (error) {
            console.error('Error fetching customers:', error);
            if (error.response) console.log('Error Response:', error.response.data);
        } finally {
            setLoading(false);
        }
    };

    const handleSort = (field) => {
        if (sortBy === field) {
            setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc');
        } else {
            setSortBy(field);
            setSortOrder('desc');
        }
    };

    const handleCustomerClick = async (customer) => {
        setSelectedCustomer(customer);
        setDetailLoading(true);
        try {
            const res = await getCustomerDetail(customer._id);
            setCustomerDetail(res.data);
        } catch (error) {
            console.error('Error fetching customer detail:', error);
        } finally {
            setDetailLoading(false);
        }
    };

    const closeModal = () => {
        setSelectedCustomer(null);
        setCustomerDetail(null);
    };

    const SortIcon = ({ field }) => {
        if (sortBy !== field) return null;
        return sortOrder === 'desc' ? <FiChevronDown /> : <FiChevronUp />;
    };

    const handleExport = async () => {
        try {
            // Fetch all customers for export (with date range if specified)
            const params = {
                sortBy,
                order: sortOrder,
                limit: 10000, // Get all for export
                ...(dateRange.startDate && { startDate: dateRange.startDate }),
                ...(dateRange.endDate && { endDate: dateRange.endDate })
            };
            const res = await getCustomerAnalytics(params);
            const dataToExport = res.data.customers || [];

            const filename = dateRange.startDate && dateRange.endDate
                ? `customers_${dateRange.startDate}_to_${dateRange.endDate}`
                : `customers_${getFilenameDate()}`;

            exportToCSV(dataToExport, customerExportColumns, filename);
            setShowExportModal(false);
            setDateRange({ startDate: '', endDate: '' });
        } catch (error) {
            console.error('Export error:', error);
            alert('Failed to export data');
        }
    };

    if (loading && customers.length === 0) {
        return <Loader message="Loading customers..." />;
    }

    return (
        <div className="admin-customers">
            <div className="page-header">
                <div>
                    <h1>Customer Analytics</h1>
                    <p>View customer spending and order history</p>
                </div>
                <button className="btn btn-primary export-btn" onClick={() => setShowExportModal(true)}>
                    <FiDownload /> Export CSV
                </button>
            </div>

            {/* Stats Summary */}
            <div className="stats-row">
                <div className="stat-card">
                    <FiUser className="stat-icon" />
                    <div>
                        <span className="stat-value">{pagination.total}</span>
                        <span className="stat-label">Total Customers</span>
                    </div>
                </div>
                <div className="stat-card">
                    <FiDollarSign className="stat-icon green" />
                    <div>
                        <span className="stat-value">₹{customers.reduce((s, c) => s + c.totalSpent, 0).toLocaleString()}</span>
                        <span className="stat-label">Total Revenue</span>
                    </div>
                </div>
                <div className="stat-card">
                    <FiShoppingBag className="stat-icon orange" />
                    <div>
                        <span className="stat-value">{customers.reduce((s, c) => s + c.paidOrders, 0)}</span>
                        <span className="stat-label">Total Orders</span>
                    </div>
                </div>
            </div>

            {/* Search */}
            <div className="search-bar">
                <FiSearch className="search-icon" />
                <input
                    type="text"
                    placeholder="Search by name, phone, or email..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                />
            </div>

            {/* Customers Table */}
            <div className="table-container">
                <table className="customers-table">
                    <thead>
                        <tr>
                            <th>Customer</th>
                            <th onClick={() => handleSort('totalOrders')} className="sortable">
                                Orders <SortIcon field="totalOrders" />
                            </th>
                            <th onClick={() => handleSort('totalSpent')} className="sortable">
                                Total Spent <SortIcon field="totalSpent" />
                            </th>
                            <th onClick={() => handleSort('loyaltyPoints')} className="sortable">
                                Points <SortIcon field="loyaltyPoints" />
                            </th>
                            <th>Last Order</th>
                        </tr>
                    </thead>
                    <tbody>
                        {customers.map(customer => (
                            <tr key={customer._id} onClick={() => handleCustomerClick(customer)}>
                                <td className="customer-info">
                                    <div className="avatar">{customer.name?.[0]?.toUpperCase() || '?'}</div>
                                    <div>
                                        <span className="name">{customer.name || 'No Name'}</span>
                                        <span className="phone">{customer.phone}</span>
                                    </div>
                                </td>
                                <td>{customer.totalOrders || 0}</td>
                                <td className="amount">₹{(customer.totalSpent || 0).toLocaleString()}</td>
                                <td>
                                    <span className="points-badge">🪙 {customer.loyaltyPoints || 0}</span>
                                </td>
                                <td className="date">
                                    {customer.lastOrderDate
                                        ? new Date(customer.lastOrderDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
                                        : '-'}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {customers.length === 0 && !loading && (
                <div className="no-results">
                    <p>No customers found</p>
                </div>
            )}

            {/* Customer Detail Modal */}
            {selectedCustomer && (
                <div className="modal-overlay" onClick={closeModal}>
                    <div className="customer-modal" onClick={e => e.stopPropagation()}>
                        <button className="close-btn" onClick={closeModal}><FiX /></button>

                        {detailLoading ? (
                            <Loader message="Loading details..." />
                        ) : customerDetail && (
                            <>
                                <div className="modal-header">
                                    <div className="customer-avatar large">
                                        {customerDetail.customer.name?.[0]?.toUpperCase() || '?'}
                                    </div>
                                    <div className="customer-info">
                                        <h2>{customerDetail.customer.name || 'No Name'}</h2>
                                        <p><FiPhone /> {customerDetail.customer.phone}</p>
                                        {customerDetail.customer.email && <p>📧 {customerDetail.customer.email}</p>}
                                    </div>
                                </div>

                                <div className="stats-grid">
                                    <div className="stat">
                                        <span className="value">₹{customerDetail.stats.totalSpent.toLocaleString()}</span>
                                        <span className="label">Total Spent</span>
                                    </div>
                                    <div className="stat">
                                        <span className="value">{customerDetail.stats.paidOrders}</span>
                                        <span className="label">Orders</span>
                                    </div>
                                    <div className="stat">
                                        <span className="value">₹{customerDetail.stats.avgOrderValue.toFixed(0)}</span>
                                        <span className="label">Avg Order</span>
                                    </div>
                                    <div className="stat">
                                        <span className="value">🪙 {customerDetail.customer.loyaltyPoints}</span>
                                        <span className="label">Points</span>
                                    </div>
                                </div>

                                {customerDetail.favoriteItems.length > 0 && (
                                    <div className="section">
                                        <h3><FiStar /> Favorite Items</h3>
                                        <div className="favorite-items">
                                            {customerDetail.favoriteItems.map((item, index) => (
                                                <div key={index} className="fav-item">
                                                    <span className="item-name">{item.name}</span>
                                                    <span className="item-count">{item.count}x • ₹{item.total.toLocaleString()}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {customerDetail.recentOrders.length > 0 && (
                                    <div className="section">
                                        <h3><FiShoppingBag /> Recent Orders</h3>
                                        <div className="recent-orders">
                                            {customerDetail.recentOrders.slice(0, 5).map(order => (
                                                <div key={order._id} className="order-row">
                                                    <div>
                                                        <span className="order-id">#{order.orderNumber || order._id.slice(-6)}</span>
                                                        <span className="order-date">
                                                            {new Date(order.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                                                        </span>
                                                    </div>
                                                    <div>
                                                        <span className={`status ${order.status}`}>{order.status}</span>
                                                        <span className="order-amount">₹{order.total.toLocaleString()}</span>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* Export Modal */}
            {showExportModal && (
                <div className="modal-overlay" onClick={() => setShowExportModal(false)}>
                    <div className="export-modal" onClick={e => e.stopPropagation()}>
                        <button className="close-btn" onClick={() => setShowExportModal(false)}><FiX /></button>
                        <h2><FiDownload /> Export Customers</h2>
                        <p>Download customer data as CSV file</p>

                        <div className="date-range-section">
                            <h4><FiCalendar /> Date Range (Optional)</h4>
                            <p className="hint">Filter by customer registration date</p>
                            <div className="date-inputs">
                                <div className="input-group">
                                    <label>From Date</label>
                                    <input
                                        type="date"
                                        value={dateRange.startDate}
                                        onChange={(e) => setDateRange({ ...dateRange, startDate: e.target.value })}
                                    />
                                </div>
                                <div className="input-group">
                                    <label>To Date</label>
                                    <input
                                        type="date"
                                        value={dateRange.endDate}
                                        onChange={(e) => setDateRange({ ...dateRange, endDate: e.target.value })}
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="export-info">
                            <p>📋 Export includes: Name, Phone, Email, Total Orders, Total Spent, Loyalty Points, Last Order Date</p>
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

export default AdminCustomers;
