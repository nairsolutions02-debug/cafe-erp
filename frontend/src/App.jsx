import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { CartProvider } from './context/CartContext';

// User Pages
import Home from './pages/Home';
import LoginModal from './components/LoginModal';
import Menu from './pages/Menu';
import Cart from './pages/Cart';
import OrderDetails from './pages/OrderDetails';
import History from './pages/History';
import Profile from './pages/Profile';
import Rewards from './pages/Rewards';
import AdminAttendance from './admin/staffapp/AdminAttendance';
import AdminAlerts from './admin/staffapp/AdminAlerts';
import MyDay from './admin/staffapp/MyDay';
import AdminRewards from './admin/rewards/AdminRewards';
import AdminProfit from './admin/profit/AdminProfit';
import BottomNav from './components/BottomNav';

// Admin Pages
import AdminLogin from './admin/AdminLogin';
import AdminLayout from './admin/AdminLayout';
import AdminDashboard from './admin/AdminDashboard';
import AdminOrders from './admin/AdminOrders';
import AdminMenu from './admin/AdminMenu';
import AdminCategories from './admin/AdminCategories';
import AdminCoupons from './admin/AdminCoupons';
import AdminInventory from './admin/AdminInventory';
import AdminEmployees from './admin/AdminEmployees';
import AdminAnalytics from './admin/AdminAnalytics';
import AdminTables from './admin/AdminTables';
import AdminCollections from './admin/AdminCollections';
import AdminHistory from './admin/AdminHistory';
import AdminSettings from './admin/AdminSettings';
import AdminLoyalty from './admin/AdminLoyalty';
import AdminCustomers from './admin/AdminCustomers';
import AdminStaff from './admin/AdminStaff';
import AdminCatalogue from './admin/AdminCatalogue';
import AdminAudit from './admin/AdminAudit';
import AdminRecipes from './admin/AdminRecipes';
import AdminPOS from './admin/pos/AdminPOS';
import AdminKitchen from './admin/pos/AdminKitchen';
import AdminShifts from './admin/pos/AdminShifts';
import AdminFinance from './admin/finance/AdminFinance';
import AdminKiosk from './admin/pos/AdminKiosk';
import AdminKhata from './admin/pos/AdminKhata';
import AdminReports from './admin/finance/AdminReports';
import AdminPayroll from './admin/finance/AdminPayroll';
import AdminGate from './admin/AdminGate';
import Superadmin from './superadmin/Superadmin';
import { ADMIN_NAV, firstAllowedPath } from './admin/adminNav';

import './index.css';

// Protected Route for Admin
const AdminRoute = ({ children }) => {
  const { isAdmin, loading } = useAuth();

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="spinner"></div>
      </div>
    );
  }

  return isAdmin ? <AdminGate>{children}</AdminGate> : <Navigate to="/admin/login" />;
};

// Shows a section only to roles that have its permission; otherwise goes to the first allowed one
const RequirePerm = ({ path, children }) => {
  const { hasPerm } = useAuth();
  const perm = ADMIN_NAV.find(n => n.path === path)?.perm;
  if (!perm || hasPerm(perm)) return children;
  const fallback = firstAllowedPath(hasPerm);
  if (fallback && fallback !== path) return <Navigate to={fallback} replace />;
  return <div className="no-access"><h2>No access</h2><p>Your role doesn't include any admin sections yet. Ask the owner to update it.</p></div>;
};

// User Layout with Bottom Nav and Login Modal
const UserLayout = ({ children }) => {
  const { isAuthenticated, isAdmin, isPlatform, loading } = useAuth();

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="spinner"></div>
      </div>
    );
  }

  // An admin session can't place customer orders, so ask for a customer login
  const needsCustomerLogin = !isAuthenticated || isAdmin || isPlatform;

  return (
    <>
      <div className={needsCustomerLogin ? 'page-blurred' : ''}>
        {children}
        <BottomNav />
      </div>
      {needsCustomerLogin && <LoginModal />}
    </>
  );
};

