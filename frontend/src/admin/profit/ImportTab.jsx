import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FiUpload } from 'react-icons/fi';
import { matchAggregatorItems, importAggregator, getAggregatorImports, getAllMenuItems } from '../../utils/api';
import { parseCsv } from '../../lib/csv';
import { inr } from '../pos/money';

const errorText = (err) => err?.response?.data?.message || err?.message || 'Something went wrong';
const FIELDS = [
    { key: 'orderId', label: 'Order ID', guess: /order.?(id|no|number)|^id$/i },
    { key: 'date', label: 'Date', guess: /date|time|placed/i },
    { key: 'item', label: 'Item name', guess: /item|dish|product|name/i },
    { key: 'qty', label: 'Quantity', guess: /qty|quantity|count/i },
    { key: 'amount', label: 'Line amount (₹)', guess: /item.?total|amount|price|value|total/i },
];
// "03/10/2026", "2026-10-03 13:20", "3 Oct 2026" → ISO date or datetime the database understands
const toDate = (s) => {
    const t = String(s || '').trim();
    let m = t.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?/);
    if (m) return m[4] ? `${m[1]}-${m[2]}-${m[3]} ${m[4].padStart(2, '0')}:${m[5]}` : `${m[1]}-${m[2]}-${m[3]}`;
    m = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:[ ,]+(\d{1,2}):(\d{2}))?/);
    if (m) {
        const d = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
        return m[4] ? `${d} ${m[4].padStart(2, '0')}:${m[5]}` : d;
    }
    const p = new Date(t);
    return Number.isNaN(p.getTime()) ? null : p.toLocaleDateString('en-CA');
};
const num = (s) => Number(String(s ?? '').replace(/[₹,\s]/g, '')) || 0;

