import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FiPlus, FiEdit2, FiTrash2, FiArrowUp, FiArrowDown, FiImage, FiExternalLink } from 'react-icons/fi';
import {
    getSettings, updateSetting, getPortalConfig, savePortalBanners, uploadBannerImage, getAllMenuItems, getAllCategories,
} from '../utils/api';
import { useAuth } from '../context/AuthContext';
import { usePortal } from '../context/PortalContext';
import { errorText } from './inventory/shared';
import Modal from './inventory/Modal';
import { BannerSlide } from '../components/cx/BannerCarousel';
import { BANNER_STYLES } from '../components/cx/palettes';
import './AdminCustomerApp.css';
import InfoTip from './help/InfoTip';

const MODES = [
    ['qr', 'From the QR (locked)', 'Scanning a table QR sets the table. No dropdown, nothing to choose.'],
    ['pick', 'Customer picks', 'For cafes without table QRs: customers choose their table at checkout.'],
    ['none', 'No tables', 'Counter pickup or token only. Table QRs just open the menu.'],
];
const SHOW = [
    ['rewardBar', 'Reward progress bar', '"2 orders to a free coffee" on the home page'],
    ['photos', 'Item photos', 'Off = a compact list without pictures'],
    ['badges', 'Badges', 'Bestseller, New, Chef\'s pick'],
    ['infoButtons', 'ⓘ info buttons', 'Short explanations of tables, points and rewards'],
];
const REMINDERS = [
    ['nudgeMilestone', 'Order milestones', '"This will be your 23rd order" at checkout, "1 more order to your reward"'],
    ['nudgePoints', 'Points ready to use', 'Only when the points can actually be used on that bill'],
    ['nudgeCelebrate', 'Celebration', 'Confetti and a thank-you when an order is placed'],
];
const LINKS = [['none', 'No link'], ['menu', 'Menu'], ['category', 'A category'], ['item', 'An item'], ['rewards', 'Rewards page'], ['url', 'Web link']];
const EMPTY = { title: '', text: '', tag: '', cta: 'Order now', linkType: 'menu', linkTo: '', style: 'saffron', image: '', from: '', to: '', active: true };

const Toggle = ({ checked, onChange, disabled, label, hint, tip }) => (
    <label className={`ca-toggle ${disabled ? 'disabled' : ''}`}>
        <span className="ca-toggle-copy"><strong>{label}{tip && <InfoTip k={tip} />}</strong>{hint && <small>{hint}</small>}</span>
        <input type="checkbox" checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} />
        <span className="ca-switch" aria-hidden="true" />
    </label>
);

