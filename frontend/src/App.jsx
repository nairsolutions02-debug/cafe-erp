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

  return isAdmin ? children : <Navigate to="/admin/login" />;
};

// User Layout with Bottom Nav and Login Modal
const UserLayout = ({ children }) => {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="spinner"></div>
      </div>
    );
  }

  return (
    <>
      <div className={!isAuthenticated ? 'page-blurred' : ''}>
        {children}
        <BottomNav />
      </div>
      {!isAuthenticated && <LoginModal />}
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

      {/* Admin Routes */}
      <Route path="/admin/login" element={<AdminLogin />} />
      <Route path="/admin" element={
        <AdminRoute>
          <AdminLayout />
        </AdminRoute>
      }>
        <Route index element={<AdminDashboard />} />
        <Route path="orders" element={<AdminOrders />} />
        <Route path="menu" element={<AdminMenu />} />
        <Route path="categories" element={<AdminCategories />} />
        <Route path="collections" element={<AdminCollections />} />
        <Route path="coupons" element={<AdminCoupons />} />
        <Route path="inventory" element={<AdminInventory />} />
        <Route path="employees" element={<AdminEmployees />} />
        <Route path="tables" element={<AdminTables />} />
        <Route path="analytics" element={<AdminAnalytics />} />
        <Route path="history" element={<AdminHistory />} />
        <Route path="settings" element={<AdminSettings />} />
        <Route path="loyalty" element={<AdminLoyalty />} />
        <Route path="customers" element={<AdminCustomers />} />
      </Route>

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

