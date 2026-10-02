import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { FiDownload, FiHelpCircle } from 'react-icons/fi';
import {
    getPnl, getCashFlow, getProfitTargets, getGstPack, getGstDueDates, getItemEconomics, getSettings, updateSetting,
} from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import { downloadCsv } from '../../lib/csv';
import { inr } from '../pos/money';
import '../AdminStaff.css';
import '../AdminCatalogue.css';
import '../inventory/Inventory.css';
import '../pos/POS.css';
import './Reports.css';

const iso = (d) => d.toLocaleDateString('en-CA');
const PERIODS = {
    this_week: () => { const d = new Date(); const s = new Date(d); s.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return [iso(s), iso(d)]; },
    this_month: () => { const d = new Date(); return [iso(new Date(d.getFullYear(), d.getMonth(), 1)), iso(d)]; },
    last_month: () => { const d = new Date(); return [iso(new Date(d.getFullYear(), d.getMonth() - 1, 1)), iso(new Date(d.getFullYear(), d.getMonth(), 0))]; },
    last_30: () => { const d = new Date(); return [iso(new Date(Date.now() - 29 * 864e5)), iso(d)]; },
};
const PERIOD_LABELS = { this_week: 'This week', this_month: 'This month', last_month: 'Last month', last_30: 'Last 30 days', custom: 'Custom' };
const CHANNEL = { qr: 'QR table', dine_in: 'Counter dine-in', takeaway: 'Takeaway', kiosk: 'Kiosk', aggregator: 'Aggregator' };

