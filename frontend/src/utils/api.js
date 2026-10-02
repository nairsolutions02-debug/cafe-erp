// Data layer backed by Supabase. Every function keeps the name and response
// shape of the old Express API ({ data }, `_id`, camelCase fields, populated
// relations), so the pages did not need to change.
import { supabase } from '../lib/supabase';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const apiError = (message, status = 400) => {
    const err = new Error(message);
    err.response = { status, data: { message } };
    return err;
};

const DUPLICATE_MESSAGES = {
    categories: 'Category already exists',
    coupons: 'Coupon code already exists',
    dining_tables: 'Table number already exists',
    holidays: 'Holiday exists',
    vendors: 'A vendor with this name already exists',
};

const unwrap = ({ data, error }, table) => {
    if (error) {
        if (error.code === '23505') throw apiError(DUPLICATE_MESSAGES[table] || 'Already exists');
        if (error.code === 'PGRST116') throw apiError('Not found', 404);
        throw apiError(error.message);
    }
    return data;
};

const ok = (data) => ({ data });

// The signed-in staff member's cafe (set by AuthContext); used where an update needs a row filter
let sessionTenantId = null;
export const setSessionTenant = (id) => { sessionTenantId = id || null; };

const rpc = async (fn, args = {}) => unwrap(await supabase.rpc(fn, args));

const camel = (s) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());

// Database row -> client object (camelCase + `_id`)
const RENAMES = { sort_order: 'order', category_id: 'category', employee_id: 'employee', current_order_id: 'currentOrder' };
const toClient = (row) => {
    if (!row || typeof row !== 'object') return row;
    const out = {};
    for (const [key, value] of Object.entries(row)) {
        out[RENAMES[key] || camel(key)] = value;
    }
    if (row.id !== undefined) out._id = row.id;
    return out;
};
const listToClient = (rows) => (rows || []).map(toClient);

// Field specs for writes: client name -> [column, type]
const conv = {
    text: (v) => (v == null ? undefined : String(v)),
    num: (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? undefined : Number(v)),
    numOrNull: (v) => (v === '' || v == null ? null : Number(v)),
    int: (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? undefined : Math.trunc(Number(v))),
    bool: (v) => (v === undefined || v === '' ? undefined : v === true || v === 'true'),
    uuid: (v) => (v === '' || v == null ? null : v),
    list: (v) => (typeof v === 'string' ? (v ? JSON.parse(v) : []) : v || []),
    date: (v) => (v === '' || v == null ? undefined : v),
};

const toDb = (input, spec) => {
    const source = input instanceof FormData ? Object.fromEntries(input.entries()) : input || {};
    const out = {};
    for (const [field, [column, type]] of Object.entries(spec)) {
        if (!(field in source)) continue;
        const value = conv[type](source[field]);
        if (value !== undefined) out[column] = value;
    }
    return out;
};

const imageFrom = (input) => (input instanceof FormData ? input.get('image') : null);

// Resize to max 1200px WebP before upload to keep storage small
const shrinkImage = (file) => new Promise((resolve) => {
    if (!file.type.startsWith('image/') || file.type === 'image/gif') return resolve(file);
    const img = new Image();
    img.onload = () => {
        const scale = Math.min(1, 1200 / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => resolve(blob || file), 'image/webp', 0.82);
        URL.revokeObjectURL(img.src);
    };
    img.onerror = () => resolve(file);
    img.src = URL.createObjectURL(file);
});

const uploadImage = async (file, folder) => {
    if (!file || !(file instanceof Blob) || file.size === 0) return undefined;
    const body = await shrinkImage(file);
    const ext = body.type === 'image/webp' ? 'webp' : (file.name?.split('.').pop() || 'jpg');
    const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    unwrap(await supabase.storage.from('images').upload(path, body, { contentType: body.type, upsert: false }));
    return supabase.storage.from('images').getPublicUrl(path).data.publicUrl;
};

// Strip characters that would break PostgREST's or() filter syntax
const searchTerm = (s) => String(s || '').replace(/[,()*%\\]/g, ' ').trim();

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------
const CATEGORY = {
    name: ['name', 'text'], description: ['description', 'text'], order: ['sort_order', 'int'],
    isActive: ['is_active', 'bool'], parentId: ['parent_id', 'uuid'], stockLocationId: ['stock_location_id', 'uuid'],
};

// Customer menu shows top-level categories; sub-categories' items appear under their parent
export const getCategories = async () =>
    ok(listToClient(unwrap(await supabase.from('categories').select().eq('is_active', true).is('parent_id', null).order('sort_order'))));
export const getAllCategories = async () =>
    ok(listToClient(unwrap(await supabase.from('categories').select().order('sort_order'))));
export const createCategory = async (data) => {
    const row = toDb(data, CATEGORY);
    const image = await uploadImage(imageFrom(data), 'categories');
    if (image) row.image = image;
    return ok(toClient(unwrap(await supabase.from('categories').insert(row).select().single(), 'categories')));
};
export const updateCategory = async (id, data) => {
    const row = toDb(data, CATEGORY);
    const image = await uploadImage(imageFrom(data), 'categories');
    if (image) row.image = image;
    return ok(toClient(unwrap(await supabase.from('categories').update(row).eq('id', id).select().single(), 'categories')));
};
export const deleteCategory = async (id) => {
    unwrap(await supabase.from('categories').delete().eq('id', id));
    return ok({ message: 'Category deleted' });
};

