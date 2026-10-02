import axios from 'axios';

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';
const API_URL = `${BASE_URL}/api`;

// Add auth token to all requests
axios.interceptors.request.use(
    (config) => {
        const token = localStorage.getItem('token');
        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
    },
    (error) => Promise.reject(error)
);

// Categories
export const getCategories = () => axios.get(`${API_URL}/categories`);
export const getAllCategories = () => axios.get(`${API_URL}/categories/all`);
export const createCategory = (data) => axios.post(`${API_URL}/categories`, data);
export const updateCategory = (id, data) => axios.put(`${API_URL}/categories/${id}`, data);
export const deleteCategory = (id) => axios.delete(`${API_URL}/categories/${id}`);

// Menu Items
export const getMenuItems = (params) => axios.get(`${API_URL}/menu`, { params });
export const getAllMenuItems = () => axios.get(`${API_URL}/menu/all`);
export const getBestsellers = () => axios.get(`${API_URL}/menu/bestsellers`);
export const getNewItems = () => axios.get(`${API_URL}/menu/new`);
export const getRecommended = () => axios.get(`${API_URL}/menu/recommended`);
export const createMenuItem = (data) => axios.post(`${API_URL}/menu`, data);
export const updateMenuItem = (id, data) => axios.put(`${API_URL}/menu/${id}`, data);
export const updateStock = (id, data) => axios.put(`${API_URL}/menu/${id}/stock`, data);
export const deleteMenuItem = (id) => axios.delete(`${API_URL}/menu/${id}`);

// Orders
export const getMyOrders = () => axios.get(`${API_URL}/orders`);
export const getCurrentOrder = () => axios.get(`${API_URL}/orders/current`);
export const getAllOrders = (params) => axios.get(`${API_URL}/orders/all`, { params });
export const getActiveOrders = () => axios.get(`${API_URL}/orders/active`);
export const getOrder = (id) => axios.get(`${API_URL}/orders/${id}`);
export const createOrder = (data) => axios.post(`${API_URL}/orders`, data);
export const updateOrderStatus = (id, status) => axios.put(`${API_URL}/orders/${id}/status`, { status });
export const requestBill = (id) => axios.put(`${API_URL}/orders/${id}/request-bill`);
export const updatePayment = (id, paymentMethod, amountPaid) => axios.put(`${API_URL}/orders/${id}/payment`, { paymentMethod, amountPaid });

// Coupons
export const getCoupons = () => axios.get(`${API_URL}/coupons`);
export const getAllCoupons = () => axios.get(`${API_URL}/coupons/all`);
export const validateCoupon = (code, orderTotal) => axios.post(`${API_URL}/coupons/validate`, { code, orderTotal });
export const createCoupon = (data) => axios.post(`${API_URL}/coupons`, data);
export const updateCoupon = (id, data) => axios.put(`${API_URL}/coupons/${id}`, data);
export const deleteCoupon = (id) => axios.delete(`${API_URL}/coupons/${id}`);

// Inventory
export const getInventory = (params) => axios.get(`${API_URL}/inventory`, { params });
export const getLowStock = () => axios.get(`${API_URL}/inventory/low-stock`);
export const createInventoryItem = (data) => axios.post(`${API_URL}/inventory`, data);
export const updateInventoryItem = (id, data) => axios.put(`${API_URL}/inventory/${id}`, data);
export const restockItem = (id, quantity) => axios.put(`${API_URL}/inventory/${id}/restock`, { quantity });
export const deleteInventoryItem = (id) => axios.delete(`${API_URL}/inventory/${id}`);

// Employees
export const getEmployees = (params) => axios.get(`${API_URL}/employees`, { params });
export const getEmployee = (id) => axios.get(`${API_URL}/employees/${id}`);
export const createEmployee = (data) => axios.post(`${API_URL}/employees`, data);
export const updateEmployee = (id, data) => axios.put(`${API_URL}/employees/${id}`, data);
export const deleteEmployee = (id) => axios.delete(`${API_URL}/employees/${id}`);
export const getEmployeeAttendance = (id, params) => axios.get(`${API_URL}/employees/${id}/attendance`, { params });
export const markAttendance = (id, data) => axios.post(`${API_URL}/employees/${id}/attendance`, data);
export const getHolidays = () => axios.get(`${API_URL}/employees/holidays/list`);
export const addHoliday = (data) => axios.post(`${API_URL}/employees/holidays`, data);
export const deleteHoliday = (id) => axios.delete(`${API_URL}/employees/holidays/${id}`);

