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
        if (error.code === 'PGRST116') throw apiError('Not saved: you may not be allowed to change this, or it was already removed', 404);
        throw apiError(error.message);
    }
    return data;
};

const ok = (data) => ({ data });
// A delete that removed nothing was blocked by permissions (or the row was already gone): say so instead of "deleted"
const removed = (res, table) => {
    const rows = unwrap(res, table);
    if (Array.isArray(rows) && rows.length === 0) throw apiError('Not deleted: you may not be allowed to remove this, or it was already removed', 403);
    return rows;
};

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
    textOrNull: (v) => (v === '' || v == null ? null : String(v)),
    list: (v) => (typeof v === 'string' ? (v ? JSON.parse(v) : []) : v || []),
    json: (v) => (typeof v === 'string' ? (v ? JSON.parse(v) : undefined) : v ?? undefined),
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
    kitchenStation: ['kitchen_station', 'textOrNull'],
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
    removed(await supabase.from('categories').delete().eq('id', id).select('id'));
    return ok({ message: 'Category deleted' });
};

// ---------------------------------------------------------------------------
// Menu items
// ---------------------------------------------------------------------------
const MENU_SELECT = '*, category:categories(id, name, parent_id), brand:brands(id, name)';
const MENU = {
    name: ['name', 'text'], nameHi: ['name_hi', 'text'], description: ['description', 'text'], price: ['price', 'num'],
    category: ['category_id', 'uuid'], isVeg: ['is_veg', 'bool'], isAvailable: ['is_available', 'bool'],
    isBestSeller: ['is_best_seller', 'bool'], isNewItem: ['is_new_item', 'bool'],
    isRecommended: ['is_recommended', 'bool'], isUpsell: ['is_upsell', 'bool'], tags: ['tags', 'list'],
    preparationTime: ['preparation_time', 'int'], stockQuantity: ['stock_quantity', 'int'],
    bonusLoyaltyPoints: ['bonus_loyalty_points', 'int'], initialStock: ['initial_stock', 'int'],
    lowStockThreshold: ['low_stock_threshold', 'int'], costPrice: ['cost_price', 'num'],
    brand: ['brand_id', 'uuid'], itemType: ['item_type', 'text'], unit: ['unit', 'text'], mrp: ['mrp', 'numOrNull'],
    priceIncludesTax: ['price_includes_tax', 'bool'], taxGroup: ['tax_group_id', 'uuid'],
    isRestricted: ['is_restricted', 'bool'], sku: ['sku', 'text'], hsnCode: ['hsn_code', 'text'],
    soldInShop: ['sold_in_shop', 'bool'], soldAtKiosk: ['sold_at_kiosk', 'bool'],
    sizes: ['sizes', 'json'], optionGroups: ['option_groups', 'list'], pairs: ['pairs', 'list'], details: ['details', 'json'],
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
    let q = supabase.from('menu_items').select(MENU_SELECT).eq('is_available', true).eq('sold_in_shop', true).order('name');
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
    ok(menuList(unwrap(await supabase.from('menu_items').select(MENU_SELECT).eq('is_best_seller', true).eq('is_available', true).eq('sold_in_shop', true).limit(10))));
export const getNewItems = async () =>
    ok(menuList(unwrap(await supabase.from('menu_items').select(MENU_SELECT).eq('is_new_item', true).eq('is_available', true).eq('sold_in_shop', true).limit(10))));
export const getRecommended = async () =>
    ok(menuList(unwrap(await supabase.from('menu_items').select(MENU_SELECT).eq('is_recommended', true).eq('is_available', true).eq('sold_in_shop', true))));
// One item for the customer's item sheet (only items on sale in the shop)
export const getShopItem = async (id) =>
    ok(menuList(unwrap(await supabase.from('menu_items').select(MENU_SELECT).eq('id', id).eq('sold_in_shop', true)))[0] || null);

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
// Where an item is sold: main shop (counter + customer menu) and/or kiosk
export const setSoldAt = async (id, data) => {
    const row = toDb(data, { soldInShop: MENU.soldInShop, soldAtKiosk: MENU.soldAtKiosk });
    return ok(menuToClient(unwrap(await supabase.from('menu_items').update(row).eq('id', id).select(MENU_SELECT).single())));
};
export const deleteMenuItem = async (id) => {
    removed(await supabase.from('menu_items').delete().eq('id', id).select('id'));
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
        p_table_code: data.tableCode || null,
        p_client_id: data.clientId || null,
        p_points_cash: !!data.pointsCash && !data.loyaltyOfferId,
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
    removed(await supabase.from('coupons').delete().eq('id', id).select('id'));
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
export const deleteStockLocation = async (id) => ok(removed(await supabase.from('stock_locations').delete().eq('id', id).select('id')));
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
export const deleteVendor = async (id) => ok(removed(await supabase.from('vendors').delete().eq('id', id).select('id')));

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
    payType: ['pay_type', 'text'], dailyRate: ['daily_rate', 'num'], hourlyRate: ['hourly_rate', 'num'], otRate: ['ot_rate', 'num'],
    shiftHours: ['shift_hours', 'num'], weeklyOff: ['weekly_off', 'numOrNull'],
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
    removed(await supabase.from('employees').delete().eq('id', id).select('id'));
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
    removed(await supabase.from('holidays').delete().eq('id', id).select('id'));
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
    removed(await supabase.from('dining_tables').delete().eq('id', id).select('id'));
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
        .map(ci => ci.menu_items).filter(m => m && m.sold_in_shop !== false).map(menuToClient);
    // System collections with no hand-picked items show items with the matching flag
    if (col.products.length === 0 && SYSTEM_FLAGS[row.type]) {
        col.products = menuList(unwrap(await supabase.from('menu_items').select(MENU_SELECT)
            .eq(SYSTEM_FLAGS[row.type], true).eq('is_available', true).eq('sold_in_shop', true).limit(10)));
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
    removed(await supabase.from('collections').delete().eq('id', id).select('id'));
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
    pointsAsCash: ['points_as_cash', 'bool'], dealsOn: ['deals_on', 'bool'],
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
    removed(await supabase.from('loyalty_offers').delete().eq('id', id).select('id'));
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
export const quoteOrder = async (items, couponCode = '', loyaltyOfferId = null, pointsCash = false) =>
    ok(await rpc('quote_order', { p_items: items, p_coupon_code: couponCode || '', p_loyalty_offer_id: loyaltyOfferId, p_points_cash: !!pointsCash && !loyaltyOfferId }));
// Cafe settings the customer app follows: ways to pay, pickup card colours, points rules
export const getCustomerScreen = async () => ok(await rpc('customer_screen'));

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
// The page this role opens on after login (null = the first page it may use)
export const setRoleHome = async (id, homePath) =>
    ok(toClient(unwrap(await supabase.from('roles').update({ home_path: homePath || null }).eq('id', id).select().single(), 'roles')));
export const deleteRole = async (id) => {
    removed(await supabase.from('roles').delete().eq('id', id).select('id'));
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
export const deleteBrand = async (id) => { removed(await supabase.from('brands').delete().eq('id', id).select('id')); return ok(true); };
export const getTaxGroups = async () => ok(listToClient(unwrap(await supabase.from('tax_groups').select().order('name'))));
export const saveTaxGroup = async ({ id, name, components }) => {
    const row = { name, components: components.map(c => ({ name: c.name, rate: Number(c.rate) || 0 })) };
    const q = id ? supabase.from('tax_groups').update(row).eq('id', id) : supabase.from('tax_groups').insert(row);
    return ok(toClient(unwrap(await q.select().single(), 'tax_groups')));
};
export const deleteTaxGroup = async (id) => { removed(await supabase.from('tax_groups').delete().eq('id', id).select('id')); return ok(true); };

// Pack units for an item (1 Pack = 10 pieces)
export const getItemUnits = async (menuItemId) =>
    ok(listToClient(unwrap(await supabase.from('item_units').select().eq('menu_item_id', menuItemId).order('factor'))));
export const createItemUnit = async (menuItemId, { name, factor, salePrice }) =>
    ok(toClient(unwrap(await supabase.from('item_units').insert({
        menu_item_id: menuItemId, name, factor: Number(factor), sale_price: salePrice === '' || salePrice == null ? null : Number(salePrice),
    }).select().single())));
export const deleteItemUnit = async (id) => { removed(await supabase.from('item_units').delete().eq('id', id).select('id')); return ok(true); };

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
        supabase.from('menu_items').select('id, name, price, mrp, image, is_veg, is_available, is_restricted, sold_in_shop, item_type, category_id, brand_id, tax_group_id, price_includes_tax, sizes, option_groups, item_units(id, name, factor, sale_price)').order('name'),
        supabase.from('categories').select('id, name, parent_id, sort_order, is_active').order('sort_order'),
        supabase.from('dining_tables').select('id, table_number, status').order('table_number'),
    ]);
    const [groups, taxSetting, brands] = await Promise.all([
        supabase.from('tax_groups').select('id, components'),
        supabase.from('settings').select('value').eq('key', 'tax_config').maybeSingle(),
        supabase.from('brands').select('id, name').order('name'),
    ]);
    // Sizes, choice groups and combos on sale, kept with the catalogue so the counter can sell them offline
    const [optionGroups, combos] = await Promise.all([
        supabase.from('option_groups').select('id, name, pick, min_pick, max_pick, choices, sort_order').order('sort_order').order('name'),
        supabase.rpc('combos_on_sale'),
    ]);
    return ok({ items: unwrap(items), categories: unwrap(cats), tables: unwrap(tables), taxGroups: unwrap(groups),
        defaultTax: unwrap(taxSetting)?.value || [], brands: unwrap(brands),
        optionGroups: optionGroups.error ? [] : optionGroups.data, combos: combos.error ? [] : combos.data || [] });
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
export const setDeviceActive = async (id, isActive) => ok(unwrap(await supabase.from('devices').update({ is_active: isActive }).eq('id', id).select('id').single()));
export const getSetupStatus = async () => ok(await rpc('setup_status'));
export const getTourDone = async () => ok(await rpc('my_tour_done'));
export const markTourDone = async () => ok(await rpc('mark_tour_done'));
export const linkAllStaffEmployees = async () => ok(await rpc('link_all_staff_employees'));

export const getKitchenOrders = async () => ok(await rpc('kitchen_orders'));
export const setKitchenStatus = async (orderId, itemId, status) =>
    ok(await rpc('set_kitchen_status', { p_order_id: orderId, p_item_id: itemId, p_status: status }));

export const getCurrentShifts = async () => ok(await rpc('current_shifts'));
export const openShift = async (drawer, denoms, note = '') => ok(await rpc('open_shift', { p_drawer: drawer, p_denoms: denoms, p_note: note }));
export const closeShift = async (id, denoms, upiReported, cardReported, reason, note = '') =>
    ok(await rpc('close_shift', { p_shift_id: id, p_denoms: denoms, p_upi_reported: upiReported, p_card_reported: cardReported, p_reason: reason, p_note: note }));
export const cashMovement = async (drawer, kind, amount, note, categoryId = null, clientId = null) =>
    ok(await rpc('cash_movement_view', { p_drawer: drawer, p_kind: kind, p_amount: Number(amount), p_note: note, p_category_id: categoryId, p_client_id: clientId }));
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
export const deleteRecurringExpense = async (id) => ok(removed(await supabase.from('recurring_expenses').delete().eq('id', id).select('id')));
export const getPayables = async () => ok(await rpc('payables'));
export const getAccountBalances = async () => ok(await rpc('account_balances'));
export const getLedger = async (filters = {}) => ok(await rpc('list_ledger', { p: filters }));
export const getDaySummary = async (date) => ok(await rpc('day_summary', { p_date: date || null }));

export const getMyNotifications = async (limit = 30) => ok(await rpc('my_notifications', { p_limit: limit }));
export const ackNotification = async (id) => ok(await rpc('ack_notification', { p_id: id }));

// ---------------------------------------------------------------------------
// Kiosk and khata (Phase 3)
// ---------------------------------------------------------------------------
export const getKioskItems = async () => ok(await rpc('kiosk_items'));
export const getKioskRegulars = async () => ok(await rpc('kiosk_regulars'));
export const getKhataAccounts = async () => ok(await rpc('khata_accounts'));
export const getKhataHistory = async (customerId) => ok(await rpc('khata_history', { p_customer: customerId }));
export const settleKhata = async (customerId, amount, method, drawer = 'cash_counter', clientId = null) =>
    ok(await rpc('settle_khata', { p_customer: customerId, p_amount: Number(amount), p_method: method, p_drawer: drawer, p_client_id: clientId }));
export const setCreditLimit = async (customerId, limit) => ok(await rpc('set_credit_limit', { p_customer: customerId, p_limit: Number(limit) }));
export const runDailyReminders = async () => ok(await rpc('daily_reminders'));
export const setLocationMin = async (itemId, locationId, min) =>
    ok(await rpc('set_location_min', { p_item: itemId, p_location: locationId, p_min: Number(min) }));

// ---------------------------------------------------------------------------
// Reports and payroll (Phase 4)
// ---------------------------------------------------------------------------
export const getPnl = async (from, to) => ok(await rpc('pnl', { p_from: from, p_to: to }));
export const getCashFlow = async (from, to) => ok(await rpc('cash_flow', { p_from: from, p_to: to }));
export const getProfitTargets = async () => ok(await rpc('profit_targets'));
export const getGstPack = async (from, to) => ok(await rpc('gst_pack', { p_from: from, p_to: to }));
export const getGstDueDates = async () => ok(await rpc('gst_due_dates'));
export const getItemEconomics = async (from, to) => ok(await rpc('item_economics', { p_from: from, p_to: to }));

export const runPayroll = async (month) => ok(await rpc('run_payroll', { p_month: month }));
export const getPayroll = async (month) => ok(await rpc('get_payroll', { p_month: month }));
export const finalizePayroll = async (month) => ok(await rpc('finalize_payroll', { p_month: month }));
export const payPayslips = async (month, accountCode, payslipId = null) =>
    ok(await rpc('pay_payslips', { p_month: month, p_account_code: accountCode, p_payslip: payslipId }));
export const giveAdvance = async (employeeId, amount, instalment, accountCode, note) =>
    ok(await rpc('give_advance', { p_employee: employeeId, p_amount: Number(amount), p_instalment: Number(instalment), p_account_code: accountCode, p_note: note }));
export const addPenalty = async (employeeId, date, reason, amount) =>
    ok(await rpc('add_penalty', { p_employee: employeeId, p_date: date, p_reason: reason, p_amount: Number(amount) }));
export const decidePenalty = async (id, approve) => ok(await rpc('decide_penalty', { p_id: id, p_approve: approve }));
export const getPenaltiesAdvances = async () => ok(await rpc('list_penalties_advances'));
export const requestLeave = async (employeeId, typeId, from, to, halfDay, reason) =>
    ok(await rpc('request_leave', { p_employee: employeeId, p_type: typeId, p_from: from, p_to: to, p_half: halfDay, p_reason: reason }));
export const decideLeave = async (id, approve) => ok(await rpc('decide_leave', { p_id: id, p_approve: approve }));
export const getLeaveOverview = async () => ok(await rpc('leave_overview', {}));

// ---------------------------------------------------------------------------
// Staff app, attendance and alerts (Phase 5)
// ---------------------------------------------------------------------------
export const getMyDay = async () => ok(await rpc('my_day'));
export const staffCheckIn = async (lat, lng, accuracy, selfie) =>
    ok(await rpc('staff_check_in', { p_lat: lat, p_lng: lng, p_accuracy: accuracy, p_selfie: selfie }));
export const staffCheckOut = async (lat, lng, accuracy, selfie) =>
    ok(await rpc('staff_check_out', { p_lat: lat, p_lng: lng, p_accuracy: accuracy, p_selfie: selfie }));
export const staffPing = async (lat, lng, accuracy) => ok(await rpc('staff_ping', { p_lat: lat, p_lng: lng, p_accuracy: accuracy }));
export const staffBreak = async (minutes, reason) => ok(await rpc('staff_break', { p_minutes: minutes, p_reason: reason }));
export const myLeaveRequest = async (typeId, from, to, reason) =>
    ok(await rpc('my_leave_request', { p_type: typeId, p_from: from, p_to: to || from, p_reason: reason }));
export const uploadPrivatePhoto = async (file, path) => {
    const body = await shrinkImage(file);
    unwrap(await supabase.storage.from('staff-private').upload(path, body, { contentType: body.type, upsert: true }));
    return path;
};
export const privatePhotoUrl = async (path) => {
    if (!path) return null;
    const { data } = await supabase.storage.from('staff-private').createSignedUrl(path, 600);
    return data?.signedUrl || null;
};
export const getAttendanceBoard = async (date) => ok(await rpc('attendance_board', { p_date: date || null }));
export const getLocationTrail = async (attendanceId) => ok(await rpc('location_trail', { p_attendance: attendanceId }));
export const linkEmployeeLogin = async (employeeId, staffId, track = null, shiftStart = null) =>
    ok(await rpc('link_employee_login', { p_employee: employeeId, p_staff: staffId || null, p_track: track, p_shift_start: shiftStart }));
export const checkPresence = async () => ok(await rpc('check_presence'));
export const getNotificationMatrix = async () => ok(await rpc('notification_matrix'));
export const setNotificationPref = async (person, kind, style) => ok(await rpc('set_notification_pref', { p_person: person, p_kind: kind, p_style: style }));
export const setQuietHours = async (person, from, to) => ok(await rpc('set_quiet_hours', { p_person: person, p_from: from || null, p_to: to || null }));
export const getMyNotificationPrefs = async () => ok(await rpc('my_notification_prefs'));
export const savePushSubscription = async (endpoint, keys, platform = 'web') =>
    ok(await rpc('save_push_subscription', { p_endpoint: endpoint, p_keys: keys, p_platform: platform }));

// ---------------------------------------------------------------------------
// Phase 6: rewards, customer portal, Instagram, feedback, groups, incentives
// ---------------------------------------------------------------------------
export const getRewardRules = async () => ok(await rpc('list_reward_rules'));
export const saveRewardRule = async (rule) => ok(await rpc('save_reward_rule', { p: rule }));
export const deleteRewardRule = async (id) => ok(await rpc('delete_reward_rule', { p_id: id }));
export const giveReward = async (ruleId, customerId, note = '') => ok(await rpc('give_reward', { p_rule: ruleId, p_customer: customerId, p_note: note }));
export const getRewardTodo = async (status = 'pending') => ok(await rpc('reward_todo', { p_status: status }));
export const markRewardSent = async (id, status = 'sent') => ok(await rpc('mark_reward_sent', { p_grant: id, p_status: status }));
export const getCustomerRewards = async (customerId) => ok(await rpc('customer_rewards', { p_customer: customerId }));
export const runRewardChecks = async () => ok(await rpc('run_reward_checks'));
export const getPortalConfig = async () => ok(await rpc('portal_config'));

// Collect-your-order screen
export const getPickupBoard = async (key, preview = false) => ok(await rpc('pickup_board', { p_key: key, p_preview: preview }));
export const getPickupStaffBoard = async () => ok(await rpc('pickup_staff_board'));
export const getPickupScreens = async () =>
    ok(unwrap(await supabase.from('pickup_screens').select('id, name, key, last_seen_at, created_at').order('created_at')));
export const createPickupScreen = async (name) => ok(await rpc('create_pickup_screen', { p_name: name }));
export const deletePickupScreen = async (id) => ok(await rpc('delete_pickup_screen', { p_id: id }));
export const getMyRewards = async () => ok(await rpc('my_rewards'));

// FiKA Club: monthly tiers, Members Club, birthdays
export const getClubPublicConfig = async () => ok(await rpc('club_public_config'));
export const getMyClub = async () => ok(await rpc('my_club'));
export const setMyBirthday = async (day, month) => ok(await rpc('set_my_birthday', { p_day: Number(day), p_month: Number(month) }));
export const requestBirthdayChange = async (day, month, reason) =>
    ok(await rpc('request_birthday_change', { p_day: Number(day), p_month: Number(month), p_reason: reason }));
export const requestClubJoin = async (level = null) => ok(await rpc('request_club_join', { p_level: level }));
export const getClubConfig = async () => ok(await rpc('club_config'));
export const saveClubConfig = async (cfg) => ok(await rpc('save_club_config', { p: cfg }));
export const getClubMembers = async () => ok(await rpc('club_members'));
export const activateClubMembership = async (customerId, level, method, override = false) =>
    ok(await rpc('activate_club_membership', { p_customer: customerId, p_level: Number(level), p_method: method, p_override: override }));
export const cancelClubMembership = async (id, reason) => ok(await rpc('cancel_club_membership', { p_id: id, p_reason: reason }));
export const getClubLeaderboard = async (period = 'month') => ok(await rpc('club_leaderboard', { p_period: period, p_limit: 200 }));
export const giveSpecialReward = async (customerIds, reward) => ok(await rpc('give_special_reward', { p_customers: customerIds, p: reward }));
export const getBirthdayRequests = async (status = 'open') => ok(await rpc('birthday_requests_list', { p_status: status }));
export const decideBirthdayRequest = async (id, approve, note = '') =>
    ok(await rpc('decide_birthday_request', { p_id: id, p_approve: approve, p_note: note }));
export const getBirthdayDuplicates = async () => ok(await rpc('birthday_duplicates'));

// Table ordering: QR codes, shared tables, moving tables; the owner's customer-app banners
export const resolveTable = async (code) => ok(await rpc('resolve_table', { p_code: code }));
export const moveMyTable = async (code) => ok(await rpc('move_my_table', { p_code: code }));
export const getCheckoutInfo = async () => ok(await rpc('my_checkout_info'));
export const getTableCodes = async () =>
    ok(Object.fromEntries(unwrap(await supabase.from('table_codes').select('table_id, code')).map(r => [r.table_id, r.code])));
export const reissueTableCode = async (tableId) => ok(await rpc('reissue_table_code', { p_table_id: tableId }));
export const getTableGroups = async () => ok(await rpc('table_groups'));
export const confirmTableOrder = async (orderId) => ok(await rpc('confirm_table_order', { p_order_id: orderId }));
export const moveOrderTable = async (orderId, tableId, wholeGroup = true) =>
    ok(await rpc('move_order_table', { p_order_id: orderId, p_table_id: tableId, p_whole_group: wholeGroup }));
export const savePortalBanners = async (banners) => ok(await rpc('save_portal_banners', { p_banners: banners }));
export const uploadBannerImage = async (file) => uploadImage(file, 'banners');
export const setMyDates = async (birthday, anniversary) => ok(await rpc('set_my_dates', { p_birthday: birthday || null, p_anniversary: anniversary || null }));
export const uploadCustomerSelfie = async (file, tenantId, customerId) => {
    const body = await shrinkImage(file);
    const path = `${tenantId}/${customerId}/ig-${Date.now()}.webp`;
    unwrap(await supabase.storage.from('customer-private').upload(path, body, { contentType: body.type }));
    return path;
};
export const customerPhotoUrl = async (path) => {
    if (!path) return null;
    const { data } = await supabase.storage.from('customer-private').createSignedUrl(path, 600);
    return data?.signedUrl || null;
};
export const submitInstagramClaim = async (handle, kind, selfiePath) =>
    ok(await rpc('submit_instagram_claim', { p_handle: handle, p_kind: kind, p_selfie_path: selfiePath }));
export const getInstagramQueue = async (status = 'pending') => ok(await rpc('instagram_queue', { p_status: status }));
export const decideInstagram = async (id, approve, reason = '') => ok(await rpc('decide_instagram', { p_claim: id, p_approve: approve, p_reason: reason }));
// Selfies older than 30 days: delete the files, then mark them gone
export const purgeOldSelfies = async () => {
    const list = await rpc('expired_instagram_selfies');
    if (!list.length) return 0;
    await supabase.storage.from('customer-private').remove(list.map(x => x.path));
    await rpc('mark_selfies_purged', { p_ids: list.map(x => x.id) });
    return list.length;
};
export const getFeedbackForm = async (orderId) => ok(await rpc('order_feedback_form', { p_order: orderId }));
export const submitDishFeedback = async (orderId, ratings) => ok(await rpc('submit_dish_feedback', { p_order: orderId, p_ratings: ratings }));
export const getFeedbackOverview = async (from, to) => ok(await rpc('feedback_overview', { p_from: from, p_to: to }));
export const moderateFeedback = async (id, reply, hidden) => ok(await rpc('moderate_feedback', { p_id: id, p_reply: reply, p_hidden: hidden }));
export const getCustomerGroups = async (group = null) => ok(await rpc('customer_groups', { p_group: group }));
export const getIncentiveReport = async (from, to) => ok(await rpc('incentive_report', { p_from: from, p_to: to }));
export const saveIncentiveRule = async (rule) => ok(await rpc('save_incentive_rule', { p: rule }));
export const deleteIncentiveRule = async (id) => ok(await rpc('delete_incentive_rule', { p_id: id }));
export const getMyIncentives = async () => ok(await rpc('my_incentives'));

// ---------------------------------------------------------------------------
// Phase 7: profit engine, menu matrix, aggregator import
// ---------------------------------------------------------------------------
export const runProfitChecks = async () => ok(await rpc('run_profit_checks'));
export const getProfitSuggestions = async (status = 'open') => ok(await rpc('profit_suggestions', { p_status: status }));
export const decideSuggestion = async (id, decision, reason = '', days = 14) =>
    ok(await rpc('decide_suggestion', { p_id: id, p_decision: decision, p_reason: reason, p_days: days }));
export const applySuggestionPrice = async (id, price) => ok(await rpc('apply_suggestion_price', { p_id: id, p_price: price }));
export const getMenuMatrix = async (from, to) => ok(await rpc('menu_matrix', { p_from: from, p_to: to }));
export const matchAggregatorItems = async (platform, names) => ok(await rpc('aggregator_match', { p_platform: platform, p_names: names }));
export const importAggregator = async (payload) => ok(await rpc('import_aggregator', { p: payload }));
export const getAggregatorImports = async () => ok(await rpc('list_aggregator_imports'));

// Support tickets: the cafe asks N.A.I.R. Solutions, the platform console answers
export const uploadSupportScreenshot = async (file, tenantId) => {
    if (!file || !tenantId) return '';
    const body = await shrinkImage(file);
    const ext = body.type === 'image/webp' ? 'webp' : body.type === 'image/png' ? 'png' : 'jpg';
    const path = `${tenantId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    unwrap(await supabase.storage.from('support').upload(path, body, { contentType: body.type }));
    return path;
};
export const supportScreenshotUrl = async (path) => {
    if (!path) return null;
    const { data } = await supabase.storage.from('support').createSignedUrl(path, 600);
    return data?.signedUrl || null;
};
export const createSupportTicket = async (t) => ok(await rpc('create_support_ticket', { p: t }));
export const getMySupportTickets = async () => ok(await rpc('my_support_tickets'));
export const replySupportTicket = async (id, body, status = null) =>
    ok(await rpc('reply_support_ticket', { p_id: id, p_body: body || '', p_status: status }));
export const markSupportRead = async (id) => ok(await rpc('mark_support_read', { p_id: id }));
export const saGetSupportTickets = async (status = 'active') => ok(await rpc('sa_support_tickets', { p_status: status }));

// My day: cafe daily tasks and my numbers for today
export const getMyDayExtras = async () => ok(await rpc('my_day_extras'));
export const tickDailyTask = async (id, done) => ok(await rpc('tick_daily_task', { p_id: id, p_done: done }));
export const saveDailyTasks = async (tasks) => ok(await rpc('save_daily_tasks', { p: tasks }));

// Brand & look: several settings in one save, and the cafe logo (shrunk, in images/brand/)
export const saveSettingsBatch = async (values) =>
    ok(unwrap(await supabase.from('settings').upsert(Object.entries(values).map(([key, value]) => ({ key, value }))).select('key')));
export const uploadBrandLogo = async (file) => uploadImage(file, 'brand');

// ---------------------------------------------------------------------------
// Dish choices, combos, favourites (customer app redesign)
//   cart line for a dish:  {menuItem, quantity, size, choices: [choiceId], note}
//   cart line for a combo: {combo, quantity, picks: [{menuItem, size, choices}], note}
// The server always works out the price from these; the app only shows it.
// ---------------------------------------------------------------------------
export const getDishDetail = async (id) => ok(await rpc('dish_detail', { p_id: id }));
export const getCombosOnSale = async () => ok(await rpc('combos_on_sale'));
export const getDishesWithChoices = async () => ok(await rpc('dishes_with_choices'));
// Price of each line with its size and choices: [{name, price, note, options}]
export const quoteLines = async (items) => ok(await rpc('quote_lines', { p_items: items }));
export const toggleFavourite = async (menuItemId) => ok(await rpc('toggle_favourite', { p_menu_item: menuItemId }));
export const getMyFavourites = async () => ok(await rpc('my_favourites'));
export const getMyUsual = async () => ok(await rpc('my_usual'));

// Choice groups (Milk, Sugar, Flavour…), shared by many dishes
const OPTION_GROUP = {
    name: ['name', 'text'], nameHi: ['name_hi', 'text'], pick: ['pick', 'text'],
    minPick: ['min_pick', 'int'], maxPick: ['max_pick', 'int'], choices: ['choices', 'json'], order: ['sort_order', 'int'],
};
export const getOptionGroups = async () =>
    ok(listToClient(unwrap(await supabase.from('option_groups').select().order('sort_order').order('name'))));
export const saveOptionGroup = async (id, data) => {
    const row = toDb(data, OPTION_GROUP);
    const q = id ? supabase.from('option_groups').update(row).eq('id', id) : supabase.from('option_groups').insert(row);
    return ok(toClient(unwrap(await q.select().single(), 'option_groups')));
};
export const deleteOptionGroup = async (id) => {
    removed(await supabase.from('option_groups').delete().eq('id', id).select('id'));
    return ok({ message: 'Deleted' });
};

// Combos: slots [{name, nameHi, items: [{menuItem, extra}]}], days 0 (Sunday)…6, times 'HH:MM'
const COMBO = {
    name: ['name', 'text'], nameHi: ['name_hi', 'text'], description: ['description', 'text'], image: ['image', 'text'],
    art: ['art', 'text'], bg: ['bg', 'text'], price: ['price', 'num'], slots: ['slots', 'json'], days: ['days', 'list'],
    timeFrom: ['time_from', 'textOrNull'], timeTo: ['time_to', 'textOrNull'], isActive: ['is_active', 'bool'],
    doublePoints: ['double_points', 'bool'], suggest: ['suggest', 'bool'], taxGroup: ['tax_group_id', 'uuid'],
    order: ['sort_order', 'int'],
};
export const getCombos = async () =>
    ok(listToClient(unwrap(await supabase.from('combos').select().order('sort_order').order('name'))));
export const saveCombo = async (id, data) => {
    const row = toDb(data, COMBO);
    const image = await uploadImage(imageFrom(data), 'combos');
    if (image) row.image = image;
    const q = id ? supabase.from('combos').update(row).eq('id', id) : supabase.from('combos').insert(row);
    return ok(toClient(unwrap(await q.select().single(), 'combos')));
};
export const deleteCombo = async (id) => {
    removed(await supabase.from('combos').delete().eq('id', id).select('id'));
    return ok({ message: 'Deleted' });
};