// ---------------------------------------------------------------------------
// Menu items
// ---------------------------------------------------------------------------
const MENU_SELECT = '*, category:categories(id, name, parent_id), brand:brands(id, name)';
const MENU = {
    name: ['name', 'text'], description: ['description', 'text'], price: ['price', 'num'],
    category: ['category_id', 'uuid'], isVeg: ['is_veg', 'bool'], isAvailable: ['is_available', 'bool'],
    isBestSeller: ['is_best_seller', 'bool'], isNewItem: ['is_new_item', 'bool'],
    isRecommended: ['is_recommended', 'bool'], isUpsell: ['is_upsell', 'bool'], tags: ['tags', 'list'],
    preparationTime: ['preparation_time', 'int'], stockQuantity: ['stock_quantity', 'int'],
    bonusLoyaltyPoints: ['bonus_loyalty_points', 'int'], initialStock: ['initial_stock', 'int'],
    lowStockThreshold: ['low_stock_threshold', 'int'], costPrice: ['cost_price', 'num'],
    brand: ['brand_id', 'uuid'], itemType: ['item_type', 'text'], unit: ['unit', 'text'], mrp: ['mrp', 'numOrNull'],
    priceIncludesTax: ['price_includes_tax', 'bool'], taxGroup: ['tax_group_id', 'uuid'],
    isRestricted: ['is_restricted', 'bool'], sku: ['sku', 'text'],
};

const menuToClient = (row) => {
    const item = toClient(row);
    if (row.category && typeof row.category === 'object') item.category = { _id: row.category.id, name: row.category.name, parentId: row.category.parent_id };
    else item.category = row.category_id;
    item.brand = row.brand && typeof row.brand === 'object' ? { _id: row.brand.id, name: row.brand.name } : null;
    item.taxGroup = row.tax_group_id;
    return item;
};
const menuList = (rows) => (rows || []).map(menuToClient);

export const getMenuItems = async (params = {}) => {
    let q = supabase.from('menu_items').select(MENU_SELECT).eq('is_available', true).order('name');
    if (params.category) {
        const children = unwrap(await supabase.from('categories').select('id').eq('parent_id', params.category));
        q = q.in('category_id', [params.category, ...children.map(c => c.id)]);
    }
    if (params.bestseller === 'true') q = q.eq('is_best_seller', true);
    if (params.isNew === 'true') q = q.eq('is_new_item', true);
    if (params.recommended === 'true') q = q.eq('is_recommended', true);
    const term = searchTerm(params.search);
    if (term) q = q.or(`name.ilike.%${term}%,description.ilike.%${term}%`);
    return ok(menuList(unwrap(await q)));
};
export const getAllMenuItems = async () =>
    ok(menuList(unwrap(await supabase.from('menu_items').select(MENU_SELECT).order('name'))));
export const getBestsellers = async () =>
    ok(menuList(unwrap(await supabase.from('menu_items').select(MENU_SELECT).eq('is_best_seller', true).eq('is_available', true).limit(10))));
export const getNewItems = async () =>
    ok(menuList(unwrap(await supabase.from('menu_items').select(MENU_SELECT).eq('is_new_item', true).eq('is_available', true).limit(10))));
export const getRecommended = async () =>
    ok(menuList(unwrap(await supabase.from('menu_items').select(MENU_SELECT).eq('is_recommended', true).eq('is_available', true))));

export const createMenuItem = async (data) => {
    const row = toDb(data, MENU);
    if (!row.stock_quantity) row.stock_quantity = -1;
    const image = await uploadImage(imageFrom(data), 'menu');
    if (image) row.image = image;
    return ok(menuToClient(unwrap(await supabase.from('menu_items').insert(row).select(MENU_SELECT).single())));
};
export const updateMenuItem = async (id, data) => {
    const row = toDb(data, MENU);
    const image = await uploadImage(imageFrom(data), 'menu');
    if (image) row.image = image;
    return ok(menuToClient(unwrap(await supabase.from('menu_items').update(row).eq('id', id).select(MENU_SELECT).single())));
};
export const updateStock = async (id, data) => {
    const row = toDb(data, { isAvailable: MENU.isAvailable, stockQuantity: MENU.stockQuantity });
    return ok(menuToClient(unwrap(await supabase.from('menu_items').update(row).eq('id', id).select(MENU_SELECT).single())));
};
export const deleteMenuItem = async (id) => {
    unwrap(await supabase.from('menu_items').delete().eq('id', id));
    return ok({ message: 'Menu item deleted' });
};

// ---------------------------------------------------------------------------
// Orders (server-side functions return orders already in client shape)
// ---------------------------------------------------------------------------
export const getMyOrders = async () => ok(await rpc('my_orders'));
export const getCurrentOrder = async () => ok(await rpc('current_order'));
export const getAllOrders = async (params = {}) =>
    ok(await rpc('admin_orders', { p_scope: 'all', p_status: params.status || null, p_date: params.date || null }));
export const getActiveOrders = async () => ok(await rpc('admin_orders', { p_scope: 'active' }));
export const getOrder = async (id) => {
    const order = await rpc('get_order', { p_id: id });
    if (!order) throw apiError('Order not found', 404);
    return ok(order);
};
export const createOrder = async (data) => {
    const id = await rpc('place_order', {
        p_items: data.items,
        p_coupon_code: data.couponCode || '',
        p_table_id: data.tableId || null,
        p_special_instructions: data.specialInstructions || '',
        p_loyalty_offer_id: data.pointsUsed && data.loyaltyOfferId ? data.loyaltyOfferId : null,
    });
    return getOrder(id);
};
export const updateOrderStatus = async (id, status) => ok(await rpc('update_order_status', { p_order_id: id, p_status: status }));
export const requestBill = async (id) => ok(await rpc('request_bill', { p_order_id: id }));
export const updatePayment = async (id, paymentMethod, amountPaid) =>
    ok(await rpc('record_payment', { p_order_id: id, p_method: paymentMethod, p_amount: amountPaid }));