function AppRoutes() {
  return (
    <Routes>
      {/* User Routes - All with Login Modal */}
      <Route path="/" element={<UserLayout><Home /></UserLayout>} />
      <Route path="/menu" element={<UserLayout><Menu /></UserLayout>} />
      <Route path="/categories" element={<UserLayout><Menu /></UserLayout>} />
      <Route path="/cart" element={<UserLayout><Cart /></UserLayout>} />
      <Route path="/order/:id" element={<UserLayout><OrderDetails /></UserLayout>} />
      <Route path="/history" element={<UserLayout><History /></UserLayout>} />
      <Route path="/profile" element={<UserLayout><Profile /></UserLayout>} />
      <Route path="/rewards" element={<UserLayout><Rewards /></UserLayout>} />

      {/* Admin Routes */}
      <Route path="/admin/login" element={<AdminLogin />} />
      <Route path="/admin" element={
        <AdminRoute>
          <AdminLayout />
        </AdminRoute>
      }>
        <Route index element={<RequirePerm path="/admin"><AdminDashboard /></RequirePerm>} />
        <Route path="orders" element={<RequirePerm path="/admin/orders"><AdminOrders /></RequirePerm>} />
        <Route path="menu" element={<RequirePerm path="/admin/menu"><AdminMenu /></RequirePerm>} />
        <Route path="categories" element={<RequirePerm path="/admin/categories"><AdminCategories /></RequirePerm>} />
        <Route path="catalogue" element={<RequirePerm path="/admin/catalogue"><AdminCatalogue /></RequirePerm>} />
        <Route path="collections" element={<RequirePerm path="/admin/collections"><AdminCollections /></RequirePerm>} />
        <Route path="coupons" element={<RequirePerm path="/admin/coupons"><AdminCoupons /></RequirePerm>} />
        <Route path="inventory" element={<RequirePerm path="/admin/inventory"><AdminInventory /></RequirePerm>} />
        <Route path="recipes" element={<RequirePerm path="/admin/recipes"><AdminRecipes /></RequirePerm>} />
        <Route path="pos" element={<RequirePerm path="/admin/pos"><AdminPOS /></RequirePerm>} />
        <Route path="kitchen" element={<RequirePerm path="/admin/kitchen"><AdminKitchen /></RequirePerm>} />
        <Route path="shifts" element={<RequirePerm path="/admin/shifts"><AdminShifts /></RequirePerm>} />
        <Route path="finance" element={<RequirePerm path="/admin/finance"><AdminFinance /></RequirePerm>} />
        <Route path="kiosk" element={<RequirePerm path="/admin/kiosk"><AdminKiosk /></RequirePerm>} />
        <Route path="khata" element={<RequirePerm path="/admin/khata"><AdminKhata /></RequirePerm>} />
        <Route path="reports" element={<RequirePerm path="/admin/reports"><AdminReports /></RequirePerm>} />
        <Route path="payroll" element={<RequirePerm path="/admin/payroll"><AdminPayroll /></RequirePerm>} />
        <Route path="employees" element={<RequirePerm path="/admin/employees"><AdminEmployees /></RequirePerm>} />
        <Route path="tables" element={<RequirePerm path="/admin/tables"><AdminTables /></RequirePerm>} />
        <Route path="analytics" element={<RequirePerm path="/admin/analytics"><AdminAnalytics /></RequirePerm>} />
        <Route path="history" element={<RequirePerm path="/admin/history"><AdminHistory /></RequirePerm>} />
        <Route path="settings" element={<RequirePerm path="/admin/settings"><AdminSettings /></RequirePerm>} />
        <Route path="loyalty" element={<RequirePerm path="/admin/loyalty"><AdminLoyalty /></RequirePerm>} />
        <Route path="customers" element={<RequirePerm path="/admin/customers"><AdminCustomers /></RequirePerm>} />
        <Route path="staff" element={<RequirePerm path="/admin/staff"><AdminStaff /></RequirePerm>} />
        <Route path="attendance" element={<RequirePerm path="/admin/attendance"><AdminAttendance /></RequirePerm>} />
        <Route path="alerts" element={<RequirePerm path="/admin/alerts"><AdminAlerts /></RequirePerm>} />
        <Route path="me" element={<MyDay />} />
        <Route path="profit" element={<RequirePerm path="/admin/profit"><AdminProfit /></RequirePerm>} />
        <Route path="rewards" element={<RequirePerm path="/admin/rewards"><AdminRewards /></RequirePerm>} />
        <Route path="audit" element={<RequirePerm path="/admin/audit"><AdminAudit /></RequirePerm>} />
      </Route>

      {/* Platform (N.A.I.R. Solutions) console */}
      <Route path="/superadmin" element={<Superadmin />} />

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <CartProvider>
          <AppRoutes />
        </CartProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;

