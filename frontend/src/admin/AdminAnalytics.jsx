import React, { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar, Legend, AreaChart, Area } from 'recharts';
import { getDashboardStats, getRevenueData, getCategorySales, getTopItems, getUserAnalytics, updateSetting, getAllSettings } from '../utils/api';
import { exportToCSV, revenueExportColumns, getFilenameDate } from '../utils/exportUtils';
import { useAuth } from '../context/AuthContext';
import Loader from '../components/Loader';
import { FiUsers, FiUserPlus, FiActivity, FiRepeat, FiSettings, FiDownload } from 'react-icons/fi';
import './AdminAnalytics.css';

const COLORS = ['#C87316', '#E08A2E', '#22C55E', '#3B82F6', '#9333EA', '#EC4899'];

const AdminAnalytics = () => {
    const { socket } = useAuth();
    const [period, setPeriod] = useState('week');
    const [stats, setStats] = useState(null);
    const [revenueData, setRevenueData] = useState([]);
    const [categorySales, setCategorySales] = useState([]);
    const [topItems, setTopItems] = useState([]);
    const [userStats, setUserStats] = useState(null);
    const [margin, setMargin] = useState(30);
    const [showMarginInput, setShowMarginInput] = useState(false);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchData();
    }, [period]);

    useEffect(() => {
        if (socket) {
            socket.on('order-updated', () => fetchData());
            return () => socket.off('order-updated');
        }
    }, [socket]);

    const fetchData = async () => {
        try {
            const [statsRes, revenueRes, catRes, topRes, userRes, settingsRes] = await Promise.all([
                getDashboardStats(),
                getRevenueData(period),
                getCategorySales(period),
                getTopItems(),
                getUserAnalytics(period),
                getAllSettings()
            ]);
            setStats(statsRes.data);
            setRevenueData(revenueRes.data.map(d => ({
                ...d,
                date: new Date(d._id).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
            })));
            setCategorySales(catRes.data);
            setTopItems(topRes.data);
            setUserStats(userRes.data);

            const marginSetting = settingsRes.data.find(s => s.key === 'profit_margin');
            if (marginSetting) setMargin(marginSetting.value);
        } catch (error) {
            console.error('Error:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleUpdateMargin = async () => {
        try {
            await updateSetting('profit_margin', margin);
            setShowMarginInput(false);
            fetchData();
        } catch (error) {
            console.error('Error updating margin:', error);
        }
    };

    const handleExportRevenue = () => {
        const filename = `revenue_${period}_${getFilenameDate()}`;
        exportToCSV(revenueData, revenueExportColumns, filename);
    };

    if (loading) return <Loader message="Crunching the numbers..." />;

    const totalRevenue = revenueData.reduce((sum, d) => sum + d.revenue, 0);
    const totalProfit = revenueData.reduce((sum, d) => sum + d.profit, 0);
    const totalOrders = revenueData.reduce((sum, d) => sum + d.orders, 0);

    return (
        <div className="admin-analytics">
            <div className="page-header">
                <h1>Analytics Dashboard</h1>
                <div className="header-actions">
                    <button className="btn btn-secondary export-btn" onClick={handleExportRevenue}>
                        <FiDownload /> Export CSV
                    </button>
                    <div className="period-selector">
                        {['today', 'week', 'month', 'year'].map(p => (
                            <button
                                key={p}
                                className={`period-btn ${period === p ? 'active' : ''}`}
                                onClick={() => setPeriod(p)}
                            >
                                {p.charAt(0).toUpperCase() + p.slice(1)}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Revenue Summary Cards */}
            <div className="summary-grid">
                <div className="summary-card revenue">
                    <h3>Total Revenue</h3>
                    <p className="value">₹{totalRevenue.toFixed(2)}</p>
                    <span className="label">This {period}</span>
                </div>
                <div className="summary-card profit">
                    <div className="card-header-with-action">
                        <h3>Estimated Profit</h3>
                        <button className="settings-btn" onClick={() => setShowMarginInput(!showMarginInput)}>
                            <FiSettings />
                        </button>
                    </div>
                    <p className="value">₹{totalProfit.toFixed(2)}</p>
                    {showMarginInput ? (
                        <div className="margin-input-group">
                            <input
                                type="number"
                                value={margin}
                                onChange={(e) => setMargin(Number(e.target.value))}
                                className="margin-input"
                                min="0"
                                max="100"
                            />
                            <span>%</span>
                            <button onClick={handleUpdateMargin} className="btn-save-sm">Save</button>
                        </div>
                    ) : (
                        <span className="label">~{margin}% margin</span>
                    )}
                </div>
                <div className="summary-card orders">
                    <h3>Total Orders</h3>
                    <p className="value">{totalOrders}</p>
                    <span className="label">Completed orders</span>
                </div>
                <div className="summary-card avg">
                    <h3>Avg Order Value</h3>
                    <p className="value">₹{totalOrders ? (totalRevenue / totalOrders).toFixed(2) : 0}</p>
                    <span className="label">Per order</span>
                </div>
            </div>

            {/* User Analytics Section */}
            {userStats && (
                <>
                    <h2 className="section-title">👥 User Analytics</h2>
                    <div className="summary-grid user-grid">
                        <div className="summary-card users">
                            <div className="card-icon"><FiUsers /></div>
                            <h3>Total Users</h3>
                            <p className="value">{userStats.totalUsers}</p>
                            <span className="label">Registered customers</span>
                        </div>
                        <div className="summary-card new-users">
                            <div className="card-icon"><FiUserPlus /></div>
                            <h3>New Users</h3>
                            <p className="value">{userStats.newUsers}</p>
                            <span className="label">This {period}</span>
                        </div>
                        <div className="summary-card active">
                            <div className="card-icon"><FiActivity /></div>
                            <h3>Active Users</h3>
                            <p className="value">{userStats.activeUsers}</p>
                            <span className="label">Ordered this {period}</span>
                        </div>
                        <div className="summary-card returning">
                            <div className="card-icon"><FiRepeat /></div>
                            <h3>Returning Customers</h3>
                            <p className="value">{userStats.returningCustomers}</p>
                            <span className="label">Multiple orders</span>
                        </div>
                    </div>

                    <div className="charts-row">
                        {/* User Growth Chart */}
                        <div className="chart-card">
                            <h2>User Registrations</h2>
                            <div className="chart-container">
                                <ResponsiveContainer width="100%" height={250}>
                                    <AreaChart data={userStats.userGrowth}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#E5E5E5" />
                                        <XAxis dataKey="date" stroke="#666" />
                                        <YAxis stroke="#666" />
                                        <Tooltip />
                                        <Area type="monotone" dataKey="users" stroke="#3B82F6" fill="rgba(59, 130, 246, 0.2)" name="New Users" />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </div>
                        </div>

                        {/* Top Customers */}
                        <div className="chart-card">
                            <h2>🏆 Top Customers</h2>
                            <div className="top-customers-list">
                                {userStats.topCustomers.map((customer, index) => (
                                    <div key={index} className="customer-row">
                                        <div className="customer-rank">{index + 1}</div>
                                        <div className="customer-info">
                                            <span className="customer-name">{customer.name || 'Customer'}</span>
                                            <span className="customer-phone">{customer.phone}</span>
                                        </div>
                                        <div className="customer-stats">
                                            <span className="orders-count">{customer.orderCount} orders</span>
                                            <span className="total-spent">₹{customer.totalSpent.toFixed(2)}</span>
                                        </div>
                                    </div>
                                ))}
                                {userStats.topCustomers.length === 0 && (
                                    <p className="no-data">No customer data yet</p>
                                )}
                            </div>
                        </div>
                    </div>
                </>
            )}

            {/* Revenue Chart */}
            <div className="chart-card">
                <h2>Revenue & Profit Trend</h2>
                <div className="chart-container">
                    <ResponsiveContainer width="100%" height={300}>
                        <LineChart data={revenueData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#E5E5E5" />
                            <XAxis dataKey="date" stroke="#666" />
                            <YAxis stroke="#666" />
                            <Tooltip
                                contentStyle={{ background: '#fff', border: '1px solid #E5E5E5', borderRadius: '8px' }}
                            />
                            <Legend />
                            <Line type="monotone" dataKey="revenue" stroke="#C87316" strokeWidth={3} dot={{ fill: '#C87316' }} name="Revenue" />
                            <Line type="monotone" dataKey="profit" stroke="#22C55E" strokeWidth={3} dot={{ fill: '#22C55E' }} name="Profit" />
                        </LineChart>
                    </ResponsiveContainer>
                </div>
            </div>

            <div className="charts-row">
                {/* Category Sales */}
                <div className="chart-card">
                    <h2>Sales by Category</h2>
                    <div className="chart-container">
                        <ResponsiveContainer width="100%" height={250}>
                            <PieChart>
                                <Pie
                                    data={categorySales}
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={60}
                                    outerRadius={100}
                                    paddingAngle={2}
                                    dataKey="total"
                                    nameKey="_id"
                                    label={({ _id, percent }) => `${_id} (${(percent * 100).toFixed(0)}%)`}
                                >
                                    {categorySales.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                    ))}
                                </Pie>
                                <Tooltip formatter={(value) => `₹${value.toFixed(2)}`} />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Top Items */}
                <div className="chart-card">
                    <h2>Top Selling Items</h2>
                    <div className="chart-container">
                        <ResponsiveContainer width="100%" height={250}>
                            <BarChart data={topItems.slice(0, 5)} layout="vertical">
                                <CartesianGrid strokeDasharray="3 3" stroke="#E5E5E5" />
                                <XAxis type="number" stroke="#666" />
                                <YAxis dataKey="name" type="category" width={100} stroke="#666" tick={{ fontSize: 12 }} />
                                <Tooltip />
                                <Bar dataKey="totalQuantity" fill="#C87316" radius={[0, 4, 4, 0]} name="Quantity Sold" />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>

            {/* Orders Table */}
            <div className="chart-card">
                <h2>Daily Breakdown</h2>
                <div className="table-container">
                    <table>
                        <thead>
                            <tr>
                                <th>Date</th>
                                <th>Orders</th>
                                <th>Revenue</th>
                                <th>Profit</th>
                            </tr>
                        </thead>
                        <tbody>
                            {revenueData.map((day, index) => (
                                <tr key={index}>
                                    <td>{day.date}</td>
                                    <td>{day.orders}</td>
                                    <td>₹{day.revenue.toFixed(2)}</td>
                                    <td className="profit-cell">₹{day.profit.toFixed(2)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default AdminAnalytics;