// ---------------------------------------------------------------------------
// Coupons
// ---------------------------------------------------------------------------
const COUPON = {
    code: ['code', 'text'], description: ['description', 'text'], discountType: ['discount_type', 'text'],
    discountValue: ['discount_value', 'num'], minOrderAmount: ['min_order_amount', 'num'],
    maxDiscount: ['max_discount', 'numOrNull'], applicableItems: ['applicable_items', 'list'],
    applicableCategories: ['applicable_categories', 'list'], usageLimit: ['usage_limit', 'int'],
    validFrom: ['valid_from', 'date'], validUntil: ['valid_until', 'date'], isActive: ['is_active', 'bool'],
};

export const getCoupons = async () => {
    const now = new Date().toISOString();
    return ok(listToClient(unwrap(await supabase.from('coupons')
        .select('id, code, description, discount_type, discount_value, min_order_amount, max_discount')
        .eq('is_active', true).lte('valid_from', now).gte('valid_until', now))));
};
export const getAllCoupons = async () =>
    ok(listToClient(unwrap(await supabase.from('coupons').select().order('created_at', { ascending: false }))));
export const validateCoupon = async (code, orderTotal) =>
    ok(await rpc('validate_coupon', { p_code: code, p_order_total: orderTotal }));
export const createCoupon = async (data) => {
    const row = toDb(data, COUPON);
    if (!row.usage_limit) row.usage_limit = -1;
    return ok(toClient(unwrap(await supabase.from('coupons').insert(row).select().single(), 'coupons')));
};
export const updateCoupon = async (id, data) =>
    ok(toClient(unwrap(await supabase.from('coupons').update(toDb(data, COUPON)).eq('id', id).select().single(), 'coupons')));
export const deleteCoupon = async (id) => {
    unwrap(await supabase.from('coupons').delete().eq('id', id));
    return ok({ message: 'Coupon deleted' });
};

// ---------------------------------------------------------------------------
// Inventory: stock items, locations, vendors, purchases, recipes, counts.
// Stock only changes through database functions that write the stock ledger.
// ---------------------------------------------------------------------------
export const getStock = async (locationId) => ok(await rpc('stock_overview', { p_location: locationId || null }));
export const saveStockItem = async (data) => ok(await rpc('save_stock_item', { p: data }));
export const deleteStockItem = async (id) => ok(await rpc('delete_stock_item', { p_id: id }));

export const getStockLocations = async () =>
    ok(listToClient(unwrap(await supabase.from('stock_locations').select().order('sort_order').order('name'))));
export const saveStockLocation = async ({ id, name, sortOrder, isActive }) => {
    const row = toDb({ name, sortOrder, isActive }, { name: ['name', 'text'], sortOrder: ['sort_order', 'int'], isActive: ['is_active', 'bool'] });
    const q = id ? supabase.from('stock_locations').update(row).eq('id', id) : supabase.from('stock_locations').insert(row);
    return ok(toClient(unwrap(await q.select().single())));
};
export const deleteStockLocation = async (id) => ok(unwrap(await supabase.from('stock_locations').delete().eq('id', id)));
export const setLocationDefault = async (id, kind) => ok(await rpc('set_location_default', { p_location: id, p_kind: kind }));

const VENDOR = {
    name: ['name', 'text'], phone: ['phone', 'text'], gstin: ['gstin', 'text'], address: ['address', 'text'],
    leadTimeDays: ['lead_time_days', 'int'], orderCycleDays: ['order_cycle_days', 'int'],
    paymentTermsDays: ['payment_terms_days', 'int'], notes: ['notes', 'text'], isActive: ['is_active', 'bool'],
};
export const getVendors = async () => ok(await rpc('list_vendors'));
export const saveVendor = async ({ id, ...data }) => {
    const row = toDb(data, VENDOR);
    const q = id ? supabase.from('vendors').update(row).eq('id', id) : supabase.from('vendors').insert(row);
    return ok(toClient(unwrap(await q.select().single(), 'vendors')));
};
export const deleteVendor = async (id) => ok(unwrap(await supabase.from('vendors').delete().eq('id', id)));

export const recordPurchase = async (data) => ok(await rpc('record_purchase', { p: data }));
export const getPurchases = async ({ from, to, vendorId } = {}) =>
    ok(await rpc('list_purchases', { p_from: from || null, p_to: to || null, p_vendor: vendorId || null }));
export const getPurchase = async (id) => ok(await rpc('get_purchase', { p_id: id }));
export const payPurchase = async (id, amount, mode) => ok(await rpc('pay_purchase', { p_id: id, p_amount: Number(amount), p_mode: mode }));
export const voidPurchase = async (id) => ok(await rpc('void_purchase', { p_id: id }));
export const uploadStockPhoto = async (file, folder = 'bills') => uploadImage(file, folder);

export const recordStockChange = async (data) => ok(await rpc('record_stock_change', { p: data }));
export const transferStock = async (data) => ok(await rpc('transfer_stock', { p: data }));
export const getStockMoves = async (filters = {}) => ok(await rpc('list_stock_moves', { p: filters }));
export const getUsage = async (itemId, days = 7) => ok(await rpc('usage_breakdown', { p_item: itemId, p_days: days }));
export const getStockLeaks = async (days = 7) => ok(await rpc('stock_leaks', { p_days: days }));
export const getInventoryAlerts = async () => ok(await rpc('inventory_alerts'));

