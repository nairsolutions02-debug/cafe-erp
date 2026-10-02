import React from 'react';

export const NOTES = [500, 200, 100, 50, 20, 10, 5, 2, 1];
export const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
export const denomTotal = (d) => Object.entries(d || {}).reduce((a, [k, v]) => a + Number(k) * (Number(v) || 0), 0);

// Count cash by note: ₹500 × 4, ₹100 × 10 …
export const Denominations = ({ value, onChange }) => (
    <div className="denoms">
        {NOTES.map(n => (
            <label key={n} className="denom">
                <span>₹{n}</span>
                <span>×</span>
                <input className="input" type="number" min="0" inputMode="numeric" aria-label={`₹${n} notes`}
                    value={value[n] ?? ''} onChange={e => onChange({ ...value, [n]: e.target.value === '' ? '' : Math.max(0, parseInt(e.target.value, 10) || 0) })} />
                <span className="num">{inr(n * (Number(value[n]) || 0))}</span>
            </label>
        ))}
        <div className="denom total"><span>Total</span><strong>{inr(denomTotal(value))}</strong></div>
    </div>
);

// Line totals estimated on the device (used offline; the database prices the real bill)
export function estimateTotal(lines, items, taxGroups, defaultTax, discount = 0) {
    const rateOf = (item) => {
        const comps = taxGroups.find(g => g.id === item?.tax_group_id)?.components || defaultTax || [];
        return comps.reduce((a, c) => a + Number(c.rate || 0), 0);
    };
    let total = 0;
    let base = 0;
    let rateSum = 0;
    lines.forEach(l => {
        const item = items.find(i => i.id === l.menuItemId);
        const t = l.price * l.qty;
        const r = rateOf(item);
        total += item?.price_includes_tax ? t : t * (1 + r / 100);
        if (!item?.is_restricted) { base += t; rateSum += r * t; }
    });
    const avgRate = base > 0 ? rateSum / base : 0;
    return Math.max(0, Math.round((total - Math.min(discount, base) * (1 + avgRate / 100)) * 100) / 100);
}