// Analytics
export const getDashboardStats = () => axios.get(`${API_URL}/analytics/dashboard`);
export const getRevenueData = (period) => axios.get(`${API_URL}/analytics/revenue`, { params: { period } });
export const getCategorySales = (period) => axios.get(`${API_URL}/analytics/category-sales`, { params: { period } });
export const getTopItems = () => axios.get(`${API_URL}/analytics/top-items`);
export const getUserAnalytics = (period) => axios.get(`${API_URL}/analytics/users`, { params: { period } });

// Tables
export const getTables = () => axios.get(`${API_URL}/tables`);
export const getAvailableTables = () => axios.get(`${API_URL}/tables/available`);
export const createTable = (data) => axios.post(`${API_URL}/tables`, data);
export const createBulkTables = (data) => axios.post(`${API_URL}/tables/bulk`, data);
export const updateTable = (id, data) => axios.put(`${API_URL}/tables/${id}`, data);
export const deleteTable = (id) => axios.delete(`${API_URL}/tables/${id}`);

// Settings
export const getSettings = () => axios.get(`${API_URL}/settings`);
export const getAllSettings = () => axios.get(`${API_URL}/settings`); // Alias for getSettings
export const getGstRate = () => axios.get(`${API_URL}/settings/gst`);
export const updateGstRate = (gstRate) => axios.put(`${API_URL}/settings/gst`, { gstRate });
export const updateSetting = (key, value) => axios.put(`${API_URL}/settings/${key}`, { value });

// Collections (Custom Homepage Sections)
export const getCollections = (homepage = false) => axios.get(`${API_URL}/collections`, { params: { homepage: homepage ? 'true' : undefined } });
export const getCollection = (slug) => axios.get(`${API_URL}/collections/${slug}`);
export const getAdminCollections = () => axios.get(`${API_URL}/collections/admin/all`);
export const createCollection = (data) => axios.post(`${API_URL}/collections`, data);
export const updateCollection = (id, data) => axios.put(`${API_URL}/collections/${id}`, data);
export const deleteCollection = (id) => axios.delete(`${API_URL}/collections/${id}`);
export const addProductToCollection = (collectionId, productId) => axios.post(`${API_URL}/collections/${collectionId}/products`, { productId });
export const removeProductFromCollection = (collectionId, productId) => axios.delete(`${API_URL}/collections/${collectionId}/products/${productId}`);

// Loyalty Points
export const getLoyaltySettings = () => axios.get(`${API_URL}/loyalty/settings`);
export const updateLoyaltySettings = (data) => axios.put(`${API_URL}/loyalty/settings`, data);
export const getMyLoyaltyPoints = () => axios.get(`${API_URL}/loyalty/my-points`);
export const calculateRedemption = (orderTotal, pointsToUse) => axios.post(`${API_URL}/loyalty/calculate-redemption`, { orderTotal, pointsToUse });
export const getLoyaltyUsers = () => axios.get(`${API_URL}/loyalty/all-users`);
export const adjustUserPoints = (userId, points, reason) => axios.put(`${API_URL}/loyalty/adjust-points/${userId}`, { points, reason });
export const setProductBonusPoints = (productId, bonusLoyaltyPoints) => axios.put(`${API_URL}/loyalty/product/${productId}`, { bonusLoyaltyPoints });
export const getLoyaltyOffers = () => axios.get(`${API_URL}/loyalty/offers`);
export const createLoyaltyOffer = (data) => axios.post(`${API_URL}/loyalty/offers`, data);
export const updateLoyaltyOffer = (id, data) => axios.put(`${API_URL}/loyalty/offers/${id}`, data);
export const deleteLoyaltyOffer = (id) => axios.delete(`${API_URL}/loyalty/offers/${id}`);

// Customer Analytics
export const getCustomerAnalytics = (params) => axios.get(`${API_URL}/analytics/customers`, { params });
export const getCustomerDetail = (id) => axios.get(`${API_URL}/analytics/customer/${id}`);
export const searchOrders = (params) => axios.get(`${API_URL}/analytics/orders/search`, { params });