export const getCounts = async () => ok(await rpc('list_counts'));
export const startCount = async (locationId, scope) => ok(await rpc('start_count', { p_location: locationId, p_scope: scope }));
export const getCount = async (id) => ok(await rpc('get_count', { p_id: id }));
export const saveCount = async (id, lines) => ok(await rpc('save_count', { p_id: id, p_lines: lines }));
export const postCount = async (id) => ok(await rpc('post_count', { p_id: id }));
export const cancelCount = async (id) => ok(await rpc('cancel_count', { p_id: id }));

export const getRecipe = async (menuItemId) => ok(await rpc('get_recipe', { p_menu_item: menuItemId }));
export const saveRecipe = async (menuItemId, lines, locationId) =>
    ok(await rpc('save_recipe', { p_menu_item: menuItemId, p_lines: lines, p_location: locationId ?? null }));
export const trackMenuItemStock = async (menuItemId) => ok(await rpc('track_menu_item_stock', { p_menu_item: menuItemId }));
export const getMenuCosting = async () => ok(await rpc('menu_costing'));

// ---------------------------------------------------------------------------
// Employees, attendance, holidays
// ---------------------------------------------------------------------------
const EMPLOYEE = {
    name: ['name', 'text'], phone: ['phone', 'text'], email: ['email', 'text'], role: ['role', 'text'],
    salary: ['salary', 'num'], joiningDate: ['joining_date', 'date'], isActive: ['is_active', 'bool'],
    address: ['address', 'text'], emergencyContact: ['emergency_contact', 'text'],
};
const ATTENDANCE = {
    date: ['date', 'date'], status: ['status', 'text'], checkIn: ['check_in', 'text'],
    checkOut: ['check_out', 'text'], notes: ['notes', 'text'],
};
const HOLIDAY = { date: ['date', 'date'], name: ['name', 'text'], description: ['description', 'text'] };
const day = (value) => (value ? String(value).slice(0, 10) : value);

export const getEmployees = async (params = {}) => {
    // Through a function so salaries stay hidden from roles without permission
    let rows = listToClient(await rpc('list_employees'));
    if (params.role) rows = rows.filter(e => e.role === params.role);
    if (params.isActive !== undefined) rows = rows.filter(e => e.isActive === (params.isActive === 'true' || params.isActive === true));
    return ok(rows);
};
export const getEmployee = async (id) => ok(toClient(unwrap(await supabase.from('employees').select().eq('id', id).single())));
export const createEmployee = async (data) =>
    ok(toClient(unwrap(await supabase.from('employees').insert(toDb(data, EMPLOYEE)).select().single())));
export const updateEmployee = async (id, data) =>
    ok(toClient(unwrap(await supabase.from('employees').update(toDb(data, EMPLOYEE)).eq('id', id).select().single())));
export const deleteEmployee = async (id) => {
    unwrap(await supabase.from('employees').delete().eq('id', id));
    return ok({ message: 'Employee deleted' });
};
export const getEmployeeAttendance = async (id, params = {}) => {
    let q = supabase.from('attendance').select().eq('employee_id', id).order('date');
    if (params.month && params.year) {
        const month = String(params.month).padStart(2, '0');
        const lastDay = new Date(Number(params.year), Number(params.month), 0).getDate();
        q = q.gte('date', `${params.year}-${month}-01`).lte('date', `${params.year}-${month}-${lastDay}`);
    }
    return ok(listToClient(unwrap(await q)));
};
export const markAttendance = async (id, data) => {
    const row = { ...toDb(data, ATTENDANCE), employee_id: id };
    row.date = day(row.date);
    return ok(toClient(unwrap(await supabase.from('attendance')
        .upsert(row, { onConflict: 'employee_id,date' }).select().single())));
};
export const getHolidays = async () => ok(listToClient(unwrap(await supabase.from('holidays').select().order('date'))));
export const addHoliday = async (data) => {
    const row = toDb(data, HOLIDAY);
    row.date = day(row.date);
    return ok(toClient(unwrap(await supabase.from('holidays').insert(row).select().single(), 'holidays')));
};
export const deleteHoliday = async (id) => {
    unwrap(await supabase.from('holidays').delete().eq('id', id));
    return ok({ message: 'Holiday deleted' });
};

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------
export const getDashboardStats = async () => ok(await rpc('dashboard_stats'));
export const getRevenueData = async (period) => ok(await rpc('revenue_series', { p_period: period || 'week' }));
export const getCategorySales = async (period) => ok(await rpc('category_sales', { p_period: period || 'month' }));
export const getTopItems = async () => ok(await rpc('top_items'));
export const getUserAnalytics = async (period) => ok(await rpc('user_analytics', { p_period: period || 'month' }));

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------
const TABLE = {
    tableNumber: ['table_number', 'text'], capacity: ['capacity', 'int'], status: ['status', 'text'],
    isActive: ['is_active', 'bool'], isOccupied: ['is_occupied', 'bool'],
};
const TABLE_SELECT = '*, current_order:orders!dining_tables_current_order_fk(order_number, status)';
const tableToClient = (row) => ({
    ...toClient(row),
    currentOrder: row.current_order ? { orderNumber: row.current_order.order_number, status: row.current_order.status } : row.current_order_id,
});
const byTableNumber = (a, b) => a.tableNumber.localeCompare(b.tableNumber, undefined, { numeric: true });

export const getTables = async () =>
    ok(unwrap(await supabase.from('dining_tables').select(TABLE_SELECT).eq('is_active', true)).map(tableToClient).sort(byTableNumber));