// Weekly import of the Swiggy / Zomato / Petpooja order report (CSV)
const ImportTab = () => {
    const [platform, setPlatform] = useState('swiggy');
    const [file, setFile] = useState(null);
    const [table, setTable] = useState(null);
    const [cols, setCols] = useState({});
    const [matches, setMatches] = useState({});
    const [menu, setMenu] = useState([]);
    const [commission, setCommission] = useState('');
    const [account, setAccount] = useState('bank');
    const [msg, setMsg] = useState('');
    const [history, setHistory] = useState([]);
    const loadHistory = useCallback(async () => setHistory((await getAggregatorImports()).data), []);
    useEffect(() => { loadHistory(); getAllMenuItems().then(r => setMenu(r.data)).catch(() => {}); }, [loadHistory]);

    const pick = async (e) => {
        const f = e.target.files[0];
        if (!f) return;
        setMsg('');
        const rows = parseCsv(await f.text());
        if (rows.length < 2) { setMsg('The file has no rows'); return; }
        const [head, ...body] = rows;
        const guess = {};
        FIELDS.forEach(fd => { const i = head.findIndex((h, n) => fd.guess.test(h) && !Object.values(guess).includes(n)); if (i >= 0) guess[fd.key] = i; });
        setFile(f.name);
        setTable({ head, body });
        setCols(guess);
    };

    const rows = useMemo(() => {
        if (!table || FIELDS.some(f => cols[f.key] == null)) return [];
        return table.body.map(r => ({
            orderId: r[cols.orderId], date: toDate(r[cols.date]), item: r[cols.item], qty: Math.max(1, Math.round(num(r[cols.qty]))),
            amount: num(r[cols.amount]),
        })).filter(r => r.orderId && r.item && r.amount > 0);
    }, [table, cols]);
    const names = useMemo(() => [...new Set(rows.map(r => r.item))], [rows]);
    useEffect(() => {
        if (!names.length) { setMatches({}); return; }
        matchAggregatorItems(platform, names).then(r => setMatches(Object.fromEntries(r.data.map(m => [m.name, m.menuItemId || ''])))).catch(err => setMsg(errorText(err)));
    }, [names, platform]);

    const orders = new Set(rows.map(r => r.orderId)).size;
    const gross = rows.reduce((a, r) => a + r.amount, 0);
    const badDates = rows.filter(r => !r.date).length;
    const unmatched = names.filter(n => !matches[n]);

    const run = async () => {
        setMsg('');
        try {
            const r = (await importAggregator({ platform, fileName: file, rows, commission: Number(commission) || 0, payoutAccount: account, mappings: matches })).data;
            setMsg(`Imported ${r.imported} orders (${inr(r.gross)}), ${r.skipped} already imported. Commission ${inr(r.commission)} recorded as an expense; payout ${inr(r.payout)} into ${account}.`);
            setTable(null);
            setFile(null);
            loadHistory();
        } catch (err) { setMsg(errorText(err)); }
    };

    return (
        <div className="agg">
            <p className="muted">Download the weekly order report (CSV) from the partner dashboard and upload it here. Orders go into sales by channel, recipes take stock off,
                the payout goes into the account you pick, and the platform's commission and fees go in as an <em>Aggregator commission</em> expense. GST on these orders is paid by the platform.</p>
            <div className="inv-toolbar">
                <select className="input compact" value={platform} onChange={e => setPlatform(e.target.value)} aria-label="Platform">
                    <option value="swiggy">Swiggy</option><option value="zomato">Zomato</option><option value="petpooja">Petpooja</option><option value="other">Other</option>
                </select>
                <label className="btn btn-secondary"><FiUpload /> Choose CSV<input type="file" accept=".csv,text/csv" hidden onChange={pick} /></label>
                {file && <span className="small">{file}</span>}
            </div>
            {table && (
                <>
                    <h3 className="section-title">1. Which column is which</h3>
                    <div className="form-grid three">
                        {FIELDS.map(f => (
                            <label key={f.key} className="small">{f.label}
                                <select className="input" value={cols[f.key] ?? ''} onChange={e => setCols({ ...cols, [f.key]: e.target.value === '' ? undefined : Number(e.target.value) })}>
                                    <option value="">—</option>{table.head.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                                </select></label>
                        ))}
                    </div>
                    {rows.length > 0 && (
                        <>
                            <p className="small"><strong>{orders}</strong> orders · <strong>{rows.length}</strong> lines · <strong>{inr(gross)}</strong> food value
                                {badDates > 0 && <span className="pill warn">{badDates} rows with an unreadable date</span>}</p>
                            <h3 className="section-title">2. Match items to your menu {unmatched.length > 0 && <span className="pill warn">{unmatched.length} to match</span>}</h3>
                            <div className="table-scroll">
                                <table className="staff-table">
                                    <thead><tr><th>In the report</th><th>Your menu item</th></tr></thead>
                                    <tbody>{names.map(n => (
                                        <tr key={n}><td>{n}</td><td>
                                            <select className="input compact" value={matches[n] || ''} aria-label={`Menu item for ${n}`} onChange={e => setMatches({ ...matches, [n]: e.target.value })}>
                                                <option value="">Pick…</option>{menu.map(mi => <option key={mi._id} value={mi._id}>{mi.name}</option>)}
                                            </select></td></tr>))}</tbody>
                                </table>
                            </div>
                            <h3 className="section-title">3. Money</h3>
                            <div className="form-grid three">
                                <label className="small">Commission + fees for these orders (₹)<input className="input" type="number" min="0" value={commission} onChange={e => setCommission(e.target.value)} /></label>
                                <label className="small">Payout received in<select className="input" value={account} onChange={e => setAccount(e.target.value)}>
                                    <option value="bank">Bank</option><option value="upi">UPI</option></select></label>
                                <div className="small"><span className="muted">Payout</span><br /><strong>{inr(gross - (Number(commission) || 0))}</strong></div>
                            </div>
                            <button className="btn btn-primary" disabled={unmatched.length > 0 || badDates > 0} onClick={run}>Import {orders} orders</button>
                        </>
                    )}
                </>
            )}
            {msg && <p className="small agg-msg">{msg}</p>}
            <h3 className="section-title">Earlier imports</h3>
            <div className="table-scroll">
                <table className="staff-table">
                    <thead><tr><th>When</th><th>Platform</th><th>Period</th><th>Orders</th><th>Food value</th><th>Commission</th><th>Payout</th></tr></thead>
                    <tbody>{history.map(h => (
                        <tr key={h.id}><td>{new Date(h.createdAt).toLocaleDateString('en-IN')}<div className="muted small">{h.fileName} · {h.createdBy}</div></td>
                            <td>{h.platform}</td><td>{h.from ? `${h.from} → ${h.to}` : '—'}</td><td>{h.orders}{h.skipped > 0 && <span className="muted small"> (+{h.skipped} skipped)</span>}</td>
                            <td>{inr(h.gross)}</td><td>{inr(h.commission)}</td><td>{inr(h.payout)}</td></tr>))}
                        {history.length === 0 && <tr><td colSpan={7} className="muted">No imports yet.</td></tr>}</tbody>
                </table>
            </div>
        </div>
    );
};

export default ImportTab;
