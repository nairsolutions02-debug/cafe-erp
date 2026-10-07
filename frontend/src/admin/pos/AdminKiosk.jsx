import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { FiPlus, FiMinus, FiX, FiAlertTriangle } from 'react-icons/fi';
import { getKioskItems, getKioskRegulars, findCustomers, getPosCatalogue, getCurrentShifts, getSettings } from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import { useOutbox, runOrQueue, newClientId } from '../../lib/outbox';
import { ensureDevice, confirmDevice, getDevice, nextOrderNumber, cacheGet, cacheSet } from '../../lib/device';
import { printBill } from '../../lib/print';
import { SyncPill } from './AdminPOS';
import { estimateTotal, inr } from './money';
import { ChoicePicker, LineNote } from './ChoicePicker';
import { groupsById, hasChoices } from './choices';
import './POS.css';
import { useBrand } from '../../context/BrandContext';
import './Kiosk.css';

const TABS_KEY = 'kiosk-tabs-v1';
const newTab = (n) => ({ id: newClientId(), label: `Guest ${n}`, customer: null, lines: [] });
const loadTabs = () => {
    try {
        const t = JSON.parse(localStorage.getItem(TABS_KEY));
        if (Array.isArray(t) && t.length) return t;
    } catch { /* ignore */ }
    return [newTab(1)];
};

// Number pad for a long press: quantity and piece / pack
const NumPad = ({ item, onAdd, onClose }) => {
    const [qty, setQty] = useState('');
    const [unitId, setUnitId] = useState('');
    const unit = item.units.find(u => u.id === unitId);
    const price = unit ? unit.price : item.price;
    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal numpad" role="dialog" aria-label={`How many ${item.name}`} onClick={e => e.stopPropagation()}>
                <div className="modal-header"><h2>{item.name}</h2><button className="modal-close" onClick={onClose}>×</button></div>
                <div className="modal-body">
                    {item.units.length > 0 && (
                        <div className="seg">
                            <button className={!unitId ? 'active' : ''} onClick={() => setUnitId('')}>Piece</button>
                            {item.units.map(u => <button key={u.id} className={unitId === u.id ? 'active' : ''} onClick={() => setUnitId(u.id)}>{u.name} ({u.factor})</button>)}
                        </div>
                    )}
                    <div className="numpad-display">{qty || '0'} × {inr(price)} = <strong>{inr((Number(qty) || 0) * price)}</strong></div>
                    <div className="numpad-keys">
                        {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'].map(k => (
                            <button key={k} onClick={() => setQty(q => (k === 'C' ? '' : k === '⌫' ? q.slice(0, -1) : (q + k).slice(0, 3)))}>{k}</button>
                        ))}
                    </div>
                    <button className="btn btn-primary btn-lg" style={{ width: '100%' }} disabled={!(Number(qty) > 0)}
                        onClick={() => onAdd(item, unit, Number(qty))}>Add</button>
                </div>
            </div>
        </div>
    );
};