export const getAvailableTables = async () =>
    ok(unwrap(await supabase.from('dining_tables').select().eq('is_active', true).eq('status', 'available')).map(tableToClient).sort(byTableNumber));
export const createTable = async (data) =>
    ok(tableToClient(unwrap(await supabase.from('dining_tables').insert(toDb(data, TABLE)).select().single(), 'dining_tables')));
export const createBulkTables = async (data) =>
    ok(await rpc('create_tables_bulk', { p_start: Number(data.startNumber), p_end: Number(data.endNumber), p_capacity: Number(data.capacity) || 4 }));
export const updateTable = async (id, data) => {
    const row = toDb(data, TABLE);
    if (row.status === 'available') Object.assign(row, { is_occupied: false, current_order_id: null });
    return ok(tableToClient(unwrap(await supabase.from('dining_tables').update(row).eq('id', id).select().single(), 'dining_tables')));
};
export const deleteTable = async (id) => {
    unwrap(await supabase.from('dining_tables').delete().eq('id', id));
    return ok({ message: 'Table deleted' });
};

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
export const getSettings = async () => {
    const rows = unwrap(await supabase.from('settings').select('key, value'));
    return ok(Object.fromEntries(rows.map(r => [r.key, r.value])));
};
export const getAllSettings = getSettings;
export const getGstRate = async () => {
    const { data } = await supabase.from('settings').select('value').eq('key', 'gst_rate').maybeSingle();
    return ok({ gstRate: data ? Number(data.value) : 5 });
};
export const updateGstRate = async (gstRate) => {
    const rate = Number(gstRate);
    if (Number.isNaN(rate) || rate < 0 || rate > 100) throw apiError('GST rate must be between 0 and 100');
    unwrap(await supabase.from('settings').upsert({ key: 'gst_rate', value: rate, description: 'Default GST rate (%)' }));
    return ok({ gstRate: rate });
};
export const updateSetting = async (key, value) =>
    ok(unwrap(await supabase.from('settings').upsert({ key, value }).select().single()));

// ---------------------------------------------------------------------------
// Collections (homepage sections)
// ---------------------------------------------------------------------------
const COLLECTION = {
    name: ['name', 'text'], icon: ['icon', 'text'], description: ['description', 'text'],
    isActive: ['is_active', 'bool'], showOnHomepage: ['show_on_homepage', 'bool'], order: ['sort_order', 'int'],
    type: ['type', 'text'],
};
const COLLECTION_SELECT = `*, collection_items(position, menu_items(${MENU_SELECT}))`;
const SYSTEM_FLAGS = { bestseller: 'is_best_seller', new: 'is_new_item', recommended: 'is_recommended' };

const collectionToClient = async (row) => {
    const col = toClient(row);
    delete col.collectionItems;
    col.products = (row.collection_items || [])
        .sort((a, b) => a.position - b.position)
        .map(ci => ci.menu_items).filter(Boolean).map(menuToClient);
    // System collections with no hand-picked items show items with the matching flag
    if (col.products.length === 0 && SYSTEM_FLAGS[row.type]) {
        col.products = menuList(unwrap(await supabase.from('menu_items').select(MENU_SELECT)
            .eq(SYSTEM_FLAGS[row.type], true).eq('is_available', true).limit(10)));
    }
    return col;
};
const collectionList = (rows) => Promise.all((rows || []).map(collectionToClient));
const fetchCollection = async (id) =>
    collectionToClient(unwrap(await supabase.from('collections').select(COLLECTION_SELECT).eq('id', id).single()));

export const getCollections = async (homepage = false) => {
    let q = supabase.from('collections').select(COLLECTION_SELECT).eq('is_active', true)
        .order('sort_order').order('created_at', { ascending: false });
    if (homepage) q = q.eq('show_on_homepage', true);
    return ok(await collectionList(unwrap(await q)));
};
export const getCollection = async (slug) =>
    ok(await collectionToClient(unwrap(await supabase.from('collections').select(COLLECTION_SELECT).eq('slug', slug).single())));
export const getAdminCollections = async () =>
    ok(await collectionList(unwrap(await supabase.from('collections').select(COLLECTION_SELECT)
        .order('sort_order').order('created_at', { ascending: false }))));
export const createCollection = async (data) => {
    if (!data?.name) throw apiError('Collection name is required');
    const row = { icon: '🍽️', show_on_homepage: data.showOnHomepage !== false, type: 'custom', ...toDb(data, COLLECTION) };
    return ok(toClient(unwrap(await supabase.from('collections').insert(row).select().single())));
};
export const updateCollection = async (id, data) =>
    ok(toClient(unwrap(await supabase.from('collections').update(toDb(data, COLLECTION)).eq('id', id).select().single())));
export const deleteCollection = async (id) => {
    unwrap(await supabase.from('collections').delete().eq('id', id));
    return ok({ message: 'Collection deleted successfully' });
};
export const addProductToCollection = async (collectionId, productId) => {
    const ids = Array.isArray(productId) ? productId : [productId];
    const { count } = await supabase.from('collection_items').select('*', { count: 'exact', head: true }).eq('collection_id', collectionId);
    unwrap(await supabase.from('collection_items').upsert(
        ids.map((id, i) => ({ collection_id: collectionId, menu_item_id: id, position: (count || 0) + i })),
        { onConflict: 'collection_id,menu_item_id', ignoreDuplicates: true }));
    return ok(await fetchCollection(collectionId));
};
export const removeProductFromCollection = async (collectionId, productId) => {
    unwrap(await supabase.from('collection_items').delete().eq('collection_id', collectionId).eq('menu_item_id', productId));
    return ok(await fetchCollection(collectionId));
};

