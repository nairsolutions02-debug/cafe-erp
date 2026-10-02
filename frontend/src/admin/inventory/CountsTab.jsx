import React, { useCallback, useEffect, useState } from 'react';
import { FiClipboard, FiCheck, FiX } from 'react-icons/fi';
import { getCounts, startCount, getCount, saveCount, postCount, cancelCount, getStockLeaks } from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import Modal from './Modal';
import { errorText, fmtDateTime, fmtMoney, fmtQty } from './shared';

const SCOPES = [
    { value: 'daily', label: 'Daily items only' },
    { value: 'weekly', label: 'Daily + weekly items' },
    { value: 'all', label: 'Everything' },
];

// The count sheet: type what is on the shelf. Each line is saved as you go.
// Expected quantities stay hidden while counting (blind count) unless a manager shows them.
const CountSheet = ({ id, onClose, onChanged }) => {
    const { hasPerm } = useAuth();
    const seeCost = hasPerm('sensitive.see_cost');
    const [count, setCount] = useState(null);
    const [values, setValues] = useState({});
    const [showExpected, setShowExpected] = useState(false);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState(null);

    const load = useCallback(async () => {
        const c = (await getCount(id)).data;
        setCount(c);
        setValues(Object.fromEntries(c.lines.map(l => [l.itemId, l.counted ?? ''])));
    }, [id]);
    useEffect(() => { load(); }, [load]);

    const saveLine = async (itemId) => {
        const line = count.lines.find(l => l.itemId === itemId);
        const v = values[itemId];
        if (String(v) === String(line.counted ?? '')) return;
        try {
            await saveCount(id, [{ itemId, counted: v === '' ? null : Number(v) }]);
            setCount(c => ({ ...c, lines: c.lines.map(l => (l.itemId === itemId ? { ...l, counted: v === '' ? null : Number(v) } : l)) }));
        } catch (err) {
            setError(errorText(err, 'Could not save'));
        }
    };

    const post = async () => {
        const missing = count.lines.filter(l => values[l.itemId] === '' || values[l.itemId] == null).length;
        if (missing && !window.confirm(`${missing} items are not counted and will be left as they are. Post the count?`)) return;
        setBusy(true);
        try {
            await saveCount(id, count.lines.map(l => ({ itemId: l.itemId, counted: values[l.itemId] === '' ? null : Number(values[l.itemId]) })));
            setResult((await postCount(id)).data);
            await load();
            onChanged();
        } catch (err) {
            setError(errorText(err, 'Could not post the count'));
        } finally {
            setBusy(false);
        }
    };

    const cancel = async () => {
        if (!window.confirm('Cancel this count? Nothing will change in stock.')) return;
        await cancelCount(id);
        onChanged();
        onClose();
    };

    if (!count) return null;
    const open = count.status === 'open';
    const counted = count.lines.filter(l => values[l.itemId] !== '' && values[l.itemId] != null).length;

    return (
        <Modal title={`Count · ${count.location}`} onClose={onClose} wide>
            <div className="modal-body">
                <p className="muted">
                    Started {fmtDateTime(count.createdAt)} by {count.startedBy}
                    {count.postedAt && ` · posted ${fmtDateTime(count.postedAt)} by ${count.postedBy}`}
                    {' · '}{counted}/{count.lines.length} counted
                </p>
                {result && (
                    <p className={`count-result ${result.varianceValue < 0 ? 'neg' : ''}`}>
                        Posted: {result.items} counted, {result.itemsOff} different from expected
                        {result.varianceValue != null && <> · variance <strong>{fmtMoney(result.varianceValue)}</strong></>}
                    </p>
                )}
                {open && hasPerm('inventory.edit') && (
                    <label className="check"><input type="checkbox" checked={showExpected} onChange={e => setShowExpected(e.target.checked)} /> Show expected quantities</label>
                )}
                <div className="table-scroll">
                    <table className="staff-table count-table">
                        <thead>
                            <tr>
                                <th>Item</th>
                                <th>Counted</th>
                                {(!open || showExpected) && <th>Expected</th>}
                                {!open && <th>Difference</th>}
                                {!open && seeCost && <th>₹</th>}
                            </tr>
                        </thead>
                        <tbody>
                            {count.lines.map(l => (
                                <tr key={l.itemId}>
                                    <td><strong>{l.name}</strong>
                                        {l.units.length > 0 && <div className="muted small">{l.units.map(u => `1 ${u.name} = ${fmtQty(u.factor, l.unit)}`).join(' · ')}</div>}
                                    </td>
                                    <td>
                                        {open ? (
                                            <div className="qty-unit">
                                                <input className="input compact" type="number" min="0" step="any" inputMode="decimal" aria-label={`Counted ${l.name}`}
                                                    value={values[l.itemId] ?? ''} onChange={e => setValues(v => ({ ...v, [l.itemId]: e.target.value }))}
                                                    onBlur={() => saveLine(l.itemId)} />
                                                <span>{l.unit}</span>
                                            </div>
                                        ) : (l.counted != null ? fmtQty(l.counted, l.unit) : <span className="muted">not counted</span>)}
                                    </td>
                                    {(!open || showExpected) && <td>{fmtQty(l.expected, l.unit)}</td>}
                                    {!open && <td className={l.variance < 0 ? 'neg' : l.variance > 0 ? 'pos' : ''}>
                                        {l.variance == null ? '' : `${l.variance > 0 ? '+' : ''}${fmtQty(l.variance, l.unit)}`}</td>}
                                    {!open && seeCost && <td className={l.value < 0 ? 'neg' : ''}>{l.value == null ? '' : fmtMoney(l.value)}</td>}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                {count.lines.length === 0 && <p className="muted">No items to count at this location. Add stock items or choose "Everything".</p>}
                {error && <p className="error-message">{error}</p>}
            </div>
            {open && (
                <div className="modal-footer">
                    {hasPerm('inventory.edit') && <button className="btn btn-ghost" onClick={cancel}><FiX /> Cancel count</button>}
                    <button className="btn btn-ghost" onClick={onClose}>Save &amp; close</button>
                    {hasPerm('inventory.edit') && <button className="btn btn-primary" disabled={busy} onClick={post}><FiCheck /> Post count</button>}
                </div>
            )}
        </Modal>
    );
};

const StartCount = ({ locations, onClose, onStarted }) => {
    const active = locations.filter(l => l.isActive);
    const [locationId, setLocationId] = useState(active.find(l => l.defaultForSales)?._id || active[0]?._id || '');
    const [scope, setScope] = useState('daily');
    const [error, setError] = useState('');
    const submit = async (e) => {
        e.preventDefault();
        try {
            onStarted((await startCount(locationId, scope)).data);
        } catch (err) {
            setError(errorText(err, 'Could not start'));
        }
    };
    return (
        <Modal title="Start a count" onClose={onClose}>
            <form onSubmit={submit}>
                <div className="modal-body">
                    <div className="input-group">
                        <label>Location</label>
                        <select className="input" value={locationId} onChange={e => setLocationId(e.target.value)}>
                            {active.map(l => <option key={l._id} value={l._id}>{l.name}</option>)}
                        </select>
                    </div>
                    <div className="input-group">
                        <label>Items</label>
                        <select className="input" value={scope} onChange={e => setScope(e.target.value)}>
                            {SCOPES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                        </select>
                        <small className="hint">Set how often each item is counted in Stock → Edit.</small>
                    </div>
                    {error && <p className="error-message">{error}</p>}
                </div>
                <div className="modal-footer">
                    <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
                    <button type="submit" className="btn btn-primary">Start</button>
                </div>
            </form>
        </Modal>
    );
};

const CountsTab = ({ locations }) => {
    const { hasPerm } = useAuth();
    const seeCost = hasPerm('sensitive.see_cost');
    const [counts, setCounts] = useState([]);
    const [leaks, setLeaks] = useState([]);
    const [days, setDays] = useState(7);
    const [modal, setModal] = useState(null);

    const load = useCallback(async () => setCounts((await getCounts()).data), []);
    useEffect(() => { load(); }, [load]);
    useEffect(() => { getStockLeaks(days).then(r => setLeaks(r.data)); }, [days, counts]);

    return (
        <div>
            <div className="inv-toolbar">
                <div className="spacer" />
                {hasPerm('inventory.create') && (
                    <button className="btn btn-primary" onClick={() => setModal({ type: 'start' })}><FiClipboard /> Start count</button>
                )}
            </div>

            <section className="panel leaks">
                <div className="reorder-head">
                    <h2>Where stock went missing</h2>
                    <select className="input compact" value={days} onChange={e => setDays(Number(e.target.value))} aria-label="Period">
                        <option value={7}>Last 7 days</option>
                        <option value={30}>Last 30 days</option>
                    </select>
                </div>
                <p className="muted small">Count shortfall (counted less than the sales and recipes say should be there) plus recorded wastage.</p>
                {leaks.length === 0 ? <p className="muted">No shortfall or wastage recorded in this period.</p> : (
                    <table className="staff-table">
                        <thead><tr><th>Item</th><th>Count shortfall</th><th>Wastage</th>{seeCost && <th>₹ lost</th>}</tr></thead>
                        <tbody>
                            {leaks.slice(0, 10).map(l => (
                                <tr key={l.itemId}>
                                    <td><strong>{l.item}</strong></td>
                                    <td className={l.countVariance < 0 ? 'neg' : ''}>{l.countVariance < 0 ? fmtQty(l.countVariance, l.unit) : '—'}</td>
                                    <td>{l.wastage > 0 ? fmtQty(l.wastage, l.unit) : '—'}</td>
                                    {seeCost && <td className="neg">{fmtMoney(l.lostValue)}</td>}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </section>

            <h2 className="section-title">Counts</h2>
            <div className="table-scroll">
                <table className="staff-table">
                    <thead><tr><th>Started</th><th>Location</th><th>Items</th><th>Status</th>{seeCost && <th>Variance</th>}<th>By</th><th aria-label="Actions" /></tr></thead>
                    <tbody>
                        {counts.map(c => (
                            <tr key={c.id}>
                                <td>{fmtDateTime(c.createdAt)}</td>
                                <td><strong>{c.location}</strong></td>
                                <td>{c.counted}/{c.lines}</td>
                                <td><span className={`pill ${c.status === 'open' ? 'warn' : c.status === 'posted' ? 'ok' : 'muted'}`}>{c.status}</span></td>
                                {seeCost && <td className={c.varianceValue < 0 ? 'neg' : ''}>{c.status === 'posted' ? fmtMoney(c.varianceValue) : ''}</td>}
                                <td className="small">{c.postedBy || c.startedBy}</td>
                                <td><button className="link-btn" onClick={() => setModal({ type: 'sheet', id: c.id })}>{c.status === 'open' ? 'Continue' : 'View'}</button></td>
                            </tr>
                        ))}
                        {counts.length === 0 && <tr><td colSpan={7} className="empty muted">No counts yet. Count daily items (milk, paneer, cigarettes) every evening, the rest weekly.</td></tr>}
                    </tbody>
                </table>
            </div>

            {modal?.type === 'start' && <StartCount locations={locations} onClose={() => setModal(null)} onStarted={(id) => { load(); setModal({ type: 'sheet', id }); }} />}
            {modal?.type === 'sheet' && <CountSheet id={modal.id} onClose={() => { setModal(null); load(); }} onChanged={load} />}
        </div>
    );
};

export default CountsTab;
