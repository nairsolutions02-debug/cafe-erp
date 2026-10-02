import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { FiMinus, FiPlus, FiTrash2, FiPrinter, FiWifi, FiWifiOff, FiUser, FiX, FiSearch } from 'react-icons/fi';
import { getPosCatalogue, quoteStaffOrder, findCustomers, getCurrentShifts } from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import { useOutbox, runOrQueue, newClientId, retryFailed, dismissFailed } from '../../lib/outbox';
import { ensureDevice, getDevice, nextOrderNumber, cacheGet, cacheSet } from '../../lib/device';
import { printKot, printBill } from '../../lib/print';
import { estimateTotal, inr } from './money';
import './POS.css';

const errorText = (err) => err?.message || err?.response?.data?.message || 'Something went wrong';

// Online / offline pill with the number of sales waiting to sync
export const SyncPill = () => {
    const { online, pending, failed } = useOutbox();
    const [open, setOpen] = useState(false);
    return (
        <div className="sync-wrap">
            <button className={`sync-pill ${online ? (pending.length ? 'wait' : 'ok') : 'off'}`} onClick={() => setOpen(o => !o)}>
                {online ? <FiWifi /> : <FiWifiOff />}
                {online ? (pending.length ? `Syncing · ${pending.length}` : 'Online') : `Offline · ${pending.length} waiting to sync`}
                {failed.length > 0 && <span className="sync-failed">{failed.length} failed</span>}
            </button>
            {open && (pending.length > 0 || failed.length > 0) && (
                <div className="sync-list">
                    {pending.map(j => <div key={j.id} className="sync-row"><span>{j.label}</span><span className="muted">waiting</span></div>)}
                    {failed.map(j => (
                        <div key={j.id} className="sync-row failed">
                            <span>{j.label}<br /><small>{j.error}</small></span>
                            <span>
                                <button className="link-btn" onClick={() => retryFailed(j.id)}>Retry</button>
                                <button className="link-btn" onClick={() => dismissFailed(j.id)}>Dismiss</button>
                            </span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

// Pay: cash with change, UPI, card, or split
const PayPanel = ({ total, estimated, online, onPay, onClose, busy }) => {
    const [method, setMethod] = useState('cash');
    const [tendered, setTendered] = useState('');
    const [split, setSplit] = useState({ cash: '', upi: '', card: '' });
    const change = Math.max(0, (Number(tendered) || 0) - total);
    const splitSum = Number(split.cash || 0) + Number(split.upi || 0) + Number(split.card || 0);
    const quick = [...new Set([Math.ceil(total), Math.ceil(total / 100) * 100, Math.ceil(total / 500) * 500, 2000].filter(v => v >= total))].slice(0, 4);

    const confirm = () => {
        if (method === 'split') {
            onPay({ payments: Object.entries(split).filter(([, v]) => Number(v) > 0).map(([m, v]) => ({ method: m, amount: Number(v) })) },
                0);
        } else {
            onPay({ payFullBy: method }, method === 'cash' ? change : 0);
        }
    };
    const canPay = method === 'split' ? Math.abs(splitSum - total) < 0.01 && online : method !== 'cash' || !tendered || Number(tendered) >= total;

    return (
        <div className="pay-panel">
            <div className="pay-head">
                <strong>{estimated ? '≈ ' : ''}{inr(total)}</strong>
                <button className="icon-btn" aria-label="Close" onClick={onClose}><FiX /></button>
            </div>
            <div className="pay-methods" role="radiogroup">
                {['cash', 'upi', 'card', 'split'].map(m => (
                    <button key={m} className={method === m ? 'active' : ''} onClick={() => setMethod(m)} disabled={m === 'split' && !online}>
                        {m === 'upi' ? 'UPI' : m[0].toUpperCase() + m.slice(1)}
                    </button>
                ))}
            </div>
            {method === 'cash' && (
                <>
                    <label className="pay-field">Cash received
                        <input className="input" type="number" inputMode="decimal" value={tendered} onChange={e => setTendered(e.target.value)} placeholder={String(total)} autoFocus />
                    </label>
                    <div className="quick-cash">{quick.map(q => <button key={q} onClick={() => setTendered(String(q))}>{inr(q)}</button>)}</div>
                    {Number(tendered) > 0 && <div className="change">Change <strong>{inr(change)}</strong></div>}
                </>
            )}
            {method === 'upi' && <p className="muted">Show the cafe's UPI QR and confirm the payment on the UPI app before tapping Paid.</p>}
            {method === 'split' && (
                <div className="split">
                    {['cash', 'upi', 'card'].map(m => (
                        <label key={m} className="pay-field">{m === 'upi' ? 'UPI' : m[0].toUpperCase() + m.slice(1)}
                            <input className="input" type="number" inputMode="decimal" value={split[m]} onChange={e => setSplit({ ...split, [m]: e.target.value })} />
                        </label>
                    ))}
                    <div className={Math.abs(splitSum - total) < 0.01 ? 'change' : 'change neg'}>Entered {inr(splitSum)} of {inr(total)}</div>
                </div>
            )}
            {estimated && method !== 'cash' && <p className="muted small">Offline: the exact bill is priced when it syncs.</p>}
            <button className="btn btn-primary btn-lg pay-confirm" disabled={!canPay || busy} onClick={confirm}>
                {busy ? 'Saving…' : `Paid · ${method === 'split' ? 'split' : method.toUpperCase()}`}
            </button>
        </div>
    );
};

const AdminPOS = () => {
    const { hasPerm, user } = useAuth();
    const { online } = useOutbox();
    const [cat, setCat] = useState(() => cacheGet('pos-catalogue'));
    const [device, setDevice] = useState(() => getDevice('counter'));
    const [category, setCategory] = useState('all');
    const [search, setSearch] = useState('');
    const [cart, setCart] = useState([]);
    const [orderType, setOrderType] = useState('takeaway');
    const [tableId, setTableId] = useState('');
    const [customer, setCustomer] = useState(null);
    const [custQuery, setCustQuery] = useState('');
    const [custResults, setCustResults] = useState([]);
    const [note, setNote] = useState('');
    const [disc, setDisc] = useState({ value: '', type: 'amount', reason: '', approverPhone: '', approverPin: '' });
    const [needApprover, setNeedApprover] = useState(false);
    const [quote, setQuote] = useState(null);
    const [paying, setPaying] = useState(false);
    const [busy, setBusy] = useState(false);
    const [done, setDone] = useState(null);
    const [error, setError] = useState('');
    const [shift, setShift] = useState(undefined);
    const [unitPick, setUnitPick] = useState(null);
    const [autoKot, setAutoKot] = useState(() => localStorage.getItem('pos-auto-kot') === '1');
    const searchRef = useRef(null);

    const loadCatalogue = useCallback(async () => {
        try {
            const res = await getPosCatalogue();
            setCat(res.data);
            cacheSet('pos-catalogue', res.data);
        } catch { /* offline: keep the cached copy */ }
    }, []);
    useEffect(() => {
        if (!online) return;
        loadCatalogue();
        ensureDevice('counter', 'Counter').then(setDevice).catch(() => {});
        getCurrentShifts().then(r => setShift(r.data.open.find(s => s.drawer === 'cash_counter') || null)).catch(() => setShift(undefined));
    }, [online, loadCatalogue]);

    const items = useMemo(() => (cat?.items || []).filter(i => i.is_available), [cat]);
    const topCats = useMemo(() => (cat?.categories || []).filter(c => c.is_active && !c.parent_id), [cat]);
    const inCategory = (i) => {
        if (category === 'all') return true;
        const c = (cat?.categories || []).find(x => x.id === i.category_id);
        return i.category_id === category || c?.parent_id === category;
    };
    const shown = items.filter(i => inCategory(i) && (!search || i.name.toLowerCase().includes(search.toLowerCase())));

    const add = (item, unit) => {
        if (!unit && item.item_units?.length && !unitPick) {
            setUnitPick(item);
            return;
        }
        setUnitPick(null);
        const key = `${item.id}:${unit?.id || ''}`;
        const price = unit ? Number(unit.sale_price ?? item.price * unit.factor) : Number(item.price);
        setCart(c => {
            const found = c.find(l => l.key === key);
            if (found) return c.map(l => (l.key === key ? { ...l, qty: l.qty + 1 } : l));
            return [...c, { key, menuItemId: item.id, unitId: unit?.id || null, name: item.name + (unit ? ` (${unit.name})` : ''), price, qty: 1, note: '', restricted: item.is_restricted }];
        });
    };
    const setQty = (key, qty) => setCart(c => (qty <= 0 ? c.filter(l => l.key !== key) : c.map(l => (l.key === key ? { ...l, qty } : l))));

    const subtotal = cart.reduce((a, l) => a + l.price * l.qty, 0);
    const discountAmount = disc.value === '' ? 0 : disc.type === 'pct' ? Math.round(subtotal * Number(disc.value)) / 100 : Number(disc.value);
    const payload = () => ({
        items: cart.map(l => ({ menuItem: l.menuItemId, quantity: l.qty, unitId: l.unitId || undefined, note: l.note || undefined })),
        manualDiscount: discountAmount || 0,
        customerId: customer?.id || undefined,
    });

    // Exact bill from the database while online
    useEffect(() => {
        if (!online || cart.length === 0) { setQuote(null); return undefined; }
        const t = setTimeout(async () => {
            try {
                const q = (await quoteStaffOrder(payload())).data;
                setQuote(q);
                setNeedApprover(discountAmount > 0 && (discountAmount * 100 / (q.subtotal || 1)) > q.discountLimit + 0.001);
                setError('');
            } catch (err) {
                setQuote(null);
                setError(errorText(err));
            }
        }, 250);
        return () => clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [cart, discountAmount, customer, online]);

    // Customer search by phone digits or name
    useEffect(() => {
        if (!online || custQuery.trim().length < 3) { setCustResults([]); return undefined; }
        const t = setTimeout(() => findCustomers(custQuery).then(r => setCustResults(r.data)).catch(() => {}), 250);
        return () => clearTimeout(t);
    }, [custQuery, online]);

    const estimated = !quote;
    const total = quote ? quote.total : estimateTotal(cart, items, cat?.taxGroups || [], cat?.defaultTax || [], discountAmount);

    const reset = () => {
        setCart([]);
        setCustomer(null);
        setCustQuery('');
        setNote('');
        setTableId('');
        setDisc({ value: '', type: 'amount', reason: '', approverPhone: '', approverPin: '' });
        setNeedApprover(false);
        setPaying(false);
        setQuote(null);
        setTimeout(() => searchRef.current?.focus(), 50);
    };

    const submit = async (payment, change = 0) => {
        if (!cart.length) return;
        if (discountAmount > 0 && !disc.reason.trim()) { setError('Give a reason for the discount'); return; }
        setBusy(true);
        setError('');
        const code = device?.code || 'C0';
        const { orderNumber, token } = nextOrderNumber(code);
        const table = (cat?.tables || []).find(t => t.id === tableId);
        const p = {
            ...payload(),
            clientId: newClientId(), orderNumber, deviceCode: code, channel: orderType,
            tableId: orderType === 'dine_in' && tableId ? tableId : undefined,
            tokenNumber: orderType === 'dine_in' && tableId ? '' : token,
            customerPhone: !customer?.id ? customer?.phone : undefined, customerName: !customer?.id ? customer?.name : undefined,
            discountReason: disc.reason, approverPhone: disc.approverPhone || undefined, approverPin: disc.approverPin || undefined,
            specialInstructions: note, drawer: 'cash_counter', ...(payment || {}),
        };
        const label = `${orderNumber} · ${cart.length} item${cart.length > 1 ? 's' : ''}${payment ? ' · paid' : ''}`;
        try {
            const res = await runOrQueue('create_staff_order', { p }, label);
            const order = res.data || {
                orderNumber, tokenNumber: p.tokenNumber, tableNumber: table?.table_number || '', channel: orderType,
                createdAt: new Date().toISOString(), staffName: user?.name, specialInstructions: note,
                items: cart.map(l => ({ name: l.name, quantity: l.qty, note: l.note })),
            };
            setDone({ order, queued: !!res.queued, change, paid: !!payment });
            if (autoKot) printKot(order);
            reset();
        } catch (err) {
            const msg = errorText(err);
            if (/manager must approve|above your limit/i.test(msg)) setNeedApprover(true);
            setError(msg);
        } finally {
            setBusy(false);
        }
    };

    if (!cat) {
        return <div className="pos-empty">{online ? 'Loading the menu…' : 'Connect to the internet once to load the menu on this device.'}</div>;
    }

    return (
        <div className="pos">
            <div className="pos-top">
                <h1>Counter{device && <span className="muted"> · {device.code}</span>}</h1>
                <SyncPill />
                {shift === null && hasPerm('orders.edit') && (
                    <Link className="shift-warn" to="/admin/shifts">No open shift on the counter drawer — open shift</Link>
                )}
                {shift && <span className="muted small">Shift open · cash expected {inr(shift.expectedCash)}</span>}
                <label className="check small"><input type="checkbox" checked={autoKot}
                    onChange={e => { setAutoKot(e.target.checked); localStorage.setItem('pos-auto-kot', e.target.checked ? '1' : '0'); }} /> Print KOT automatically</label>
            </div>

            <div className="pos-body">
                <section className="pos-menu">
                    <div className="pos-search">
                        <FiSearch />
                        <input ref={searchRef} className="input" placeholder="Search item…" value={search} onChange={e => setSearch(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter' && shown[0]) { add(shown[0]); setSearch(''); } }} />
                    </div>
                    <div className="chips">
                        <button className={category === 'all' ? 'active' : ''} onClick={() => setCategory('all')}>All</button>
                        {topCats.map(c => <button key={c.id} className={category === c.id ? 'active' : ''} onClick={() => setCategory(c.id)}>{c.name}</button>)}
                    </div>
                    <div className="tiles">
                        {shown.map(i => (
                            <button key={i.id} className={`tile${i.is_restricted ? ' restricted' : ''}`} onClick={() => add(i)}>
                                <span className={`veg-dot ${i.is_veg ? 'veg' : 'nonveg'}`} />
                                <span className="tile-name">{i.name}</span>
                                <span className="tile-price">{inr(i.price)}{i.item_units?.length ? ' +packs' : ''}</span>
                            </button>
                        ))}
                        {shown.length === 0 && <p className="muted">No items match.</p>}
                    </div>
                </section>

                <section className="pos-cart">
                    <div className="seg">
                        {[['takeaway', 'Takeaway'], ['dine_in', 'Dine-in']].map(([v, l]) => (
                            <button key={v} className={orderType === v ? 'active' : ''} onClick={() => setOrderType(v)}>{l}</button>
                        ))}
                    </div>
                    {orderType === 'dine_in' && (
                        <select className="input" value={tableId} onChange={e => setTableId(e.target.value)} aria-label="Table">
                            <option value="">No table (token)</option>
                            {(cat.tables || []).map(t => <option key={t.id} value={t.id}>Table {t.table_number}{t.status === 'occupied' ? ' · occupied' : ''}</option>)}
                        </select>
                    )}

                    <div className="cust">
                        {customer ? (
                            <div className="cust-chip"><FiUser /> {customer.name || 'New customer'} · {customer.phone}
                                <button className="icon-btn" aria-label="Remove customer" onClick={() => setCustomer(null)}><FiX /></button></div>
                        ) : (
                            <>
                                <input className="input" placeholder="Customer mobile or name (optional)" value={custQuery} onChange={e => setCustQuery(e.target.value)} />
                                {custResults.length > 0 && (
                                    <div className="cust-results">
                                        {custResults.map(c => <button key={c.id} onClick={() => { setCustomer(c); setCustQuery(''); }}>{c.name} · {c.phone} · {c.points} pts</button>)}
                                    </div>
                                )}
                                {/^[6-9]\d{9}$/.test(custQuery.trim()) && custResults.length === 0 && (
                                    <div className="cust-new">
                                        <input className="input" placeholder="Name" id="new-cust-name" />
                                        <button className="btn btn-ghost btn-sm" onClick={() => {
                                            setCustomer({ phone: custQuery.trim(), name: document.getElementById('new-cust-name').value.trim() });
                                            setCustQuery('');
                                        }}>Add</button>
                                    </div>
                                )}
                            </>
                        )}
                    </div>

                    <div className="lines">
                        {cart.map(l => (
                            <div key={l.key} className="line">
                                <div className="line-main">
                                    <span className="line-name">{l.name}</span>
                                    <span className="num">{inr(l.price * l.qty)}</span>
                                </div>
                                <div className="line-ctrl">
                                    <button aria-label={`Less ${l.name}`} onClick={() => setQty(l.key, l.qty - 1)}><FiMinus /></button>
                                    <span className="qty">{l.qty}</span>
                                    <button aria-label={`More ${l.name}`} onClick={() => setQty(l.key, l.qty + 1)}><FiPlus /></button>
                                    <input className="input line-note" placeholder="note" value={l.note} onChange={e => setCart(c => c.map(x => (x.key === l.key ? { ...x, note: e.target.value } : x)))} />
                                    <button aria-label={`Remove ${l.name}`} onClick={() => setQty(l.key, 0)}><FiTrash2 /></button>
                                </div>
                            </div>
                        ))}
                        {cart.length === 0 && <p className="muted empty-cart">Tap items to add them. Enter in the search box adds the first match.</p>}
                    </div>

                    {cart.length > 0 && hasPerm('sensitive.give_discount') && (
                        <div className="disc">
                            <div className="disc-row">
                                <input className="input" type="number" min="0" placeholder="Discount" value={disc.value} onChange={e => setDisc({ ...disc, value: e.target.value })} aria-label="Discount" />
                                <select className="input" value={disc.type} onChange={e => setDisc({ ...disc, type: e.target.value })} aria-label="Discount type">
                                    <option value="amount">₹</option><option value="pct">%</option>
                                </select>
                                <input className="input" placeholder="Reason" value={disc.reason} onChange={e => setDisc({ ...disc, reason: e.target.value })} aria-label="Discount reason" />
                            </div>
                            {needApprover && (
                                <div className="disc-row">
                                    <input className="input" inputMode="numeric" placeholder="Manager mobile" value={disc.approverPhone} onChange={e => setDisc({ ...disc, approverPhone: e.target.value })} aria-label="Manager mobile" />
                                    <input className="input" type="password" inputMode="numeric" placeholder="Manager PIN" value={disc.approverPin} onChange={e => setDisc({ ...disc, approverPin: e.target.value })} aria-label="Manager PIN" />
                                </div>
                            )}
                        </div>
                    )}
                    {cart.length > 0 && (
                        <input className="input" placeholder="Order note for the kitchen" value={note} onChange={e => setNote(e.target.value)} />
                    )}

                    <div className="totals">
                        {quote ? (
                            <>
                                <div><span>Subtotal</span><span>{inr(quote.subtotal)}</span></div>
                                {quote.discount > 0 && <div><span>Discount</span><span>-{inr(quote.discount)}</span></div>}
                                {(quote.taxDetails || []).map(t => <div key={`${t.name}${t.rate}`}><span>{t.name} {t.rate}%</span><span>{inr(t.amount)}</span></div>)}
                            </>
                        ) : cart.length > 0 && <div className="muted small"><span>{online ? 'Pricing…' : 'Offline estimate'}</span></div>}
                        <div className="grand"><span>Total</span><span>{estimated && cart.length ? '≈ ' : ''}{inr(total)}</span></div>
                    </div>
                    {error && <p className="error-message">{error}</p>}

                    {paying ? (
                        <PayPanel total={total} estimated={estimated} online={online} busy={busy} onClose={() => setPaying(false)} onPay={submit} />
                    ) : (
                        <div className="pos-actions">
                            <button className="btn btn-secondary btn-lg" disabled={!cart.length || busy} onClick={() => submit(null)}>Send to kitchen</button>
                            <button className="btn btn-primary btn-lg" disabled={!cart.length || busy} onClick={() => setPaying(true)}>Pay {inr(total)}</button>
                        </div>
                    )}
                </section>
            </div>

            {unitPick && (
                <div className="modal-overlay" onClick={() => setUnitPick(null)}>
                    <div className="modal unit-pick" role="dialog" aria-label={`Sell ${unitPick.name} as`} onClick={e => e.stopPropagation()}>
                        <div className="modal-header"><h2>{unitPick.name}</h2><button className="modal-close" onClick={() => setUnitPick(null)}>×</button></div>
                        <div className="modal-body unit-options">
                            <button className="tile" onClick={() => add(unitPick, null)}><span className="tile-name">1 piece</span><span className="tile-price">{inr(unitPick.price)}</span></button>
                            {unitPick.item_units.map(u => (
                                <button key={u.id} className="tile" onClick={() => add(unitPick, u)}>
                                    <span className="tile-name">{u.name} ({u.factor} pc)</span>
                                    <span className="tile-price">{inr(u.sale_price ?? unitPick.price * u.factor)}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {done && (
                <div className="pos-done" role="status">
                    <div>
                        <strong>{done.order.orderNumber}</strong>
                        {done.order.tokenNumber ? ` · Token ${done.order.tokenNumber}` : done.order.tableNumber ? ` · Table ${done.order.tableNumber}` : ''}
                        {done.paid ? ' · paid' : ' · sent to kitchen'}
                        {done.change > 0 && <> · <span className="change">Change {inr(done.change)}</span></>}
                        {done.queued && <span className="pill warn">saved offline</span>}
                    </div>
                    <div className="row-actions">
                        <button className="btn btn-ghost btn-sm" onClick={() => printKot(done.order)}><FiPrinter /> KOT</button>
                        {!done.queued && <button className="btn btn-ghost btn-sm" onClick={() => printBill(done.order)}><FiPrinter /> Bill</button>}
                        <button className="icon-btn" aria-label="Dismiss" onClick={() => setDone(null)}><FiX /></button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AdminPOS;
