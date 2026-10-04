import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FiPlus, FiTrash2, FiCopy, FiExternalLink, FiCheck, FiMonitor } from 'react-icons/fi';
import { QRCodeSVG } from 'qrcode.react';
import {
    getPickupScreens, createPickupScreen, deletePickupScreen, getPickupStaffBoard, setKitchenStatus, getSettings, updateSetting,
} from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import { errorText } from '../inventory/shared';
import '../AdminCustomerApp.css';
import './PickupScreen.css';

const linkFor = (key) => `${window.location.origin}/display/${key}`;
const online = (s) => s.last_seen_at && Date.now() - new Date(s.last_seen_at).getTime() < 30000;
const mins = (iso) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));

// Live miniature of the TV: the real page at 1600×900, scaled to fit the card
const PreviewFrame = ({ src, title }) => {
    const ref = useRef();
    const [scale, setScale] = useState(0.3);
    useEffect(() => {
        const el = ref.current;
        if (!el) return undefined;
        const ro = new ResizeObserver(() => setScale(el.clientWidth / 1600));
        ro.observe(el);
        return () => ro.disconnect();
    }, []);
    return (
        <div className="pk-preview" ref={ref} aria-hidden="true">
            <iframe title={title} src={src} tabIndex={-1} style={{ '--s': scale }} />
        </div>
    );
};