// ---------------------------------------------------------------------------
// Loyalty
// ---------------------------------------------------------------------------
const LOYALTY_SETTINGS = {
    pointsPerRupee: ['points_per_rupee', 'num'], minOrderForPoints: ['min_order_for_points', 'num'],
    pointsToRupeeRatio: ['points_to_rupee_ratio', 'num'], minPointsToRedeem: ['min_points_to_redeem', 'int'],
    maxRedemptionPercent: ['max_redemption_percent', 'num'], isActive: ['is_active', 'bool'],
};
const LOYALTY_OFFER = {
    name: ['name', 'text'], description: ['description', 'text'], pointsRequired: ['points_required', 'int'],
    discountValue: ['discount_value', 'num'], minOrderValue: ['min_order_value', 'num'], isActive: ['is_active', 'bool'],
};

export const getLoyaltySettings = async () =>
    ok(toClient(unwrap(await supabase.from('loyalty_settings').select().limit(1).single())));
export const updateLoyaltySettings = async (data) =>
    ok(toClient(unwrap(await supabase.from('loyalty_settings').update(toDb(data, LOYALTY_SETTINGS))
        .eq('tenant_id', sessionTenantId).select().single())));
export const getMyLoyaltyPoints = async () => {
    const points = await rpc('my_loyalty_points');
    if (!points) throw apiError('Please sign in first', 401);
    return ok(points);
};
export const calculateRedemption = async (orderTotal, pointsToUse) =>
    ok(await rpc('calculate_redemption', { p_order_total: orderTotal, p_points_to_use: pointsToUse ?? null }));
export const getLoyaltyUsers = async () => ok(await rpc('loyalty_customers'));
export const adjustUserPoints = async (userId, points, reason) =>
    ok(await rpc('adjust_points', { p_customer_id: userId, p_points: Number(points), p_reason: reason || '' }));
export const setProductBonusPoints = async (productId, bonusLoyaltyPoints) =>
    ok(menuToClient(unwrap(await supabase.from('menu_items')
        .update({ bonus_loyalty_points: Number(bonusLoyaltyPoints) || 0 }).eq('id', productId).select(MENU_SELECT).single())));
export const getLoyaltyOffers = async () =>
    ok(listToClient(unwrap(await supabase.from('loyalty_offers').select().eq('is_active', true).order('points_required'))));
export const createLoyaltyOffer = async (data) =>
    ok(toClient(unwrap(await supabase.from('loyalty_offers').insert(toDb(data, LOYALTY_OFFER)).select().single())));
export const updateLoyaltyOffer = async (id, data) =>
    ok(toClient(unwrap(await supabase.from('loyalty_offers').update(toDb(data, LOYALTY_OFFER)).eq('id', id).select().single())));
export const deleteLoyaltyOffer = async (id) => {
    unwrap(await supabase.from('loyalty_offers').delete().eq('id', id));
    return ok({ message: 'Offer deleted' });
};

// ---------------------------------------------------------------------------
// Customer analytics
// ---------------------------------------------------------------------------
export const getCustomerAnalytics = async (params = {}) => ok(await rpc('customer_analytics', {
    p_search: params.search || '', p_sort_by: params.sortBy || 'totalSpent', p_order: params.order || 'desc',
    p_page: Number(params.page) || 1, p_limit: Number(params.limit) || 20,
}));
export const getCustomerDetail = async (id) => ok(await rpc('customer_detail', { p_customer_id: id }));
export const searchOrders = async (params = {}) => ok(await rpc('search_orders', {
    p_search: params.search || '', p_status: params.status || '',
    p_start_date: params.startDate || null, p_end_date: params.endDate || null,
    p_min_amount: params.minAmount ? Number(params.minAmount) : null,
    p_max_amount: params.maxAmount ? Number(params.maxAmount) : null,
    p_page: Number(params.page) || 1, p_limit: Number(params.limit) || 20,
}));

// ---------------------------------------------------------------------------
// Phase 0: exact bill preview, global search, staff and roles, catalogue, audit
// ---------------------------------------------------------------------------
export const quoteOrder = async (items, couponCode = '', loyaltyOfferId = null) =>
    ok(await rpc('quote_order', { p_items: items, p_coupon_code: couponCode || '', p_loyalty_offer_id: loyaltyOfferId }));

export const globalSearch = async (query) => ok(await rpc('global_search', { p_query: query }));

export const getTenantPublic = async () => ok(await rpc('get_tenant_public'));

// Staff
export const getStaff = async () => ok(await rpc('list_staff'));
export const createStaff = async ({ name, phone, roleId, pin }) =>
    ok(await rpc('create_staff', { p_name: name, p_phone: phone, p_role_id: roleId, p_pin: pin }));
export const setStaffPin = async (staffId, pin) => ok(await rpc('set_staff_pin', { p_staff_id: staffId, p_pin: pin }));
export const updateStaff = async (id, data) => {
    const row = toDb(data, { name: ['name', 'text'], roleId: ['role_id', 'uuid'], isActive: ['is_active', 'bool'] });
    return ok(unwrap(await supabase.from('staff_users').update(row).eq('id', id).select('id').single()));
};
export const setStaffOverride = async (staffId, perm, allow) => {
    if (allow === null) {
        unwrap(await supabase.from('staff_overrides').delete().eq('staff_id', staffId).eq('perm', perm));
    } else {
        unwrap(await supabase.from('staff_overrides').upsert({ staff_id: staffId, perm, allow }));
    }
    return ok(true);
};

