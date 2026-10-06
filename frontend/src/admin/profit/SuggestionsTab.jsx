import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FiRefreshCw, FiChevronDown, FiChevronUp } from 'react-icons/fi';
import { getProfitSuggestions, runProfitChecks, decideSuggestion, applySuggestionPrice } from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import { inr } from '../pos/money';

const errorText = (err) => err?.response?.data?.message || err?.message || 'Something went wrong';
const AREA = { menu: 'Menu', inventory: 'Inventory', costs: 'Costs', sales: 'Sales', customers: 'Customers', marketing: 'Marketing',
    profit: 'Profit', cash: 'Cash', kiosk: 'Kiosk' };
const when = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'never');

const Card = ({ s, onChange, canPrice, canDecide }) => {
    const [open, setOpen] = useState(false);
    const [msg, setMsg] = useState('');
    const act = async (fn) => { try { await fn(); onChange(); } catch (err) { setMsg(errorText(err)); } };
    const dismiss = () => {
        const reason = window.prompt('Why not? (helps judge the advice later)');
        if (reason) act(() => decideSuggestion(s.id, 'dismissed', reason));
    };
    return (
        <div className={`sg-card p${s.priority}`}>
            <div className="sg-head">
                <div>
                    <span className="sg-area">{AREA[s.area] || s.area}{s.priority === 1 && ' · today'}</span>
                    <h3>{s.title}</h3>
                </div>
                {Number(s.impact) > 0 && <div className="sg-impact"><strong>+{inr(Math.round(s.impact))}</strong><span>a month</span></div>}
            </div>
            <p>{s.detail}</p>
            <button className="sg-why" onClick={() => setOpen(o => !o)} aria-expanded={open}>{open ? <FiChevronUp /> : <FiChevronDown />} Why?</button>
            {open && (
                <div className="sg-math">
                    {s.inputs.length > 0 && <ul>{s.inputs.map(i => <li key={i.label}><span>{i.label}</span><strong>{String(i.value)}</strong></li>)}</ul>}
                    {s.formula && <p><strong>Formula:</strong> {s.formula}</p>}
                    {s.assumption && <p><strong>Assumes:</strong> {s.assumption}</p>}
                    <p className="muted small">Worked out from your own sales, recipes, stock and expenses — no outside AI. First seen {when(s.firstSeen)}.</p>
                </div>
            )}
            {s.status === 'open' ? (
                <div className="sg-actions">
                    {s.actions.map(a => (a.kind === 'price'
                        ? canPrice && <button key={a.label} className="btn btn-primary btn-sm" onClick={() => window.confirm(`${a.label}?`) && act(() => applySuggestionPrice(s.id, a.price))}>{a.label}</button>
                        : <Link key={a.label} className="btn btn-secondary btn-sm" to={a.link}>{a.label}</Link>))}
                    {canDecide && (
                        <>
                            <button className="btn btn-ghost btn-sm" onClick={() => act(() => decideSuggestion(s.id, 'accepted', 'Done'))}>Mark done</button>
                            <button className="btn btn-ghost btn-sm" onClick={() => act(() => decideSuggestion(s.id, 'snoozed', '', 14))}>Remind me in 2 weeks</button>
                            <button className="btn btn-ghost btn-sm" onClick={dismiss}>Dismiss</button>
                        </>
                    )}
                </div>
            ) : (
                <p className="small"><span className={`pill ${s.status === 'accepted' ? 'ok' : 'muted'}`}>{s.status}</span> {s.decidedBy && `by ${s.decidedBy}, ${when(s.decidedAt)}`}
                    {s.reason && ` · ${s.reason}`}{s.status === 'snoozed' && ` · back ${when(s.snoozeUntil)}`}
                    {s.outcome ? <><br /><strong>{s.outcome}</strong></> : s.status !== 'snoozed' && <><br /><span className="muted">Result shows 4 weeks after the decision.</span></>}</p>
            )}
            {msg && <p className="error-message">{msg}</p>}
        </div>
    );
};

// Ranked suggestions from ~18 checks on the cafe's own data
const SuggestionsTab = ({ status = 'open' }) => {
    const { hasPerm } = useAuth();
    const [data, setData] = useState(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const load = useCallback(async () => {
        try { setData((await getProfitSuggestions(status)).data); } catch (err) { setError(errorText(err)); }
    }, [status]);
    const runNow = useCallback(async () => {
        setBusy(true);
        try { await runProfitChecks(); await load(); } catch (err) { setError(errorText(err)); } finally { setBusy(false); }
    }, [load]);
    useEffect(() => {
        load().then(() => {});
    }, [load]);
    // Run automatically when the last run is over 12 hours old
    useEffect(() => {
        if (data && status === 'open' && (!data.lastRun || Date.now() - new Date(data.lastRun).getTime() > 12 * 3600e3)) runNow();
    }, [data, status, runNow]);

    if (!data) return <p>{error || 'Loading…'}</p>;
    return (
        <div>
            {status === 'open' && (
                <div className="inv-toolbar">
                    <div className="sg-total"><span>Open suggestions are worth</span><strong>{inr(Math.round(data.totalImpact))}</strong><span>a month</span></div>
                    {hasPerm('finance.edit') && <button className="btn btn-ghost btn-sm" onClick={runNow} disabled={busy}><FiRefreshCw /> {busy ? 'Checking…' : 'Check now'}</button>}
                    <span className="muted small">Last checked {when(data.lastRun)}</span>
                </div>
            )}
            {error && <p className="error-message">{error}</p>}
            <div className="sg-list">
                {data.items.map(s => <Card key={s.id} s={s} onChange={load} canPrice={hasPerm('menu.edit')} canDecide={hasPerm('finance.edit')} />)}
                {data.items.length === 0 && <p className="muted empty">{status === 'open' ? 'Nothing to fix right now. Checks run twice a day.' : 'No decisions yet.'}</p>}
            </div>
        </div>
    );
};

export default SuggestionsTab;