const Period = ({ value, onChange }) => {
    const [kind, setKind] = useState('this_month');
    return (
        <div className="inv-toolbar">
            <select className="input compact" value={kind} aria-label="Period"
                onChange={e => { setKind(e.target.value); if (e.target.value !== 'custom') onChange(PERIODS[e.target.value]()); }}>
                {Object.entries(PERIOD_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <input className="input compact" type="date" value={value[0]} aria-label="From" onChange={e => { setKind('custom'); onChange([e.target.value, value[1]]); }} />
            <input className="input compact" type="date" value={value[1]} aria-label="To" onChange={e => { setKind('custom'); onChange([value[0], e.target.value]); }} />
        </div>
    );
};

// Costs show as "−₹X"; a negative result (a loss) also shows its minus
const signed = (v, cost) => `${(cost ? v > 0 : v < 0) ? '−' : ''}${inr(Math.abs(v))}`;

// A P&L line with the previous period and an optional "Why?" explanation
const Line = ({ label, cur, prev, strong, neg, why }) => {
    const [open, setOpen] = useState(false);
    const delta = prev ? ((cur - prev) / Math.abs(prev)) * 100 : null;
    return (
        <>
            <tr className={strong ? 'pl-strong' : ''}>
                <td>{label}{why && <button className="why" aria-label={`Why: ${label}`} onClick={() => setOpen(o => !o)}><FiHelpCircle /> Why?</button>}</td>
                <td className={`num ${!neg && cur < 0 ? 'neg' : ''}`}>{signed(cur, neg)}</td>
                <td className="num muted">{signed(prev || 0, neg)}</td>
                <td className={`num small ${delta == null ? '' : (delta >= 0) !== !!neg ? 'pos-amt' : 'neg'}`}>{delta == null ? '' : `${delta > 0 ? '+' : ''}${delta.toFixed(0)}%`}</td>
            </tr>
            {open && <tr className="why-row"><td colSpan={4}>{why}</td></tr>}
        </>
    );
};

const PnlTab = () => {
    const [period, setPeriod] = useState(PERIODS.this_month);
    const [d, setD] = useState(null);
    const [error, setError] = useState('');
    useEffect(() => { getPnl(period[0], period[1]).then(r => { setD(r.data); setError(''); }).catch(e => setError(e.message)); }, [period]);
    if (error) return <p className="error-message">{error}</p>;
    if (!d) return null;
    const c = d.current;
    const p = d.previous;
    const expensesFor = (n) => p.expenses.find(e => e.category === n)?.amount || 0;
    return (
        <div>
            <Period value={period} onChange={setPeriod} />
            <div className="table-scroll">
                <table className="staff-table pl">
                    <thead><tr><th /><th className="num">This period</th><th className="num">Previous</th><th className="num">Change</th></tr></thead>
                    <tbody>
                        {c.channels.map(ch => (
                            <Line key={ch.channel} label={`Sales · ${CHANNEL[ch.channel] || ch.channel} (${ch.orders} orders)`} cur={ch.gross}
                                prev={p.channels.find(x => x.channel === ch.channel)?.gross || 0} />
                        ))}
                        <Line label="Gross sales" cur={c.grossSales} prev={p.grossSales} strong />
                        <Line label="GST collected (paid to government)" cur={c.taxes} prev={p.taxes} neg />
                        <Line label="Net sales" cur={c.netSales} prev={p.netSales} strong
                            why="Net sales = what customers paid − GST collected − round-off. Cancelled orders are not counted." />
                        <Line label="Cost of goods sold" cur={c.cogs} prev={p.cogs} neg
                            why={<>Each order line stores its cost when sold: recipe ingredients × their average purchase cost, or the item's cost price.
                                {c.linesWithoutCost > 0 && <> <strong>{c.linesWithoutCost} lines had no cost</strong> (no recipe or cost price) — add them in <Link to="/admin/recipes">Recipes &amp; Costing</Link>.</>}</>} />
                        <Line label={`Gross profit${c.grossMarginPct != null ? ` (${c.grossMarginPct}%)` : ''}`} cur={c.grossProfit} prev={p.grossProfit} strong
                            why="Gross profit = net sales − cost of goods sold." />
                        <Line label="Wastage, staff meals, complimentary, count losses" cur={c.stockLosses} prev={p.stockLosses} neg
                            why={<>Stock that left without a sale, valued at average cost. See <Link to="/admin/inventory?tab=counts">Counts &amp; leaks</Link>.</>} />
                        <Line label={`Staff cost${c.staffCostEstimated ? ' (estimate)' : ''}`} cur={c.staffCost} prev={p.staffCost} neg
                            why={c.staffCostEstimated
                                ? 'No finalized payroll for some months: estimated from each active employee\'s monthly salary (daily wage × 26).'
                                : 'From finalized payroll (gross pay), spread over the days of each month.'} />
                        {c.expenses.map(e => (
                            <Line key={e.category} label={`Expense · ${e.category}`} cur={e.amount} prev={expensesFor(e.category)} neg />
                        ))}
                        <Line label="Expenses total" cur={c.expensesTotal} prev={p.expensesTotal} neg
                            why="Expenses entered in Finance. One spread over several months (e.g. a yearly licence) counts a share per day." />
                        <Line label="Net profit" cur={c.netProfit} prev={p.netProfit} strong
                            why="Net profit = gross profit − stock losses − staff cost − expenses. Purchases aren't counted here: their cost appears when the stock is sold (cost of goods)." />
                    </tbody>
                </table>
            </div>
        </div>
    );
};

const CashTab = () => {
    const [period, setPeriod] = useState(PERIODS.this_month);
    const [rows, setRows] = useState([]);
    useEffect(() => { getCashFlow(period[0], period[1]).then(r => setRows(r.data)); }, [period]);
    return (
        <div>
            <Period value={period} onChange={setPeriod} />
            <div className="table-scroll">
                <table className="staff-table">
                    <thead><tr><th>Account</th><th className="num">Opening</th><th className="num">Money in</th><th className="num">Money out</th><th className="num">Closing</th></tr></thead>
                    <tbody>{rows.map(a => (
                        <tr key={a.code}><td>{a.name}</td><td className="num">{inr(a.opening)}</td><td className="num pos-amt">{inr(a.in)}</td>
                            <td className="num neg">{inr(a.out)}</td><td className="num"><strong>{inr(a.closing)}</strong></td></tr>
                    ))}</tbody>
                </table>
            </div>
            <p className="muted small">Closing = opening + money in − money out, from the money ledger.</p>
        </div>
    );
};

const Progress = ({ title, t }) => {
    const pct = t.target > 0 ? Math.max(0, Math.min(100, (t.profit / t.target) * 100)) : 0;
    const fpct = t.target > 0 ? Math.round((t.forecast / t.target) * 100) : null;
    return (
        <section className="panel">
            <h2>{title}</h2>
            <p className="muted small">{t.daysGone} of {t.days} days</p>
            <div className="big-num">{inr(t.profit)} <span className="muted">of {t.target > 0 ? inr(t.target) : 'no target'}</span></div>
            {t.target > 0 && <div className="progress"><i style={{ width: `${pct}%` }} className={fpct < 100 ? 'behind' : ''} /></div>}
            <p>Forecast for the period: <strong className={fpct != null && fpct < 100 ? 'neg' : 'pos-amt'}>{inr(t.forecast)}</strong>
                {fpct != null && ` (${fpct}% of target)`}</p>
            <p className="muted small">Forecast = net profit so far ÷ days gone × days in the period.</p>
        </section>
    );
};

const TargetsTab = () => {
    const { hasPerm } = useAuth();
    const [t, setT] = useState(null);
    const [s, setS] = useState({ week: '', month: '' });
    const load = () => getProfitTargets().then(r => { setT(r.data); setS({ week: r.data.week.target, month: r.data.month.target }); });
    useEffect(() => { load(); }, []);
    const save = async () => {
        await updateSetting('profit_target_weekly', Number(s.week) || 0);
        await updateSetting('profit_target_monthly', Number(s.month) || 0);
        load();
    };
    if (!t) return null;
    return (
        <div>
            <div className="finance-grid">
                <Progress title="This week" t={t.week} />
                <Progress title="This month" t={t.month} />
            </div>
            {hasPerm('settings.edit') && (
                <div className="inv-toolbar" style={{ marginTop: 16 }}>
                    <label className="small">Weekly target ₹ <input className="input compact" type="number" value={s.week} onChange={e => setS({ ...s, week: e.target.value })} /></label>
                    <label className="small">Monthly target ₹ <input className="input compact" type="number" value={s.month} onChange={e => setS({ ...s, month: e.target.value })} /></label>
                    <button className="btn btn-primary" onClick={save}>Save targets</button>
                </div>
            )}
        </div>
    );
};

const GstTab = () => {
    const { hasPerm } = useAuth();
    const [period, setPeriod] = useState(PERIODS.last_month);
    const [g, setG] = useState(null);
    const [due, setDue] = useState([]);
    const [filing, setFiling] = useState('monthly');
    useEffect(() => { getGstPack(period[0], period[1]).then(r => setG(r.data)); }, [period]);
    useEffect(() => {
        getGstDueDates().then(r => setDue(r.data));
        getSettings().then(r => setFiling(r.data.gst_filing || 'monthly'));
    }, [filing]);
    const saveFiling = async (v) => { await updateSetting('gst_filing', v); setFiling(v); };
    if (!g) return null;
    const name = `${period[0]}_to_${period[1]}`;
    return (
        <div>
            <Period value={period} onChange={setPeriod} />
            <div className="finance-grid">
                <section className="panel">
                    <h2>Upcoming due dates</h2>
                    {due.map(d => <p key={d.form + d.due}><strong>{d.form}</strong> for {d.for} · due {new Date(d.due).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                        <span className={`pill ${d.daysLeft <= 3 ? 'warn' : 'muted'}`}>{d.daysLeft} days</span></p>)}
                    {due.length === 0 && <p className="muted">Nothing due in the next 45 days.</p>}
                    <label className="small">Filing type{' '}
                        <select className="input compact" value={filing} disabled={!hasPerm('settings.edit')} onChange={e => saveFiling(e.target.value)}>
                            <option value="monthly">Monthly (GSTR-1 + 3B)</option><option value="quarterly">Quarterly (QRMP)</option>
                            <option value="composition">Composition (CMP-08)</option><option value="none">Not registered</option>
                        </select></label>
                    <p className="muted small">Your CA files on the GST portal; the bell reminds you 3 days before each date. Confirm dates with your CA (state-wise QRMP dates differ).</p>
                </section>
                <section className="panel">
                    <h2>Downloads for the CA</h2>
                    <p className="muted small">GSTIN {g.gstin || '—'} · bills {g.orders.first} … {g.orders.last} ({g.orders.count}, {g.orders.cancelled} cancelled)</p>
                    <div className="btn-row">
                        <button className="btn btn-ghost btn-sm" onClick={() => downloadCsv(`gst-sales-by-rate_${name}.csv`, ['GST rate %', 'Taxable value', 'CGST', 'SGST', 'Total tax'],
                            g.byRate.map(r => [r.rate, r.taxable, r.cgst, r.sgst, r.tax]))}><FiDownload /> Sales by rate</button>
                        <button className="btn btn-ghost btn-sm" onClick={() => downloadCsv(`gst-hsn_${name}.csv`, ['HSN/SAC', 'Rate %', 'Quantity', 'Taxable value', 'Tax'],
                            g.hsn.map(r => [r.code, r.rate, r.qty, r.taxable, r.tax]))}><FiDownload /> HSN/SAC summary</button>
                        <button className="btn btn-ghost btn-sm" onClick={() => downloadCsv(`gst-purchases_${name}.csv`, ['Date', 'Vendor', 'Vendor GSTIN', 'Bill no', 'Taxable', 'Tax', 'Total'],
                            g.purchases.map(p => [p.date, p.vendor, p.gstin, p.billNumber, p.taxable, p.tax, p.total]))}><FiDownload /> Purchases</button>
                    </div>
                </section>
            </div>
            <h2 className="section-title">Sales by GST rate</h2>
            <div className="table-scroll">
                <table className="staff-table">
                    <thead><tr><th>Rate</th><th className="num">Taxable value</th><th className="num">CGST</th><th className="num">SGST</th><th className="num">Total tax</th></tr></thead>
                    <tbody>{g.byRate.map(r => <tr key={r.rate}><td>{r.rate}%</td><td className="num">{inr(r.taxable)}</td><td className="num">{inr(r.cgst)}</td>
                        <td className="num">{inr(r.sgst)}</td><td className="num">{inr(r.tax)}</td></tr>)}
                        {g.byRate.length === 0 && <tr><td colSpan={5} className="muted">No sales in this period.</td></tr>}</tbody>
                </table>
            </div>
        </div>
    );
};

const ItemsTab = () => {
    const [period, setPeriod] = useState(PERIODS.last_30);
    const [rows, setRows] = useState([]);
    useEffect(() => { getItemEconomics(period[0], period[1]).then(r => setRows(r.data)); }, [period]);
    return (
        <div>
            <Period value={period} onChange={setPeriod} />
            <div className="table-scroll">
                <table className="staff-table">
                    <thead><tr><th>Item</th><th className="num">Sold</th><th className="num">Net sales</th><th className="num">Cost</th>
                        <th className="num">Contribution</th><th className="num">Per unit</th><th className="num">Share of profit</th><th className="num">Trend</th></tr></thead>
                    <tbody>{rows.map(r => (
                        <tr key={r.menuItemId || r.name}>
                            <td><strong>{r.name}</strong>{!r.costKnown && <span className="pill warn">cost unknown</span>}
                                {r.menuItemId && <Link className="why" to="/admin/recipes">Why?</Link>}</td>
                            <td className="num">{r.units}</td><td className="num">{inr(r.revenue)}</td><td className="num">{inr(r.cost)}</td>
                            <td className="num"><strong>{inr(r.contribution)}</strong>{r.contributionPct != null && <span className="muted small"> {r.contributionPct}%</span>}</td>
                            <td className="num">{inr(r.perUnit)}</td>
                            <td className="num">{r.sharePct != null ? `${r.sharePct}%` : '—'}</td>
                            <td className={`num ${r.trendPct < 0 ? 'neg' : 'pos-amt'}`}>{r.trendPct == null ? 'new' : `${r.trendPct > 0 ? '+' : ''}${r.trendPct}%`}</td>
                        </tr>
                    ))}{rows.length === 0 && <tr><td colSpan={8} className="muted">No sales in this period.</td></tr>}</tbody>
                </table>
            </div>
            <p className="muted small">Contribution = net sales − cost (what each item adds to profit). Trend compares units sold with the previous period of the same length.</p>
        </div>
    );
};

const TABS = [['pnl', 'Profit & loss'], ['cash', 'Cash flow'], ['targets', 'Profit target'], ['items', 'Item profit'], ['gst', 'GST']];

const AdminReports = () => {
    const [params, setParams] = useSearchParams();
    const tab = TABS.some(([k]) => k === params.get('tab')) ? params.get('tab') : 'pnl';
    return (
        <div className="finance-page inv reports-page">
            <div className="page-header"><h1>Reports</h1><p>Profit and loss, cash flow, targets, item profit and the GST pack — every number explained.</p></div>
            <div className="tabs" role="tablist">
                {TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''}
                    onClick={() => setParams(k === 'pnl' ? {} : { tab: k })}>{l}</button>)}
            </div>
            {tab === 'pnl' && <PnlTab />}
            {tab === 'cash' && <CashTab />}
            {tab === 'targets' && <TargetsTab />}
            {tab === 'items' && <ItemsTab />}
            {tab === 'gst' && <GstTab />}
        </div>
    );
};

export default AdminReports;