// Admin → Sell → Pickup screen: links for the cafe TV, what it shows, and a Collected button per order
const AdminPickupScreen = () => {
    const { hasPerm } = useAuth();
    const canEdit = hasPerm('settings.edit');
    const canServe = hasPerm('orders.edit');
    const [screens, setScreens] = useState([]);
    const [board, setBoard] = useState(null);
    const [cfg, setCfg] = useState(null);
    const [name, setName] = useState('');
    const [msg, setMsg] = useState('');
    const [copied, setCopied] = useState('');

    const flash = (t) => { setMsg(t); setTimeout(() => setMsg(''), 2500); };
    const loadBoard = useCallback(() => getPickupStaffBoard().then(r => setBoard(r.data)).catch(() => {}), []);
    const loadScreens = useCallback(() => getPickupScreens().then(r => setScreens(r.data)).catch(() => {}), []);

    useEffect(() => {
        loadScreens();
        loadBoard();
        getSettings().then(r => setCfg({
            showNames: r.data.pickup_show_names !== false,
            includeTables: r.data.pickup_include_tables === true,
            readyMinutes: Number(r.data.pickup_ready_minutes) || 10,
            message: typeof r.data.pickup_message === 'string' ? r.data.pickup_message : '',
        })).catch(() => {});
        const i = setInterval(() => { loadBoard(); loadScreens(); }, 5000);
        return () => clearInterval(i);
    }, [loadBoard, loadScreens]);

    const save = async (key, value, patch) => {
        try { await updateSetting(key, value); setCfg(c => ({ ...c, ...patch })); loadBoard(); flash('Saved. The screen updates within a few seconds.'); } catch (err) { flash(errorText(err)); }
    };
    const add = async () => {
        try { await createPickupScreen(name.trim() || 'Pickup screen'); setName(''); loadScreens(); } catch (err) { flash(errorText(err)); }
    };
    const remove = async (s) => {
        if (!window.confirm(`Remove "${s.name}"? Its link stops working at once.`)) return;
        try { await deletePickupScreen(s.id); loadScreens(); } catch (err) { flash(errorText(err)); }
    };
    const copy = async (s) => {
        try { await navigator.clipboard.writeText(linkFor(s.key)); setCopied(s.id); setTimeout(() => setCopied(''), 2000); } catch { window.prompt('Copy this link', linkFor(s.key)); }
    };
    const markReady = async (o) => {
        try { await setKitchenStatus(o.id, null, 'ready'); loadBoard(); } catch (err) { flash(errorText(err)); }
    };
    const collected = async (o) => {
        try { await setKitchenStatus(o.id, null, 'served'); loadBoard(); } catch (err) { flash(errorText(err)); }
    };

    return (
        <div className="pickup-admin">
            <div className="page-header">
                <div>
                    <h1>Pickup screen</h1>
                    <p className="muted">A big TV in the cafe shows which orders are being prepared and which are ready to collect at the counter.</p>
                </div>
            </div>
            {msg && <div className="ca-flash" role="status">{msg}</div>}

            <div className="pk-grid">
                <section className="pk-card">
                    <h2>Ready to collect <span className="pk-count ready">{board?.ready?.length || 0}</span></h2>
                    <p className="muted small">Tap <b>Collected</b> when you hand an order over. It leaves the TV straight away.</p>
                    {!board?.ready?.length && <p className="pk-empty">Nothing waiting at the counter.</p>}
                    <div className="pk-list">
                        {(board?.ready || []).map(o => (
                            <div key={o.id} className="pk-row ready">
                                <span className="pk-num">{o.label}</span>
                                <span className="pk-who">{o.name || (o.table ? `Table ${o.table}` : '')}<small>{mins(o.readyAt) < 1 ? 'just now' : `${mins(o.readyAt)} min`}</small></span>
                                {canServe && <button className="btn btn-success btn-sm" onClick={() => collected(o)}><FiCheck /> Collected</button>}
                            </div>
                        ))}
                    </div>
                    <h2 className="pk-sub">Preparing <span className="pk-count">{board?.preparing?.length || 0}</span></h2>
                    <div className="pk-chips">
                        {(board?.preparing || []).map(o => (
                            canServe
                                ? <button key={o.id} className={`pk-chip ${o.started ? 'started' : ''}`} title={`${o.name || o.label}: tap when it's ready`} onClick={() => markReady(o)}>{o.label}<FiCheck /></button>
                                : <span key={o.id} className={`pk-chip ${o.started ? 'started' : ''}`} title={o.name}>{o.label}</span>
                        ))}
                        {!board?.preparing?.length && <p className="pk-empty">Kitchen is clear.</p>}
                    </div>
                    <p className="muted small">Tap a number when it's ready, or mark dishes on the <a href="/admin/kitchen">Kitchen</a> screen. Orders older than 2 hours drop off by themselves.</p>
                </section>

                <section className="pk-card">
                    <h2>Screens</h2>
                    {screens.length === 0 && <p className="pk-empty">No screen yet. Add one, then open its link on the TV.</p>}
                    {screens.map(s => (
                        <div key={s.id} className="pk-screen">
                            <div className="pk-screen-head">
                                <FiMonitor />
                                <strong>{s.name}</strong>
                                <span className={`pk-status ${online(s) ? 'on' : ''}`}>{online(s) ? 'On now' : s.last_seen_at ? `Last seen ${new Date(s.last_seen_at).toLocaleString('en-IN', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}` : 'Not opened yet'}</span>
                            </div>
                            <div className="pk-screen-body">
                                <QRCodeSVG value={linkFor(s.key)} size={96} marginSize={1} />
                                <div className="pk-screen-link">
                                    <code>{linkFor(s.key)}</code>
                                    <div className="pk-actions">
                                        <button className="btn btn-secondary btn-sm" onClick={() => copy(s)}>{copied === s.id ? <><FiCheck /> Copied</> : <><FiCopy /> Copy link</>}</button>
                                        <a className="btn btn-ghost btn-sm" href={linkFor(s.key)} target="_blank" rel="noreferrer"><FiExternalLink /> Open</a>
                                        {canEdit && <button className="btn btn-ghost btn-sm danger" onClick={() => remove(s)}><FiTrash2 /> Remove</button>}
                                    </div>
                                </div>
                            </div>
                            <PreviewFrame src={`${linkFor(s.key)}?preview=1`} title={`${s.name} preview`} />
                        </div>
                    ))}
                    {canEdit && screens.length < 5 && (
                        <div className="ca-inline">
                            <input className="input" value={name} maxLength={40} placeholder="Screen name, e.g. Counter TV" onChange={e => setName(e.target.value)} />
                            <button className="btn btn-primary" onClick={add}><FiPlus /> Add screen</button>
                        </div>
                    )}

                    <h2 className="pk-sub">What the screen shows</h2>
                    {cfg && (
                        <>
                            <label className="ca-toggle">
                                <span className="ca-toggle-copy"><strong>First names under the number</strong><small>Off shows only the number</small></span>
                                <input type="checkbox" disabled={!canEdit} checked={cfg.showNames} onChange={e => save('pickup_show_names', e.target.checked, { showNames: e.target.checked })} />
                                <span className="ca-switch" aria-hidden="true" />
                            </label>
                            <label className="ca-toggle">
                                <span className="ca-toggle-copy"><strong>Include table orders</strong><small>Turn on if customers at tables also collect from the counter (busy hours, self-service)</small></span>
                                <input type="checkbox" disabled={!canEdit} checked={cfg.includeTables} onChange={e => save('pickup_include_tables', e.target.checked, { includeTables: e.target.checked })} />
                                <span className="ca-switch" aria-hidden="true" />
                            </label>
                            <div className="ca-theme">
                                <span className="ca-toggle-copy"><strong>Ready orders stay for</strong><small>If nobody taps Collected, the number leaves the screen after this</small></span>
                                <select className="input pk-select" disabled={!canEdit} value={cfg.readyMinutes} onChange={e => save('pickup_ready_minutes', Number(e.target.value), { readyMinutes: Number(e.target.value) })}>
                                    {[5, 10, 15, 20, 30].map(m => <option key={m} value={m}>{m} minutes</option>)}
                                </select>
                            </div>
                            <div className="input-group" style={{ marginTop: 10 }}><label>Message at the top</label>
                                <div className="ca-inline">
                                    <input className="input" maxLength={80} disabled={!canEdit} value={cfg.message} placeholder="Please collect your order from the serving counter"
                                        onChange={e => setCfg(c => ({ ...c, message: e.target.value }))} />
                                    <button className="btn btn-primary" disabled={!canEdit} onClick={() => save('pickup_message', cfg.message.trim(), {})}>Save</button>
                                </div>
                            </div>
                            <p className="muted small">The scrolling line at the bottom uses the announcement from <a href="/admin/customer-app">Customer app</a>.</p>
                        </>
                    )}

                    <h2 className="pk-sub">Setting up the TV</h2>
                    <ol className="pk-steps">
                        <li>Any TV with a web browser works: a smart TV, a Fire TV Stick or Chromecast with a browser, or an old laptop on HDMI.</li>
                        <li>Open the screen link in the TV browser. Type it once and bookmark it, or scan the QR with a tablet.</li>
                        <li>Tap the screen once: this turns on the chime and full screen.</li>
                        <li>In the TV settings, switch off sleep / screen saver. The page keeps itself up to date; no login is needed.</li>
                    </ol>
                </section>
            </div>
        </div>
    );
};

export default AdminPickupScreen;
