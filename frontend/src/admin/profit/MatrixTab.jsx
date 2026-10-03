import React, { useCallback, useEffect, useState } from 'react';
import { ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer, LabelList } from 'recharts';
import { getMenuMatrix } from '../../utils/api';
import { inr } from '../pos/money';

// Categorical slots 1–4 of the validated chart palette (labels + table carry identity too)
export const CLASSES = [
    { key: 'star', label: 'Star', color: '#2a78d6', advice: 'Popular and profitable: keep quality and price, feature it.' },
    { key: 'plowhorse', label: 'Plowhorse', color: '#eb6834', advice: 'Popular but earns little: raise price a little or cut recipe cost.' },
    { key: 'puzzle', label: 'Puzzle', color: '#1baf7a', advice: 'Profitable but few sell: promote, rename, move up the menu.' },
    { key: 'dog', label: 'Dog', color: '#eda100', advice: 'Few sell and earns little: rework or remove.' },
];
const iso = (d) => d.toLocaleDateString('en-CA');

const Tip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const p = payload[0].payload;
    return (
        <div className="mx-tip">
            <strong>{p.name}</strong>
            <span>{p.units} sold · {inr(p.cmPerUnit)} profit each</span>
            <span>{CLASSES.find(c => c.key === p.class)?.label}</span>
        </div>
    );
};

// Menu engineering (Kasavana & Smith): units sold × profit per unit, split at the menu's averages
const MatrixTab = () => {
    const [range, setRange] = useState({ from: iso(new Date(Date.now() - 29 * 864e5)), to: iso(new Date()) });
    const [m, setM] = useState(null);
    const [error, setError] = useState('');
    const load = useCallback(async () => {
        try { setM((await getMenuMatrix(range.from, range.to)).data); } catch (err) { setError(err?.response?.data?.message || err.message); }
    }, [range]);
    useEffect(() => { load(); }, [load]);
    if (!m) return <p>{error || 'Loading…'}</p>;
    return (
        <div className="matrix viz-root">
            <div className="inv-toolbar">
                <input className="input compact" type="date" value={range.from} onChange={e => setRange({ ...range, from: e.target.value })} aria-label="From" />
                <input className="input compact" type="date" value={range.to} onChange={e => setRange({ ...range, to: e.target.value })} aria-label="To" />
            </div>
            <div className="mx-legend" aria-label="Legend">
                {CLASSES.map(c => <span key={c.key}><i style={{ background: c.color }} />{c.label} ({m.items.filter(i => i.class === c.key).length})</span>)}
            </div>
            <div className="mx-chart" role="img" aria-label="Menu matrix: units sold against profit per unit">
                <ResponsiveContainer width="100%" height={340}>
                    <ScatterChart margin={{ top: 12, right: 16, bottom: 28, left: 8 }}>
                        <CartesianGrid stroke="var(--bg-secondary)" />
                        <XAxis type="number" dataKey="units" name="Sold" domain={[0, (max) => Math.ceil(max * 1.1) + 1]} tick={{ fontSize: 12, fill: 'var(--text-muted)' }}
                            label={{ value: 'Units sold →', position: 'insideBottom', offset: -16, fill: 'var(--text-secondary)', fontSize: 12 }} />
                        <YAxis type="number" dataKey="cmPerUnit" name="Profit each" domain={[(min) => Math.min(0, Math.floor(min)), (max) => Math.ceil(max * 1.15 / 10) * 10]} tick={{ fontSize: 12, fill: 'var(--text-muted)' }} tickFormatter={v => `₹${v}`}
                            label={{ value: 'Profit each →', angle: -90, position: 'insideLeft', fill: 'var(--text-secondary)', fontSize: 12 }} />
                        {m.popularityThreshold != null && <ReferenceLine x={Number(m.popularityThreshold)} stroke="var(--text-muted)" strokeDasharray="4 4" />}
                        {m.avgCmPerUnit != null && <ReferenceLine y={Number(m.avgCmPerUnit)} stroke="var(--text-muted)" strokeDasharray="4 4" />}
                        <ZAxis range={[140, 140]} />
                        <Tooltip content={<Tip />} cursor={false} />
                        {CLASSES.map(c => (
                            <Scatter key={c.key} name={c.label} data={m.items.filter(i => i.class === c.key).map(i => ({ ...i, units: Number(i.units), cmPerUnit: Number(i.cmPerUnit) }))}
                                fill={c.color} stroke="var(--bg-card)" strokeWidth={2} shape="circle">
                                {m.items.length <= 12 && <LabelList dataKey="name" position="top" offset={10} style={{ fontSize: 11, fill: 'var(--text-secondary)' }} />}
                            </Scatter>
                        ))}
                    </ScatterChart>
                </ResponsiveContainer>
            </div>
            <p className="muted small">Dashed lines: 70% of an even share of units ({m.popularityThreshold ?? '—'}) and the average profit per unit ({m.avgCmPerUnit != null ? inr(m.avgCmPerUnit) : '—'}).
                {m.withoutCost > 0 && ` ${m.withoutCost} items without a recipe or cost are left out.`}</p>
            <div className="mx-quads">{CLASSES.map(c => <p key={c.key} className="small"><i style={{ background: c.color }} /> <strong>{c.label}</strong>: {c.advice}</p>)}</div>
            <div className="table-scroll">
                <table className="staff-table">
                    <thead><tr><th>Item</th><th>Group</th><th>Sold</th><th>Mix %</th><th>Profit each</th><th>Total profit</th></tr></thead>
                    <tbody>{m.items.map(i => (
                        <tr key={i.menuItemId}><td><strong>{i.name}</strong></td><td>{CLASSES.find(c => c.key === i.class)?.label}</td><td>{i.units}</td>
                            <td>{i.mixPct}%</td><td>{inr(i.cmPerUnit)}</td><td>{inr(i.contribution)}</td></tr>))}
                        {m.items.length === 0 && <tr><td colSpan={6} className="muted">No sales with known costs in this period. Add recipes in Recipes & Costing.</td></tr>}</tbody>
                </table>
            </div>
        </div>
    );
};

export default MatrixTab;
