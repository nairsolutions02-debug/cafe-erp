import {
    FiHome, FiGrid, FiShoppingBag, FiTag, FiPackage, FiUsers, FiBarChart2, FiLayout, FiActivity,
    FiSettings, FiShield, FiLayers, FiFileText, FiBookOpen, FiMonitor, FiCoffee, FiDollarSign, FiBriefcase, FiZap, FiBook,
    FiPieChart, FiSmartphone, FiTv, FiAward, FiCreditCard, FiClock, FiBell, FiSun, FiGift, FiTrendingUp, FiList, FiStar, FiUserCheck,
} from 'react-icons/fi';

// Menu labels in English, Hindi and Hinglish: [en, hi, hinglish]
export const LANGS = [
    { key: 'en', label: 'English' },
    { key: 'hi', label: 'हिन्दी' },
    { key: 'hinglish', label: 'Hinglish' },
];
const L = (en, hi, hinglish) => ({ en, hi, hinglish });
export const tr = (label, lang) => (label && typeof label === 'object' ? (label[lang] || label.en) : label);

// The admin menu: 8 sections, each with its pages. `perm` = permission needed to see the page.
// Pages marked `tab` don't get their own line in the sidebar; they show as a tab next to their parent page.
export const NAV_SECTIONS = [
    {
        key: 'home', icon: FiHome, label: L('Home', 'होम', 'Home'),
        items: [
            { path: '/admin', icon: FiHome, label: L('Dashboard', 'डैशबोर्ड', 'Dashboard'), perm: 'reports.view', exact: true },
            { path: '/admin/me', icon: FiSun, label: L('My day', 'मेरा दिन', 'Mera din') },
        ],
    },
    {
        key: 'sell', icon: FiShoppingBag, label: L('Sell', 'बिक्री', 'Bikri'),
        items: [
            { path: '/admin/pos', icon: FiMonitor, label: L('Counter', 'काउंटर', 'Counter'), perm: 'orders.create' },
            { path: '/admin/kiosk', icon: FiZap, label: L('Kiosk', 'कियोस्क', 'Kiosk'), perm: 'orders.create' },
            { path: '/admin/orders', icon: FiShoppingBag, label: L('Orders', 'ऑर्डर', 'Order'), perm: 'orders.view' },
            { path: '/admin/history', icon: FiActivity, label: L('Order history', 'पुराने ऑर्डर', 'Purane order'), perm: 'orders.view', tab: true },
            { path: '/admin/kitchen', icon: FiCoffee, label: L('Kitchen', 'रसोई', 'Kitchen'), perm: 'orders.view' },
            { path: '/admin/pickup-screen', icon: FiTv, label: L('Pickup screen', 'पिकअप स्क्रीन', 'Pickup screen'), perm: 'orders.view' },
            { path: '/admin/tables', icon: FiLayout, label: L('Tables', 'टेबल', 'Table'), perm: 'tables.view' },
        ],
    },
    {
        key: 'menu', icon: FiGrid, label: L('Menu', 'मेन्यू', 'Menu'),
        items: [
            { path: '/admin/menu', icon: FiGrid, label: L('Items', 'आइटम', 'Items'), perm: 'menu.view' },
            { path: '/admin/categories', icon: FiList, label: L('Categories', 'श्रेणियाँ', 'Category'), perm: 'menu.view' },
            { path: '/admin/recipes', icon: FiBookOpen, label: L('Recipes & Costing', 'रेसिपी और लागत', 'Recipe aur laagat'), perm: 'inventory.view' },
            { path: '/admin/catalogue', icon: FiLayers, label: L('Brands & Taxes', 'ब्रांड और टैक्स', 'Brand aur tax'), perm: 'menu.view' },
            { path: '/admin/collections', icon: FiLayout, label: L('Homepage Sections', 'होमपेज सेक्शन', 'Homepage section'), perm: 'collections.view' },
            { path: '/admin/customer-app', icon: FiSmartphone, label: L('Customer app', 'ग्राहक ऐप', 'Customer app'), perm: 'settings.view' },
        ],
    },
    {
        key: 'stock', icon: FiPackage, label: L('Stock', 'स्टॉक', 'Stock'),
        items: [
            { path: '/admin/inventory', icon: FiPackage, label: L('Inventory', 'इन्वेंटरी', 'Maal / Inventory'), perm: 'inventory.view' },
        ],
    },
    {
        key: 'customers', icon: FiUsers, label: L('Customers', 'ग्राहक', 'Grahak'),
        items: [
            { path: '/admin/customers', icon: FiUsers, label: L('Customers', 'ग्राहक', 'Grahak'), perm: 'customers.view' },
            { path: '/admin/khata', icon: FiBook, label: L('Khata', 'खाता', 'Khata'), perm: 'customers.view' },
            { path: '/admin/club', icon: FiAward, label: L('FiKA Club', 'फ़ीका क्लब', 'FiKA Club'), perm: 'customers.view' },
            { path: '/admin/rewards', icon: FiGift, label: L('Rewards', 'इनाम', 'Inaam'), perm: 'customers.view' },
            { path: '/admin/loyalty', icon: FiStar, label: L('Points', 'पॉइंट्स', 'Points'), perm: 'rewards.view', tab: true },
            { path: '/admin/coupons', icon: FiTag, label: L('Coupons', 'कूपन', 'Coupon'), perm: 'coupons.view' },
        ],
    },
    {
        key: 'money', icon: FiDollarSign, label: L('Money', 'हिसाब', 'Hisaab'),
        items: [
            { path: '/admin/shifts', icon: FiBriefcase, label: L('Cash & Shifts', 'कैश और शिफ्ट', 'Cash aur shift'), perm: 'orders.edit' },
            { path: '/admin/finance', icon: FiDollarSign, label: L('Finance', 'लेन-देन', 'Len-den'), perm: 'finance.view' },
            { path: '/admin/reports', icon: FiPieChart, label: L('Reports', 'रिपोर्ट', 'Report'), perm: 'finance.view' },
            { path: '/admin/analytics', icon: FiBarChart2, label: L('Sales trends', 'बिक्री रुझान', 'Bikri trend'), perm: 'reports.view', tab: true },
            { path: '/admin/profit', icon: FiTrendingUp, label: L('Profit advisor', 'मुनाफ़ा सलाहकार', 'Munafa salah'), perm: 'finance.view' },
        ],
    },
    {
        key: 'team', icon: FiUserCheck, label: L('Team', 'टीम', 'Team'),
        items: [
            { path: '/admin/employees', icon: FiUsers, label: L('Employees', 'कर्मचारी', 'Karmchari'), perm: 'employees.view' },
            { path: '/admin/attendance', icon: FiClock, label: L('Attendance', 'हाज़िरी', 'Haaziri'), perm: 'employees.view' },
            { path: '/admin/payroll', icon: FiCreditCard, label: L('Payroll', 'वेतन', 'Tankhwah'), perm: 'employees.view' },
            { path: '/admin/staff', icon: FiShield, label: L('Staff logins & Roles', 'स्टाफ लॉगिन और रोल', 'Staff login aur role'), perm: 'staff.view' },
        ],
    },
    {
        key: 'settings', icon: FiSettings, label: L('Settings', 'सेटिंग्स', 'Settings'),
        items: [
            { path: '/admin/settings', icon: FiSettings, label: L('Cafe settings', 'कैफ़े सेटिंग्स', 'Cafe settings'), perm: 'settings.view' },
            { path: '/admin/alerts', icon: FiBell, label: L('Alerts', 'अलर्ट', 'Alert'), perm: 'staff.view' },
            { path: '/admin/audit', icon: FiFileText, label: L('Audit log', 'ऑडिट लॉग', 'Audit log'), perm: 'audit.view' },
            { path: '/admin/help', icon: FiBookOpen, label: L('Help & support', 'मदद और सपोर्ट', 'Help aur support') },
        ],
    },
];

// The phone quick bar: the four screens staff use all day
export const QUICK_BAR = ['/admin/pos', '/admin/orders', '/admin/kitchen', '/admin/me'];

// Flat list of every page (route guards, global search). `label` stays the English name.
export const ADMIN_NAV = NAV_SECTIONS.flatMap(s => s.items.map(i => ({ ...i, section: s.key, labels: i.label, label: i.label.en })));

export const navItem = (path) => ADMIN_NAV.find(n => n.path === path);

// The section a URL belongs to (longest matching page path wins)
export const sectionFor = (pathname) => {
    let best = null;
    for (const s of NAV_SECTIONS) {
        for (const i of s.items) {
            const hit = i.exact ? pathname === i.path : pathname === i.path || pathname.startsWith(i.path + '/');
            if (hit && (!best || i.path.length > best.item.path.length)) best = { section: s, item: i };
        }
    }
    return best;
};

// Where to land after login: the first page the role allows (pages needing no permission, like My day, come last)
export const firstAllowedPath = (hasPerm) =>
    ADMIN_NAV.find(n => n.perm && hasPerm(n.perm))?.path || ADMIN_NAV.find(n => !n.perm)?.path || null;
