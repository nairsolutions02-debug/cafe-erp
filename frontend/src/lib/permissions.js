// Permission catalogue shown in the role grid. Keys must match the database
// ('<module>.<action>' and 'sensitive.<switch>').
export const MODULES = [
    { key: 'orders', label: 'Orders & billing' },
    { key: 'menu', label: 'Menu & catalogue' },
    { key: 'collections', label: 'Homepage sections' },
    { key: 'tables', label: 'Tables' },
    { key: 'coupons', label: 'Coupons' },
    { key: 'rewards', label: 'Loyalty & rewards' },
    { key: 'customers', label: 'Customers' },
    { key: 'inventory', label: 'Inventory' },
    { key: 'employees', label: 'Employees & attendance' },
    { key: 'finance', label: 'Finance: money, expenses, payables' },
    { key: 'reports', label: 'Dashboard & reports' },
    { key: 'settings', label: 'Settings' },
    { key: 'staff', label: 'Staff, roles & PINs' },
    { key: 'audit', label: 'Audit log' },
];

export const ACTIONS = [
    { key: 'view', label: 'View' },
    { key: 'create', label: 'Create' },
    { key: 'edit', label: 'Edit' },
    { key: 'delete', label: 'Delete' },
];

// Modules where only some actions mean anything
export const MODULE_ACTIONS = {
    reports: ['view'],
    audit: ['view'],
    settings: ['view', 'edit'],
};

export const SENSITIVE = [
    { key: 'sensitive.see_cost', label: 'See cost prices' },
    { key: 'sensitive.see_profit', label: 'See profit' },
    { key: 'sensitive.see_salary', label: 'See salaries' },
    { key: 'sensitive.see_customer_phone', label: 'See customer phone numbers' },
    { key: 'sensitive.give_discount', label: 'Give discounts' },
    { key: 'sensitive.void_bill', label: 'Cancel / void orders' },
    { key: 'sensitive.approve_credit', label: 'Approve khata over the limit' },
];

export const can = (permissions, perm) =>
    Array.isArray(permissions) && (permissions.includes('*') || permissions.includes(perm));