// Roles and their permissions
export const getRoles = async () => {
    const roles = unwrap(await supabase.from('roles').select('*, role_permissions(perm)').order('created_at'));
    return ok(roles.map(r => ({ ...toClient(r), permissions: (r.role_permissions || []).map(p => p.perm) })));
};
export const createRole = async ({ name, description }) =>
    ok(toClient(unwrap(await supabase.from('roles').insert({ name, description: description || '' }).select().single(), 'roles')));
export const updateRole = async (id, { name, description }) =>
    ok(toClient(unwrap(await supabase.from('roles').update({ name, description }).eq('id', id).select().single(), 'roles')));
export const deleteRole = async (id) => {
    unwrap(await supabase.from('roles').delete().eq('id', id));
    return ok(true);
};
export const setRolePermission = async (roleId, perm, on) => {
    if (on) unwrap(await supabase.from('role_permissions').upsert({ role_id: roleId, perm }, { ignoreDuplicates: true }));
    else unwrap(await supabase.from('role_permissions').delete().eq('role_id', roleId).eq('perm', perm));
    return ok(true);
};

// Brands and tax groups
export const getBrands = async () => ok(listToClient(unwrap(await supabase.from('brands').select().order('name'))));
export const createBrand = async (name) => ok(toClient(unwrap(await supabase.from('brands').insert({ name }).select().single(), 'brands')));
export const deleteBrand = async (id) => { unwrap(await supabase.from('brands').delete().eq('id', id)); return ok(true); };
export const getTaxGroups = async () => ok(listToClient(unwrap(await supabase.from('tax_groups').select().order('name'))));
export const saveTaxGroup = async ({ id, name, components }) => {
    const row = { name, components: components.map(c => ({ name: c.name, rate: Number(c.rate) || 0 })) };
    const q = id ? supabase.from('tax_groups').update(row).eq('id', id) : supabase.from('tax_groups').insert(row);
    return ok(toClient(unwrap(await q.select().single(), 'tax_groups')));
};
export const deleteTaxGroup = async (id) => { unwrap(await supabase.from('tax_groups').delete().eq('id', id)); return ok(true); };

// Pack units for an item (1 Pack = 10 pieces)
export const getItemUnits = async (menuItemId) =>
    ok(listToClient(unwrap(await supabase.from('item_units').select().eq('menu_item_id', menuItemId).order('factor'))));
export const createItemUnit = async (menuItemId, { name, factor, salePrice }) =>
    ok(toClient(unwrap(await supabase.from('item_units').insert({
        menu_item_id: menuItemId, name, factor: Number(factor), sale_price: salePrice === '' || salePrice == null ? null : Number(salePrice),
    }).select().single())));
export const deleteItemUnit = async (id) => { unwrap(await supabase.from('item_units').delete().eq('id', id)); return ok(true); };

// Audit log
export const getAuditLog = async ({ entity, page = 1, limit = 50 } = {}) => {
    let q = supabase.from('audit_log').select('*', { count: 'exact' }).order('at', { ascending: false })
        .range((page - 1) * limit, page * limit - 1);
    if (entity) q = q.eq('entity', entity);
    const { data, count, error } = await q;
    unwrap({ data, error });
    return ok({ rows: listToClient(data), total: count || 0 });
};

// Terms
export const acceptTerms = async (kind, version) =>
    ok(await rpc('accept_terms', { p_kind: kind, p_version: version, p_user_agent: navigator.userAgent }));
export const getAcceptances = async () =>
    ok(listToClient(unwrap(await supabase.from('acceptances').select().order('accepted_at', { ascending: false }))));
export const getTermsText = async (kind, version) =>
    ok(unwrap(await supabase.from('terms_versions').select().eq('kind', kind).eq('version', version).single()));

// Superadmin
export const saOverview = async () => ok(await rpc('sa_overview'));
export const saCreateTenant = async (t) => ok(await rpc('sa_create_tenant', {
    p_name: t.name, p_slug: t.slug, p_plan_id: t.planId, p_paid_until: t.paidUntil || null,
    p_owner_name: t.ownerName, p_owner_phone: t.ownerPhone, p_owner_pin: t.ownerPin, p_owner_email: t.ownerEmail || '',
}));
export const saUpdateTenant = async (id, patch) => ok(await rpc('sa_update_tenant', { p_id: id, p_patch: patch }));
export const saRecordPayment = async (id, months, amount, note) =>
    ok(await rpc('sa_record_payment', { p_id: id, p_months: Number(months), p_amount: Number(amount) || 0, p_note: note || '' }));
export const saResetOwnerPin = async (tenantId, pin) => ok(await rpc('sa_reset_owner_pin', { p_tenant: tenantId, p_pin: pin }));
export const saSavePlan = async (plan) => {
    const row = {
        name: plan.name, max_staff: Number(plan.maxStaff), max_kiosks: Number(plan.maxKiosks),
        max_devices: Number(plan.maxDevices), monthly_price: Number(plan.monthlyPrice) || 0,
    };
    const q = plan.id ? supabase.from('plans').update(row).eq('id', plan.id) : supabase.from('plans').insert(row);
    return ok(toClient(unwrap(await q.select().single())));
};

