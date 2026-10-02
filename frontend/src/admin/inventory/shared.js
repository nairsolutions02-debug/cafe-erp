// Formatting and labels shared by the inventory screens

export const errorText = (err, fallback) => err?.response?.data?.message || err?.message || fallback;

const num = (n, max = 2) => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: max });

// 2600 ml → "2.6 L", 1500 g → "1.5 kg", 12 pc → "12 pc"
export const fmtQty = (q, unit) => {
    if (q == null) return '—';
    const v = Number(q);
    if (unit === 'g' && Math.abs(v) >= 1000) return `${num(v / 1000, 3)} kg`;
    if (unit === 'ml' && Math.abs(v) >= 1000) return `${num(v / 1000, 3)} L`;
    return `${num(v, 3)} ${unit || ''}`.trim();
};

export const fmtMoney = (n, digits = 2) =>
    n == null ? '—' : `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: digits })}`;

// Per-unit costs of g/ml items are tiny; show them per kg / L as well
export const fmtUnitCost = (cost, unit) => {
    if (cost == null) return '—';
    if (unit === 'g') return `${fmtMoney(cost * 1000)} / kg`;
    if (unit === 'ml') return `${fmtMoney(cost * 1000)} / L`;
    return `${fmtMoney(cost)} / ${unit}`;
};

export const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '');
export const fmtDateTime = (d) =>
    d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
export const today = () => new Date().toLocaleDateString('en-CA');

export const CATEGORIES = [
    { value: 'ingredient', label: 'Ingredient' },
    { value: 'resale', label: 'Resale product' },
    { value: 'packaging', label: 'Packaging / consumable' },
    { value: 'equipment', label: 'Equipment' },
    { value: 'other', label: 'Other' },
];
export const categoryLabel = (c) => CATEGORIES.find(x => x.value === c)?.label || c;

export const UNITS = ['g', 'ml', 'pc', 'kg', 'L', 'pack', 'box', 'bottle', 'dozen'];

export const COUNT_FREQUENCIES = [
    { value: 'daily', label: 'Daily (milk, paneer, cigarettes)' },
    { value: 'weekly', label: 'Weekly' },
    { value: 'monthly', label: 'Monthly' },
    { value: 'never', label: "Don't count" },
];

export const MOVE_KINDS = {
    opening: 'Opening stock',
    purchase: 'Purchase',
    purchase_void: 'Purchase undone',
    sale: 'Sale',
    sale_reversal: 'Order cancelled',
    transfer: 'Transfer',
    wastage: 'Wastage',
    staff_meal: 'Staff meal',
    complimentary: 'Complimentary',
    adjustment: 'Adjustment',
    count: 'Count correction',
};

export const WASTAGE_REASONS = ['Spoiled', 'Expired', 'Dropped / spilled', 'Burnt / wrong order', 'Other'];

export const PAYMENT_MODES = [
    { value: 'cash', label: 'Cash' },
    { value: 'upi', label: 'UPI' },
    { value: 'bank', label: 'Bank transfer' },
    { value: 'card', label: 'Card' },
    { value: 'credit', label: 'Credit (pay later)' },
];

// Units an item can be bought or counted in: its base unit plus pack units
export const unitOptions = (item) => [
    { name: item?.unit || 'unit', factor: 1 },
    ...((item?.units || []).map(u => ({ name: u.name, factor: Number(u.factor) }))),
];

// The status shown next to a stock item
export const stockStatus = (item) => {
    if (!item.trackStock) return { label: 'Not tracked', tone: 'muted' };
    if (Number(item.totalQuantity) < 0) return { label: 'Below zero', tone: 'warn' };
    // Sales took more from a location than it had: usually a missing transfer or purchase
    const short = (item.levels || []).find(l => Number(l.quantity) < 0);
    if (short) return { label: `${short.name} below zero`, tone: 'warn', hint: 'Transfer stock there, or record the purchase that arrived' };
    if (item.reorder) return { label: 'Reorder', tone: 'warn' };
    return { label: 'OK', tone: 'ok' };
};

// "1.4 days left, vendor needs 1 day" style explanation for the reorder flag
export const reorderReason = (item) => {
    const parts = [];
    if (item.daysLeft != null) parts.push(`${num(item.daysLeft, 1)} days left at ${fmtQty(item.dailyUse, item.unit)}/day`);
    if (Number(item.minimumStock) > 0 && Number(item.totalQuantity) <= Number(item.minimumStock)) {
        parts.push(`at or below reorder level ${fmtQty(item.minimumStock, item.unit)}`);
    }
    parts.push(`${item.vendorName || 'vendor'} needs ${item.leadTime} day${item.leadTime === 1 ? '' : 's'}`);
    return parts.join(' · ');
};

// Suggested order in the biggest pack that fits: 30000 ml with Crate = 12000 → "3 Crate (36 L)"
export const suggestedOrder = (item) => {
    const qty = Number(item.suggestedQty || 0);
    if (qty <= 0) return null;
    const packs = (item.units || []).filter(u => Number(u.factor) > 1 && Number(u.factor) <= qty)
        .sort((a, b) => Number(b.factor) - Number(a.factor));
    if (packs.length) {
        const n = Math.ceil(qty / Number(packs[0].factor));
        return { text: `${n} ${packs[0].name}`, detail: fmtQty(n * Number(packs[0].factor), item.unit) };
    }
    return { text: fmtQty(qty, item.unit), detail: '' };
};

export const whatsappLink = (phone, text) => {
    const digits = String(phone || '').replace(/\D/g, '');
    const to = digits.length === 10 ? `91${digits}` : digits;
    return `https://wa.me/${to}?text=${encodeURIComponent(text)}`;
};