// Quick kiosk: several customers at once (tabs), big tiles, Cash · UPI · Khata in one tap
const AdminKiosk = () => {
    const { user } = useAuth();
    const brand = useBrand();
    const { online } = useOutbox();
    const [items, setItems] = useState(() => cacheGet('kiosk-items') || []);
    const [tax, setTax] = useState(() => cacheGet('pos-catalogue'));
    const [regulars, setRegulars] = useState(() => cacheGet('kiosk-regulars') || []);
    const [device, setDevice] = useState(() => getDevice('kiosk'));
    const [deviceError, setDeviceError] = useState('');
    // A screen only takes a kiosk slot when someone chooses to set it up as a kiosk
    const [needSetup, setNeedSetup] = useState(false);
    const [settingUp, setSettingUp] = useState(false);
    const [tabs, setTabs] = useState(loadTabs);
    const [active, setActive] = useState(0);
    const [filter, setFilter] = useState('');
    const [custQuery, setCustQuery] = useState('');
    const [custResults, setCustResults] = useState([]);
    const [numpad, setNumpad] = useState(null);
    const [choicePick, setChoicePick] = useState(null);
    const [approval, setApproval] = useState(null);
    const [busy, setBusy] = useState(false);
    const [toast, setToast] = useState(null);
    const [error, setError] = useState('');
    // The open kiosk shift (kept on the device, so a sale made offline still says which shift it belongs to)
    const [shift, setShift] = useState(() => cacheGet('shift-cash_kiosk') ?? undefined);
    const [idReminder, setIdReminder] = useState(true);
    const press = useRef(null);
    const noShift = online && shift === null;

    const tab = tabs[Math.min(active, tabs.length - 1)];
    // Every sale belongs to an open kiosk shift: no shift (while online) = no sale
    useEffect(() => {
        if (!toast) return undefined;
        const t = setTimeout(() => setToast(null), 5000);
        return () => clearTimeout(t);
    }, [toast]);
    const saveTabs = (next) => {
        setTabs(next);
        try { localStorage.setItem(TABS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
    };
    const updateTab = (patch) => saveTabs(tabs.map((t, i) => (i === active ? { ...t, ...patch } : t)));

    const load = useCallback(async () => {
        try {
            const [it, reg] = await Promise.all([getKioskItems(), getKioskRegulars()]);
            setItems(it.data);
            setRegulars(reg.data);
            cacheSet('kiosk-items', it.data);
            cacheSet('kiosk-regulars', reg.data);
            // The counter catalogue also carries sizes and choice groups, so refresh it each time
            const c = (await getPosCatalogue()).data;
            cacheSet('pos-catalogue', c);
            setTax(c);
            const s = (await getCurrentShifts()).data;
            const mine = s.open.find(x => x.drawer === 'cash_kiosk') || null;
            setShift(mine);
            cacheSet('shift-cash_kiosk', mine ? { id: mine.id, drawer: mine.drawer, openedBy: mine.openedBy, openedAt: mine.openedAt } : null);
            const st = (await getSettings()).data;
            setIdReminder(st.restricted_id_reminder !== false);
        } catch { /* offline: cached copy */ }
    }, []);
    useEffect(() => {
        if (!online) return;
        load();
        confirmDevice('kiosk').then(d => { setDevice(d); setNeedSetup(!d); }).catch(() => {});
    }, [online, load]);

    useEffect(() => {
        if (!online || custQuery.trim().length < 3) { setCustResults([]); return undefined; }
        const t = setTimeout(() => findCustomers(custQuery).then(r => setCustResults(r.data)).catch(() => {}), 200);
        return () => clearTimeout(t);
    }, [custQuery, online]);

    const chips = useMemo(() => {
        const seen = new Map();
        items.forEach(i => {
            if (i.brand) seen.set(`b:${i.brandId}`, i.brand);
            if (i.category) seen.set(`c:${i.categoryId}`, i.category);
        });
        return [...seen.entries()];
    }, [items]);
    const shown = items.filter(i => !filter || (filter.startsWith('b:') ? `b:${i.brandId}` === filter : `c:${i.categoryId}` === filter));

    // Sizes and choice groups come from the counter catalogue (kiosk items do not carry them)
    const groups = useMemo(() => groupsById(tax?.optionGroups), [tax]);
    const fullItem = (item) => (tax?.items || []).find(x => x.id === item.id);
    const needsPick = (item) => hasChoices(fullItem(item), groups);

    // opts: { sel: {size, choices}, qty, price, name, words } from the choice picker
    const add = (item, unit = null, qty = 1, opts = null) => {
        setNumpad(null);
        if (!unit && !opts && needsPick(item)) {
            setChoicePick(item);
            return;
        }
        setChoicePick(null);
        const pickKey = opts ? `${opts.sel.size || ''}:${[...opts.sel.choices].sort().join(',')}` : '';
        const key = `${item.id}:${unit?.id || ''}:${pickKey}`;
        const n = opts?.qty || qty;
        const lines = tab.lines.some(l => l.key === key)
            ? tab.lines.map(l => (l.key === key ? { ...l, qty: l.qty + n } : l))
            : [...tab.lines, { key, menuItemId: item.id, unitId: unit?.id || null, name: opts ? opts.name : item.name + (unit ? ` (${unit.name})` : ''),
                price: opts ? opts.price : unit ? unit.price : item.price, qty: n, restricted: item.isRestricted,
                size: opts?.sel.size || undefined, choices: opts ? opts.sel.choices : undefined, choiceText: opts?.words || '' }];
        updateTab({ lines });
    };
    const setQty = (key, qty) => updateTab({ lines: qty <= 0 ? tab.lines.filter(l => l.key !== key) : tab.lines.map(l => (l.key === key ? { ...l, qty } : l)) });

    const startPress = (item) => {
        press.current = setTimeout(() => { press.current = 'long'; setNumpad(item); }, 450);
    };
    const endPress = (item) => {
        if (press.current === 'long') { press.current = null; return; }
        clearTimeout(press.current);
        press.current = null;
        add(item);
    };

    const pickCustomer = (c) => {
        updateTab({ customer: c, label: c.name });
        setCustQuery('');
        setCustResults([]);
    };

    const taxItems = items.map(i => ({ id: i.id, price: i.price, tax_group_id: i.taxGroupId, price_includes_tax: i.priceIncludesTax, is_restricted: i.isRestricted }));
    const total = estimateTotal(tab.lines, taxItems, tax?.taxGroups || [], tax?.defaultTax || []);
    const hasRestricted = tab.lines.some(l => l.restricted);

    const closeTab = () => {
        const next = tabs.filter((_, i) => i !== active);
        saveTabs(next.length ? next : [newTab(1)]);
        // Go to the next customer still waiting, if any
        const waiting = next.findIndex(t => t.lines.length > 0);
        setActive(waiting >= 0 ? waiting : 0);
    };

    const pay = async (method, approver) => {
        if (!tab.lines.length) return;
        setBusy(true);
        setError('');
        const code = device?.code || 'K0';
        const { orderNumber, token } = nextOrderNumber(code);
        const p = {
            clientId: newClientId(), orderNumber, deviceCode: code, channel: 'kiosk', tokenNumber: token,
            customerId: tab.customer?.id, customerPhone: tab.customer?.id ? undefined : tab.customer?.phone, customerName: tab.customer?.id ? undefined : tab.customer?.name,
            items: tab.lines.map(l => ({ menuItem: l.menuItemId, quantity: l.qty, unitId: l.unitId || undefined, size: l.size, choices: l.choices })),
            payFullBy: method, drawer: 'cash_kiosk', approverPhone: approver?.phone, approverPin: approver?.pin,
            shiftId: shift?.id || undefined,
        };
        try {
            const res = await runOrQueue('create_staff_order', { p }, `${orderNumber} · kiosk · ${method}`);
            const order = res.data || { orderNumber, items: tab.lines.map(l => ({ name: l.name, quantity: l.qty, note: l.choiceText, total: l.price * l.qty })), total };
            setToast({ order, method, queued: !!res.queued, who: tab.customer?.name });
            setApproval(null);
            closeTab();
            if (online) getKioskItems().then(r => { setItems(r.data); cacheSet('kiosk-items', r.data); }).catch(() => {});
        } catch (err) {
            const msg = err.message || 'Could not save';
            if (/manager must approve/i.test(msg)) setApproval({ method, phone: '', pin: '', msg });
            else setError(msg);
        } finally {
            setBusy(false);
        }
    };

    const setUpKiosk = async () => {
        setSettingUp(true);
        setDeviceError('');
        try {
            setDevice(await ensureDevice('kiosk', 'Kiosk'));
            setNeedSetup(false);
        } catch (err) {
            setDeviceError(err.response?.data?.message || err.message);
        } finally {
            setSettingUp(false);
        }
    };
    if (needSetup && online) return (
        <div className="pos-empty kiosk-setup">
            <h2>Use this screen as a kiosk?</h2>
            <p>The kiosk is the self-order screen customers use at the shop. Setting it up uses one of the kiosk slots in your plan.
                Staff phones and laptops do not need this: use Counter to take orders.</p>
            {deviceError && <p className="error-message">{deviceError} Turn off an old kiosk in Settings → Cafe settings → Devices, then try again.</p>}
            <button type="button" className="btn btn-primary btn-lg" disabled={settingUp} onClick={setUpKiosk}>{settingUp ? 'Setting up…' : 'Set up this screen as a kiosk'}</button>
        </div>
    );
    if (!items.length) return <div className="pos-empty">{online ? 'Loading…' : 'Open the kiosk once with internet to store the items on this device.'}</div>;

    return (
        <div className="kiosk">
            <div className="kiosk-brand">
                <img src={brand.logo} alt="" onError={e => { e.currentTarget.style.display = 'none'; }} />
                <b>{brand.name}</b>
                {brand.tagline && <span>{brand.tagline}</span>}
            </div>
            <div className="kiosk-tabs">
                {tabs.map((t, i) => (
                    <button key={t.id} className={`ktab${i === active ? ' active' : ''}`} onClick={() => setActive(i)}>
                        {t.label}{t.customer?.balance > 0 ? ` · ${inr(t.customer.balance)} due` : ''}
                        {t.lines.length > 0 && <span className="ktab-count">{t.lines.reduce((a, l) => a + l.qty, 0)}</span>}
                    </button>
                ))}
                <button className="ktab add" aria-label="New customer tab" onClick={() => { saveTabs([...tabs, newTab(tabs.length + 1)]); setActive(tabs.length); }}><FiPlus /></button>
                <div className="spacer" />
                <SyncPill />
                {device && <span className="muted small">{device.code}</span>}
            </div>
            {shift === null && <Link className="shift-warn" to="/admin/shifts">No open shift on the kiosk drawer — open shift</Link>}

            <div className="kiosk-cust">
                {tab.customer ? (
                    <div className="cust-chip">{tab.customer.name} · {tab.customer.phone}
                        {tab.customer.limit > 0 && <span className="muted small"> · khata {inr(tab.customer.balance || 0)} of {inr(tab.customer.limit)}</span>}
                        <button className="icon-btn" aria-label="Remove customer" onClick={() => updateTab({ customer: null, label: `Guest ${active + 1}` })}><FiX /></button>
                    </div>
                ) : (
                    <>
                        <input className="input" inputMode="search" placeholder="Phone digits or name" value={custQuery} onChange={e => setCustQuery(e.target.value)} aria-label="Find customer" />
                        <div className="regulars">
                            {(custResults.length ? custResults : regulars).map(c => (
                                <button key={c.id} onClick={() => pickCustomer(c)}>{c.name}{c.balance > 0 ? ` · ${inr(c.balance)}` : ''}</button>
                            ))}
                        </div>
                    </>
                )}
            </div>

            <div className="chips">
                <button className={!filter ? 'active' : ''} onClick={() => setFilter('')}>All</button>
                {chips.map(([k, l]) => <button key={k} className={filter === k ? 'active' : ''} onClick={() => setFilter(k)}>{l}</button>)}
            </div>

            <div className="kiosk-grid">
                {shown.map(i => (
                    <button key={i.id} className={`ktile${i.isRestricted ? ' restricted' : ''}${i.low ? ' low' : ''}`}
                        onPointerDown={() => startPress(i)} onPointerUp={() => endPress(i)} onPointerLeave={() => { if (press.current && press.current !== 'long') clearTimeout(press.current); }}
                        onContextMenu={e => { e.preventDefault(); clearTimeout(press.current); press.current = 'long'; setNumpad(i); }} aria-label={`Add ${i.name}`}>
                        <span className="ktile-name">{i.name}</span>
                        <span className="ktile-price">{inr(i.price)}{needsPick(i) ? ' · choices' : ''}{i.units.length ? ` · ${i.units[0].name} ${inr(i.units[0].price)}` : ''}</span>
                        {i.left != null && <span className={`ktile-left${i.left <= 0 ? ' out' : ''}`}>{i.left} left</span>}
                    </button>
                ))}
            </div>

            <div className="kiosk-cart">
                {hasRestricted && idReminder && <div className="id-reminder"><FiAlertTriangle /> Customer looks under 18? Check ID</div>}
                <div className="kiosk-lines">
                    {tab.lines.map(l => (
                        <div key={l.key} className="kline">
                            <span>{l.name}<LineNote item={{ note: l.choiceText }} /></span>
                            <span className="kline-ctrl">
                                <button aria-label={`Less ${l.name}`} onClick={() => setQty(l.key, l.qty - 1)}><FiMinus /></button>
                                <strong>{l.qty}</strong>
                                <button aria-label={`More ${l.name}`} onClick={() => setQty(l.key, l.qty + 1)}><FiPlus /></button>
                            </span>
                            <span className="num">{inr(l.price * l.qty)}</span>
                        </div>
                    ))}
                    {!tab.lines.length && <p className="muted small kiosk-hint">Tap a tile for one piece; hold for a number pad and packs.</p>}
                </div>
                {error && <p className="error-message">{error}</p>}
                {toast && (
                <div className="kiosk-toast" role="status">
                    <div><strong>{inr(toast.order.total)}</strong> · {toast.method.toUpperCase()}{toast.who ? ` · ${toast.who}` : ''}
                        {toast.queued && <span className="pill warn">saved offline</span>}</div>
                    {!toast.queued && <button className="btn btn-ghost btn-sm" onClick={() => printBill(toast.order)}>Bill</button>}
                    <button className="icon-btn" aria-label="Dismiss" onClick={() => setToast(null)}><FiX /></button>
                </div>
            )}
                <div className="kiosk-pay">
                    <div className="kiosk-total">{inr(total)}</div>
                    <button className="kpay cash" disabled={busy || noShift || !tab.lines.length} onClick={() => pay('cash')}>Cash</button>
                    <button className="kpay upi" disabled={busy || noShift || !tab.lines.length} onClick={() => pay('upi')}>UPI</button>
                    <button className="kpay khata" disabled={busy || noShift || !tab.lines.length || !tab.customer} onClick={() => pay('khata')}
                        title={tab.customer ? '' : 'Pick the customer first'}>Khata</button>
                </div>
            </div>

            {numpad && (needsPick(numpad)
                ? <ChoicePicker item={fullItem(numpad)} groups={groups} onClose={() => setNumpad(null)} onAdd={(opts) => add(numpad, null, 1, opts)} />
                : <NumPad item={numpad} onAdd={add} onClose={() => setNumpad(null)} />)}
            {choicePick && <ChoicePicker item={fullItem(choicePick)} groups={groups} onClose={() => setChoicePick(null)} onAdd={(opts) => add(choicePick, null, 1, opts)} />}
            {approval && (
                <div className="modal-overlay" onClick={() => setApproval(null)}>
                    <div className="modal" role="dialog" aria-label="Manager approval" onClick={e => e.stopPropagation()}>
                        <div className="modal-header"><h2>Manager approval</h2><button className="modal-close" onClick={() => setApproval(null)}>×</button></div>
                        <div className="modal-body">
                            <p className="neg">{approval.msg}</p>
                            <input className="input" inputMode="numeric" placeholder="Manager mobile" value={approval.phone} onChange={e => setApproval({ ...approval, phone: e.target.value })} aria-label="Manager mobile" />
                            <input className="input" type="password" inputMode="numeric" placeholder="PIN" value={approval.pin} onChange={e => setApproval({ ...approval, pin: e.target.value })} aria-label="Manager PIN" style={{ marginTop: 8 }} />
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-ghost" onClick={() => setApproval(null)}>Cancel</button>
                            <button className="btn btn-primary" onClick={() => pay(approval.method, approval)}>Approve</button>
                        </div>
                    </div>
                </div>
            )}
            <span className="sr-only">{user?.name}</span>
        </div>
    );
};

export default AdminKiosk;
