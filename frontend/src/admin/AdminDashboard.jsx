import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { FiShoppingBag, FiDollarSign, FiAlertCircle, FiTrendingUp, FiSettings, FiUsers } from 'react-icons/fi';
import { getDashboardStats, getActiveOrders, getLowStock, getGstRate, updateGstRate, getUserAnalytics } from '../utils/api';
import { useAuth } from '../context/AuthContext';
import Loader from '../components/Loader';
import './AdminDashboard.css';

const AdminDashboard = () => {
    const { socket } = useAuth();
    const [stats, setStats] = useState(null);
    const [activeOrders, setActiveOrders] = useState([]);
    const [lowStock, setLowStock] = useState([]);
    const [userStats, setUserStats] = useState(null);
    const [loading, setLoading] = useState(true);
    const [gstRate, setGstRate] = useState(5);
    const [newGstRate, setNewGstRate] = useState(5);
    const [gstSaving, setGstSaving] = useState(false);

    useEffect(() => {
        fetchData();
        fetchGstRate();

        const interval = setInterval(fetchData, 30000);
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        if (socket) {
            socket.on('new-order', () => fetchData());
            socket.on('order-updated', () => fetchData());
            return () => {
                socket.off('new-order');
                socket.off('order-updated');
            };
        }
    }, [socket]);

    const fetchData = async () => {
        try {
            const [statsRes, ordersRes, stockRes, userRes] = await Promise.all([
                getDashboardStats(),
                getActiveOrders(),
                getLowStock(),
                getUserAnalytics('month')
            ]);
            setStats(statsRes.data);
            setActiveOrders(ordersRes.data);
            setLowStock(stockRes.data);
            setUserStats(userRes.data);
        } catch (error) {
            console.error('Error fetching dashboard data:', error);
        } finally {
            setLoading(false);
        }
    };

    const fetchGstRate = async () => {
        try {
            const res = await getGstRate();
            setGstRate(res.data.gstRate || 5);
            setNewGstRate(res.data.gstRate || 5);
        } catch (error) {
            console.error('Error fetching GST rate:', error);
        }
    };

    const handleGstUpdate = async () => {
        if (newGstRate < 0 || newGstRate > 100) {
            alert('GST rate must be between 0 and 100');
            return;
        }
        setGstSaving(true);
        try {
            await updateGstRate(parseFloat(newGstRate));
            setGstRate(newGstRate);
            alert('GST rate updated successfully!');
        } catch (error) {
            alert('Failed to update GST rate');
        } finally {
            setGstSaving(false);
        }
    };

    if (loading) {
        return <Loader message="Setting up your dashboard..." />;
    }

    return (
        <div className="admin-dashboard">
            <h1>Dashboard</h1>

            {/* Stats Cards */}
            <div className="stats-grid">
                <div className="stat-card">
                    <div className="stat-icon revenue"><FiDollarSign /></div>
                    <div className="stat-content">
                        <span className="stat-label">Today's Revenue</span>
                        <span className="stat-value">₹{stats?.today?.revenue?.toFixed(2) || 0}</span>
                    </div>
                </div>
                <div className="stat-card">
                    <div className="stat-icon orders"><FiShoppingBag /></div>
                    <div className="stat-content">
                        <span className="stat-label">Today's Orders</span>
                        <span className="stat-value">{stats?.today?.orders || 0}</span>
                    </div>
                </div>
                <div className="stat-card">
                    <div className="stat-icon month"><FiTrendingUp /></div>
                    <div className="stat-content">
                        <span className="stat-label">This Month</span>
                        <span className="stat-value">₹{stats?.month?.revenue?.toFixed(2) || 0}</span>
                    </div>
                </div>
                <div className="stat-card">
                    <div className="stat-icon pending"><FiAlertCircle /></div>
                    <div className="stat-content">
                        <span className="stat-label">Pending Orders</span>
                        <span className="stat-value">{stats?.pendingOrders || 0}</span>
                    </div>
                </div>
            </div>

            <div className="dashboard-grid">
                {/* Top Spenders */}
                <div className="dashboard-card">
                    <div className="card-header">
                        <h2>Top Spenders (Month)</h2>
                        <Link to="/admin/customers" className="view-all">View All</Link>
                    </div>
                    <div className="customer-list">
                        {userStats?.topCustomers?.length === 0 ? (
                            <p className="no-data">No data available</p>
                        ) : (
                            userStats?.topCustomers?.slice(0, 5).map(customer => (
                                <div key={customer._id} className="customer-item">
                                    <div className="customer-info">
                                        <span className="customer-name">{customer.name}</span>
                                        <span className="customer-orders">{customer.orderCount} orders</span>
                                    </div>
                                    <span className="customer-spent">₹{customer.totalSpent.toFixed(0)}</span>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                {/* Active Orders */}
                <div className="dashboard-card">
                    <div className="card-header">
                        <h2>Active Orders</h2>
                        <Link to="/admin/orders" className="view-all">View All</Link>
                    </div>
                    <div className="orders-list">
                        {activeOrders.length === 0 ? (
                            <p className="no-data">No active orders</p>
                        ) : (
                            activeOrders.slice(0, 5).map(order => (
                                <div key={order._id} className="order-item">
                                    <div className="order-info">
                                        <span className="order-number">#{order.orderNumber}</span>
                                        <span className="order-customer">{order.user?.name || order.user?.phone}</span>
                                    </div>
                                    <span className={`order-status status-${order.status}`}>
                                        {order.status.replace('_', ' ')}
                                    </span>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>

            <div className="dashboard-grid">
                {/* Low Stock */}
                <div className="dashboard-card">
                    <div className="card-header">
                        <h2>Low Stock Alert</h2>
                        <Link to="/admin/inventory" className="view-all">View All</Link>
                    </div>
                    <div className="stock-list">
                        {lowStock.length === 0 ? (
                            <p className="no-data">All stock levels normal</p>
                        ) : (
                            lowStock.slice(0, 5).map(item => (
                                <div key={item._id} className="stock-item">
                                    <span className="stock-name">{item.name}</span>
                                    <span className="stock-qty low">{item.currentStock} {item.unit}</span>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                {/* Quick Settings Link */}
                <div className="dashboard-card">
                    <div className="card-header">
                        <h2>System Quick View</h2>
                        <Link to="/admin/settings" className="view-all">Configure</Link>
                    </div>
                    <div className="gst-content-mini">
                        <div className="gst-status">
                            <span>Current GST Rate:</span>
                            <strong>{gstRate}%</strong>
                        </div>
                        <p className="mini-text">Manage tax rates and restaurant profile in settings.</p>
                        <Link to="/admin/settings" className="btn btn-secondary btn-sm">Open Settings</Link>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default AdminDashboard;
