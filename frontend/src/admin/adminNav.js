import {
    FiHome, FiGrid, FiShoppingBag, FiTag, FiPackage, FiUsers, FiBarChart2, FiLayout, FiActivity,
    FiSettings, FiShield, FiLayers, FiFileText, FiBookOpen, FiMonitor, FiCoffee, FiDollarSign, FiBriefcase, FiZap, FiBook, FiPieChart, FiCreditCard,
} from 'react-icons/fi';

// Admin sections and the permission each needs (sidebar + route guards)
export const ADMIN_NAV = [
    { path: '/admin', icon: FiHome, label: 'Dashboard', perm: 'reports.view', exact: true },
    { path: '/admin/pos', icon: FiMonitor, label: 'Counter', perm: 'orders.create' },
    { path: '/admin/kiosk', icon: FiZap, label: 'Kiosk', perm: 'orders.create' },
    { path: '/admin/orders', icon: FiShoppingBag, label: 'Orders', perm: 'orders.view' },
    { path: '/admin/kitchen', icon: FiCoffee, label: 'Kitchen', perm: 'orders.view' },
    { path: '/admin/shifts', icon: FiBriefcase, label: 'Cash & Shifts', perm: 'orders.edit' },
    { path: '/admin/history', icon: FiActivity, label: 'History', perm: 'orders.view' },
    { path: '/admin/menu', icon: FiGrid, label: 'Menu', perm: 'menu.view' },
    { path: '/admin/categories', icon: FiGrid, label: 'Categories', perm: 'menu.view' },
    { path: '/admin/catalogue', icon: FiLayers, label: 'Brands & Taxes', perm: 'menu.view' },
    { path: '/admin/collections', icon: FiLayout, label: 'Homepage Sections', perm: 'collections.view' },
    { path: '/admin/tables', icon: FiLayout, label: 'Tables', perm: 'tables.view' },
    { path: '/admin/coupons', icon: FiTag, label: 'Coupons', perm: 'coupons.view' },
    { path: '/admin/loyalty', icon: FiTag, label: 'Loyalty Points', perm: 'rewards.view' },
    { path: '/admin/inventory', icon: FiPackage, label: 'Inventory', perm: 'inventory.view' },
    { path: '/admin/recipes', icon: FiBookOpen, label: 'Recipes & Costing', perm: 'inventory.view' },
    { path: '/admin/employees', icon: FiUsers, label: 'Employees', perm: 'employees.view' },
    { path: '/admin/payroll', icon: FiCreditCard, label: 'Payroll', perm: 'employees.view' },
    { path: '/admin/customers', icon: FiUsers, label: 'Customers', perm: 'customers.view' },
    { path: '/admin/khata', icon: FiBook, label: 'Khata', perm: 'customers.view' },
    { path: '/admin/finance', icon: FiDollarSign, label: 'Finance', perm: 'finance.view' },
    { path: '/admin/reports', icon: FiPieChart, label: 'Reports', perm: 'finance.view' },
    { path: '/admin/analytics', icon: FiBarChart2, label: 'Analytics', perm: 'reports.view' },
    { path: '/admin/staff', icon: FiShield, label: 'Staff & Roles', perm: 'staff.view' },
    { path: '/admin/audit', icon: FiFileText, label: 'Audit Log', perm: 'audit.view' },
    { path: '/admin/settings', icon: FiSettings, label: 'Settings', perm: 'settings.view' },
];

export const firstAllowedPath = (hasPerm) => ADMIN_NAV.find(n => hasPerm(n.perm))?.path || null;