const BannerEditor = ({ banner, items, categories, onClose, onSave }) => {
    const [b, setB] = useState({ ...EMPTY, ...banner });
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const set = (k, v) => setB(prev => ({ ...prev, [k]: v }));
    const item = items.find(i => i._id === b.linkTo);
    const upload = async (file) => {
        if (!file) return;
        setBusy(true);
        try { set('image', await uploadBannerImage(file)); } catch (err) { setError(errorText(err, 'Upload failed')); } finally { setBusy(false); }
    };
    const save = async () => {
        setBusy(true);
        setError('');
        try { await onSave(b); } catch (err) { setError(errorText(err, 'Could not save')); setBusy(false); }
    };
    return (
        <Modal title={banner?.id ? 'Edit banner' : 'New banner'} onClose={onClose} wide>
            <div className="modal-body ca-editor">
                <div className="ca-preview">
                    <BannerSlide b={{ ...b, item: b.linkType === 'item' && item ? { image: item.image } : null }} />
                    <small className="muted">Preview, as customers see it</small>
                </div>
                <div className="form-grid">
                    <div className="input-group"><label>Headline</label>
                        <input className="input" maxLength={60} value={b.title} onChange={e => set('title', e.target.value)} placeholder="Dosa Tuesday" autoFocus /></div>
                    <div className="input-group"><label>Small label <span className="hint">optional</span></label>
                        <input className="input" maxLength={24} value={b.tag} onChange={e => set('tag', e.target.value)} placeholder="Today only" /></div>
                </div>
                <div className="input-group"><label>Text</label>
                    <input className="input" maxLength={120} value={b.text} onChange={e => set('text', e.target.value)} placeholder="Flat ₹20 off every dosa" /></div>
                <div className="form-grid">
                    <div className="input-group"><label>Opens</label>
                        <select className="input" value={b.linkType} onChange={e => setB(prev => ({ ...prev, linkType: e.target.value, linkTo: '' }))}>
                            {LINKS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                        </select></div>
                    {b.linkType === 'category' && (
                        <div className="input-group"><label>Category</label>
                            <select className="input" value={b.linkTo} onChange={e => set('linkTo', e.target.value)}>
                                <option value="">Choose…</option>
                                {categories.map(c => <option key={c._id} value={c._id}>{c.name}</option>)}
                            </select></div>
                    )}
                    {b.linkType === 'item' && (
                        <div className="input-group"><label>Item <span className="hint">shop items only; restricted items can't be promoted</span></label>
                            <select className="input" value={b.linkTo} onChange={e => set('linkTo', e.target.value)}>
                                <option value="">Choose…</option>
                                {items.map(i => <option key={i._id} value={i._id}>{i.name} · ₹{i.price}</option>)}
                            </select></div>
                    )}
                    {b.linkType === 'url' && (
                        <div className="input-group"><label>Web link</label>
                            <input className="input" value={b.linkTo} onChange={e => set('linkTo', e.target.value)} placeholder="https://instagram.com/…" /></div>
                    )}
                    {b.linkType !== 'none' && (
                        <div className="input-group"><label>Button text</label>
                            <input className="input" maxLength={24} value={b.cta} onChange={e => set('cta', e.target.value)} placeholder="Order now" /></div>
                    )}
                </div>
                <div className="input-group"><label>Colour <span className="hint">used when there's no picture</span></label>
                    <div className="ca-swatches">
                        {Object.entries(BANNER_STYLES).map(([k, s]) => (
                            <button key={k} type="button" className={b.style === k ? 'on' : ''} style={{ background: s.bg }} title={s.label} aria-label={s.label}
                                onClick={() => set('style', k)} />
                        ))}
                    </div></div>
                <div className="input-group"><label>Picture <span className="hint">optional, wide photos work best</span></label>
                    <div className="ca-image-row">
                        <label className="btn btn-secondary btn-sm"><FiImage /> {b.image ? 'Change picture' : 'Upload picture'}
                            <input type="file" accept="image/*" hidden onChange={e => upload(e.target.files?.[0])} /></label>
                        {b.image && <button type="button" className="btn btn-ghost btn-sm" onClick={() => set('image', '')}>Remove picture</button>}
                    </div></div>
                <div className="form-grid">
                    <div className="input-group"><label>Show from <span className="hint">optional</span></label>
                        <input className="input" type="date" value={b.from} onChange={e => set('from', e.target.value)} /></div>
                    <div className="input-group"><label>Until <span className="hint">optional</span></label>
                        <input className="input" type="date" value={b.to} onChange={e => set('to', e.target.value)} /></div>
                </div>
                <Toggle label="Switched on" checked={b.active} onChange={v => set('active', v)} />
                {error && <p className="error-message">{error}</p>}
            </div>
            <div className="modal-footer">
                <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
                <button className="btn btn-primary" disabled={busy || (!b.title.trim() && !b.image)} onClick={save}>Save banner</button>
            </div>
        </Modal>
    );
};

const bannerStatus = (b) => {
    const today = new Date().toISOString().slice(0, 10);
    if (!b.active) return ['off', 'Off'];
    if (b.from && b.from > today) return ['soon', `Starts ${b.from}`];
    if (b.to && b.to < today) return ['ended', 'Ended'];
    return ['live', b.to ? `Live till ${b.to}` : 'Live'];
};

// Admin → Menu → Customer app: tables and QR behaviour, banners, announcement, what customers see, reminders
const AdminCustomerApp = () => {
    const { hasPerm } = useAuth();
    const { refresh } = usePortal();
    const canEdit = hasPerm('settings.edit');
    const [raw, setRaw] = useState(null);
    const [show, setShow] = useState({});
    const [tables, setTables] = useState({});
    const [banners, setBanners] = useState([]);
    const [announce, setAnnounce] = useState({ on: false, text: '' });
    const [items, setItems] = useState([]);
    const [categories, setCategories] = useState([]);
    const [editing, setEditing] = useState(null);
    const [msg, setMsg] = useState('');

    useEffect(() => {
        (async () => {
            const [s, cfg] = await Promise.all([getSettings(), getPortalConfig()]);
            setRaw(s.data);
            setShow(cfg.data.show || {});
            setTables(cfg.data.tables || {});
            setBanners(Array.isArray(s.data.portal_banners) ? s.data.portal_banners : []);
            setAnnounce({ on: false, text: '', ...(s.data.portal_announcement || {}) });
            getAllMenuItems().then(r => setItems(r.data.filter(i => i.soldInShop !== false && !i.isRestricted))).catch(() => {});
            getAllCategories().then(r => setCategories(r.data)).catch(() => {});
        })().catch(err => setMsg(errorText(err)));
    }, []);

    const flash = (text) => { setMsg(text); setTimeout(() => setMsg(''), 2500); };
    const saveSetting = async (key, value, after) => {
        try { await updateSetting(key, value); after?.(); refresh?.(); flash('Saved. Customers see it straight away.'); } catch (err) { flash(errorText(err)); }
    };
    const setTable = (key, settingKey, value) => saveSetting(settingKey, value, () => setTables(t => ({ ...t, [key]: value })));
    const setShowKey = (key, value) => {
        const next = { ...show, [key]: value };
        saveSetting('portal_show', next, () => setShow(next));
    };
    const saveBanners = async (list) => {
        const saved = (await savePortalBanners(list)).data;
        setBanners(saved);
        refresh?.();
        flash('Banners saved');
    };
    const move = (i, d) => {
        const list = [...banners];
        [list[i], list[i + d]] = [list[i + d], list[i]];
        saveBanners(list).catch(err => flash(errorText(err)));
    };
    const live = useMemo(() => banners.filter(b => bannerStatus(b)[0] === 'live').length, [banners]);

    if (!raw) return <div className="admin-loading"><div className="spinner" /></div>;

    return (
        <div className="customer-app-admin">
            <div className="page-header">
                <div>
                    <h1>Customer app</h1>
                    <p className="muted">What customers see when they scan a table QR. Changes show on their phones straight away.</p>
                </div>
                <a className="btn btn-secondary" href="/" target="_blank" rel="noreferrer"><FiExternalLink /> Open customer app</a>
            </div>
            {!canEdit && <p className="ca-note">You can look, but only staff with "Edit settings" can change these.</p>}
            {msg && <div className="ca-flash" role="status">{msg}</div>}

            <section className="ca-card">
                <h2>Tables and QR codes</h2>
                <div className="ca-modes">
                    {MODES.map(([k, l, h]) => (
                        <label key={k} className={`ca-mode ${tables.mode === k ? 'on' : ''}`}>
                            <input type="radio" name="mode" disabled={!canEdit} checked={tables.mode === k} onChange={() => setTable('mode', 'table_mode', k)} />
                            <strong>{l}</strong><small>{h}</small>
                        </label>
                    ))}
                </div>
                {tables.mode !== 'none' && (
                    <>
                        <Toggle disabled={!canEdit} checked={!!tables.shared} onChange={v => setTable('shared', 'table_shared', v)}
                            label="Tables can be shared by several groups" hint='Each person orders and pays on their own. Nobody is told "table occupied".' />
                        <Toggle disabled={!canEdit} checked={!!tables.confirmFirst} onChange={v => setTable('confirmFirst', 'table_confirm_first', v)}
                            tip="confirm_first" label="Staff confirm a table's first order" hint="Stops orders from a QR photo sent outside the cafe. The kitchen gets it after a staff member taps Confirm." />
                        <Toggle disabled={!canEdit} checked={!!tables.legacyLinks} onChange={v => setTable('legacyLinks', 'table_legacy_links', v)}
                            label="Old printed QR codes still work" hint="Turn off once every table has the new QR from the Tables page." />
                        <p className="muted small">Print or re-issue table QR codes on the <Link to="/admin/tables">Tables</Link> page.</p>
                    </>
                )}
                <Toggle disabled={!canEdit} checked={tables.acceptAll !== false} onChange={v => setTable('acceptAll', 'qr_accept_all', v)}
                    tip="accept_all" label="Staff accept every QR order before the kitchen sees it" hint="Each QR order rings full screen; it reaches the kitchen only after someone taps Accept. Off: QR orders go to the kitchen as soon as they are placed." />
            </section>

            <section className="ca-card">
                <div className="ca-card-head">
                    <h2>Banners<InfoTip k="banners" /> <span className="muted small">{live} live</span></h2>
                    {canEdit && banners.length < 12 && <button className="btn btn-primary btn-sm" onClick={() => setEditing({})}><FiPlus /> Add banner</button>}
                </div>
                <p className="muted small">Slides at the top of the home page and menu. Each can open an item, a category or the rewards page, and run between dates.</p>
                {banners.length === 0 && <p className="ca-empty">No banners yet. The home page shows the standard welcome picture until you add one.</p>}
                <div className="ca-banners">
                    {banners.map((b, i) => {
                        const [cls, label] = bannerStatus(b);
                        return (
                            <div key={b.id} className="ca-banner-row">
                                <div className="ca-banner-thumb"><BannerSlide b={b} /></div>
                                <div className="ca-banner-meta">
                                    <span className={`ca-pill ${cls}`}>{label}</span>
                                    <span className="small muted">{LINKS.find(l => l[0] === b.linkType)?.[1] || 'No link'}</span>
                                </div>
                                {canEdit && (
                                    <div className="ca-banner-actions">
                                        <button className="icon-btn" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}><FiArrowUp /></button>
                                        <button className="icon-btn" aria-label="Move down" disabled={i === banners.length - 1} onClick={() => move(i, 1)}><FiArrowDown /></button>
                                        <button className="icon-btn edit" aria-label="Edit" onClick={() => setEditing(b)}><FiEdit2 /></button>
                                        <button className="icon-btn delete" aria-label="Delete" onClick={() => {
                                            if (window.confirm('Delete this banner?')) saveBanners(banners.filter(x => x.id !== b.id)).catch(err => flash(errorText(err)));
                                        }}><FiTrash2 /></button>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </section>

            <section className="ca-card">
                <h2>Announcement strip<InfoTip k="announcement" /></h2>
                <Toggle disabled={!canEdit} checked={!!announce.on} label="Show the strip" hint="A one-line message above the banners"
                    onChange={v => saveSetting('portal_announcement', { ...announce, on: v }, () => setAnnounce(a => ({ ...a, on: v })))} />
                <div className="ca-inline">
                    <input className="input" maxLength={140} disabled={!canEdit} value={announce.text} placeholder="Live music this Friday, 8 pm 🎶"
                        onChange={e => setAnnounce(a => ({ ...a, text: e.target.value }))} />
                    <button className="btn btn-primary" disabled={!canEdit} onClick={() => saveSetting('portal_announcement', announce)}>Save</button>
                </div>
            </section>

            <section className="ca-card">
                <h2>What customers see</h2>
                {SHOW.map(([k, l, h]) => <Toggle key={k} disabled={!canEdit} checked={show[k] !== false} label={l} hint={h} onChange={v => setShowKey(k, v)} />)}
                <div className="ca-theme">
                    <span className="ca-toggle-copy"><strong>Colours, logo and font</strong><small>Set once for the customer app, staff app, kiosk and pickup TV</small></span>
                    <Link className="btn btn-ghost btn-sm" to="/admin/brand">Brand &amp; look →</Link>
                </div>
                <p className="muted small">Slogans on the Rewards page are edited under <Link to="/admin/rewards?tab=portal">Rewards → Customer portal</Link>.</p>
            </section>

            <section className="ca-card">
                <h2>Reminders</h2>
                <p className="muted small">Never in the way: one at a time, hides itself after 5 seconds, each kind once per visit, never covers the Order button.</p>
                {REMINDERS.map(([k, l, h]) => <Toggle key={k} disabled={!canEdit} checked={show[k] !== false} label={l} hint={h} onChange={v => setShowKey(k, v)} />)}
            </section>

            {editing && (
                <BannerEditor banner={editing} items={items} categories={categories} onClose={() => setEditing(null)}
                    onSave={async (b) => {
                        const list = b.id ? banners.map(x => (x.id === b.id ? b : x)) : [...banners, b];
                        await saveBanners(list);
                        setEditing(null);
                    }} />
            )}
        </div>
    );
};

export default AdminCustomerApp;