// ---------------------------------------------------------------------------
// Counter, kitchen and money (Phase 2)
// ---------------------------------------------------------------------------
// Everything the counter needs to work offline: menu with pack units, categories, tables
export const getPosCatalogue = async () => {
    const [items, cats, tables] = await Promise.all([
        supabase.from('menu_items').select('id, name, price, mrp, image, is_veg, is_available, is_restricted, item_type, category_id, brand_id, tax_group_id, price_includes_tax, item_units(id, name, factor, sale_price)').order('name'),
        supabase.from('categories').select('id, name, parent_id, sort_order, is_active').order('sort_order'),
        supabase.from('dining_tables').select('id, table_number, status').order('table_number'),
    ]);
    const [groups, taxSetting, brands] = await Promise.all([
        supabase.from('tax_groups').select('id, components'),
        supabase.from('settings').select('value').eq('key', 'tax_config').maybeSingle(),
        supabase.from('brands').select('id, name').order('name'),
    ]);
    return ok({ items: unwrap(items), categories: unwrap(cats), tables: unwrap(tables), taxGroups: unwrap(groups),
        defaultTax: unwrap(taxSetting)?.value || [], brands: unwrap(brands) });
};
export const quoteStaffOrder = async (p) => ok(await rpc('quote_staff_order', { p }));
export const createStaffOrder = async (p) => ok(await rpc('create_staff_order', { p }));
export const settleOrder = async (orderId, payments, drawer = 'cash_counter', clientId = null) =>
    ok(await rpc('settle_order', { p_order_id: orderId, p_payments: payments, p_drawer: drawer, p_client_id: clientId }));
export const cancelOrder = async (orderId, reason, approverPhone = null, approverPin = null) =>
    ok(await rpc('cancel_order', { p_order_id: orderId, p_reason: reason, p_approver_phone: approverPhone, p_approver_pin: approverPin }));
export const removeServiceCharge = async (orderId, remove = true) => ok(await rpc('remove_service_charge', { p_order_id: orderId, p_remove: remove }));
export const requestPayment = async (orderId, mode) => ok(await rpc('request_payment', { p_order_id: orderId, p_mode: mode }));
export const findCustomers = async (q) => ok(await rpc('find_customers', { p_query: q }));
export const registerDevice = async (kind, name) => ok(await rpc('register_device', { p_kind: kind, p_name: name }));
export const touchDevice = async (code) => ok(await rpc('touch_device', { p_code: code }));
export const getDevices = async () => ok(listToClient(unwrap(await supabase.from('devices').select().order('code'))));
export const setDeviceActive = async (id, isActive) => ok(unwrap(await supabase.from('devices').update({ is_active: isActive }).eq('id', id)));

export const getKitchenOrders = async () => ok(await rpc('kitchen_orders'));
export const setKitchenStatus = async (orderId, itemId, status) =>
    ok(await rpc('set_kitchen_status', { p_order_id: orderId, p_item_id: itemId, p_status: status }));

export const getCurrentShifts = async () => ok(await rpc('current_shifts'));
export const openShift = async (drawer, denoms, note = '') => ok(await rpc('open_shift', { p_drawer: drawer, p_denoms: denoms, p_note: note }));
export const closeShift = async (id, denoms, upiReported, cardReported, reason, note = '') =>
    ok(await rpc('close_shift', { p_shift_id: id, p_denoms: denoms, p_upi_reported: upiReported, p_card_reported: cardReported, p_reason: reason, p_note: note }));
export const cashMovement = async (drawer, kind, amount, note, categoryId = null, clientId = null) =>
    ok(await rpc('cash_movement', { p_drawer: drawer, p_kind: kind, p_amount: Number(amount), p_note: note, p_category_id: categoryId, p_client_id: clientId }));
export const getShifts = async (from, to) => ok(await rpc('list_shifts', { p_from: from || null, p_to: to || null }));

export const getExpenseCategories = async () =>
    ok(listToClient(unwrap(await supabase.from('expense_categories').select().order('sort_order').order('name'))));
export const addExpenseCategory = async (name) =>
    ok(toClient(unwrap(await supabase.from('expense_categories').insert({ name }).select().single(), 'expense_categories')));
export const recordExpense = async (p) => ok(await rpc('record_expense', { p }));
export const payExpense = async (id, accountCode) => ok(await rpc('pay_expense', { p_id: id, p_account_code: accountCode }));
export const voidExpense = async (id, reason) => ok(await rpc('void_expense', { p_id: id, p_reason: reason }));
export const getExpenses = async (from, to) => ok(await rpc('list_expenses', { p_from: from || null, p_to: to || null }));
export const getRecurringExpenses = async () =>
    ok(listToClient(unwrap(await supabase.from('recurring_expenses').select('*, category:expense_categories(name)').order('name'))));
export const saveRecurringExpense = async ({ id, name, categoryId, amount, dayOfMonth, spreadMonths, nextDue, isActive }) => {
    const row = toDb({ name, categoryId, amount, dayOfMonth, spreadMonths, nextDue, isActive }, {
        name: ['name', 'text'], categoryId: ['category_id', 'uuid'], amount: ['amount', 'num'], dayOfMonth: ['day_of_month', 'int'],
        spreadMonths: ['spread_months', 'int'], nextDue: ['next_due', 'date'], isActive: ['is_active', 'bool'] });
    const q = id ? supabase.from('recurring_expenses').update(row).eq('id', id) : supabase.from('recurring_expenses').insert(row);
    return ok(unwrap(await q.select().single()));
};
export const deleteRecurringExpense = async (id) => ok(unwrap(await supabase.from('recurring_expenses').delete().eq('id', id)));
export const getPayables = async () => ok(await rpc('payables'));
export const getAccountBalances = async () => ok(await rpc('account_balances'));
export const getLedger = async (filters = {}) => ok(await rpc('list_ledger', { p: filters }));
export const getDaySummary = async (date) => ok(await rpc('day_summary', { p_date: date || null }));

export const getMyNotifications = async (limit = 30) => ok(await rpc('my_notifications', { p_limit: limit }));
export const ackNotification = async (id) => ok(await rpc('ack_notification', { p_id: id }));
