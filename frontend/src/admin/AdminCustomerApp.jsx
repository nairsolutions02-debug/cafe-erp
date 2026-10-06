import React, { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { FiPlus, FiEdit2, FiTrash2, FiArrowUp, FiArrowDown, FiImage, FiExternalLink, FiArrowRight } from 'react-icons/fi';
import {
    getSettings, updateSetting, getPortalConfig, savePortalBanners, uploadBannerImage, getAllMenuItems, getAllCategories, getCombos,
} from '../utils/api';
import { useAuth } from '../context/AuthContext';
import { usePortal } from '../context/PortalContext';
import { errorText } from './inventory/shared';
import Modal from './inventory/Modal';
import { BANNER_STYLES, bannerBg, bannerTx } from '../components/cx/palettes';
import Art from '../components/cx/Art';
import { ART_KINDS, ART_LABELS } from '../components/cx/artKinds';
import { getImageUrl } from '../utils/config';
import CxLook from './brand/CxLook';
import { clock } from './menu/menuExtras';
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
const LINKS = [['none', 'No link'], ['menu', 'Menu'], ['category', 'A category'], ['item', 'A dish'], ['combo', 'A combo'], ['rewards', 'Rewards page'], ['url', 'Web link']];
const EMPTY = {
    title: '', titleHi: '', titleHg: '', text: '', textHi: '', textHg: '', tag: '', tagHi: '', tagHg: '', cta: 'Order now', ctaHi: '', ctaHg: '',
    linkType: 'menu', linkTo: '', style: 'saffron', art: '', image: '', from: '', to: '', timeFrom: '', timeTo: '', active: true,
};
// The words on a banner, each in English, हिन्दी and Hinglish (empty Hindi / Hinglish = the English words)
const WORDS = [['tag', 'Small line', 24, 'Today only', 'सिर्फ़ आज', 'Sirf aaj'], ['title', 'Big line', 60, '2 for ₹299', '2 सिर्फ़ ₹299 में', '2 sirf ₹299 mein'],
    ['text', 'Text', 120, 'Any two iced coffees', 'कोई भी दो आइस्ड कॉफ़ी', 'Koi bhi do iced coffee'], ['cta', 'Button', 24, 'Order now', 'अभी मंगाएँ', 'Abhi mangao']];
const LANGS = [['en', 'English', ''], ['hi', 'हिन्दी', 'Hi'], ['hg', 'Hinglish', 'Hg']];
const TABS = [['look', 'Look & themes'], ['banners', 'Banners & strip'], ['settings', 'Tables, pay & more']];

const wordsIn = (b, lang) => {
    const suf = LANGS.find(l => l[0] === lang)?.[2] || '';
    return Object.fromEntries(WORDS.map(([k]) => [k, (suf && b[k + suf]) || b[k]]));
};

// A banner as customers see it: photo, or drawn art on a colour (never emojis)
const BannerPreview = ({ b, lang = 'en', small }) => {
    const w = wordsIn(b, lang);
    const style = b.image ? { backgroundImage: `linear-gradient(90deg, rgba(0,0,0,.62), rgba(0,0,0,.08)), url(${getImageUrl(b.image)})`, color: '#fff' }
        : { background: bannerBg(b), color: bannerTx(b) };
    return (
        <div className={`ca-bprev${small ? ' small' : ''}`} style={style}>
            <div className="ca-bprev-copy">
                {w.tag && <small>{w.tag}</small>}
                {w.title && <b>{w.title}</b>}
                {!small && w.text && <span>{w.text}</span>}
                {!small && w.cta && b.linkType !== 'none' && <em>{w.cta} <FiArrowRight /></em>}
            </div>
            {!b.image && b.art && <Art kind={b.art} className="ca-bprev-art" />}
        </div>
    );
};

const Toggle = ({ checked, onChange, disabled, label, hint, tip }) => (
    <label className={`ca-toggle ${disabled ? 'disabled' : ''}`}>
        <span className="ca-toggle-copy"><strong>{label}{tip && <InfoTip k={tip} />}</strong>{hint && <small>{hint}</small>}</span>
        <input type="checkbox" checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} />
        <span className="ca-switch" aria-hidden="true" />
    </label>
);

const BannerEditor = ({ banner, items, categories, combos, onClose, onSave }) => {
    const [b, setB] = useState({ ...EMPTY, ...banner });
    const [pic, setPic] = useState(banner?.image ? 'photo' : banner?.art || !banner?.id ? 'art' : 'none');
    const [lang, setLang] = useState('en');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const set = (k, v) => setB(prev => ({ ...prev, [k]: v }));
    const upload = async (file) => {
        if (!file) return;
        setBusy(true);
        try { set('image', await uploadBannerImage(file)); } catch (err) { setError(errorText(err, 'Upload failed')); } finally { setBusy(false); }
    };
    const choosePic = (p) => {
        setPic(p);
        if (p !== 'photo') set('image', '');
        if (p === 'art' && !b.art) set('art', 'iced');
        if (p !== 'art') set('art', '');
    };
    const save = async () => {
        if (!!b.timeFrom !== !!b.timeTo) { setError('Fill both times, or leave both empty to show it all day.'); return; }
        if (b.timeFrom && b.timeFrom >= b.timeTo) { setError('The "until" time must be after the "from" time (e.g. 15:00 to 18:00).'); return; }
        setBusy(true);
        setError('');
        const out = { ...b, image: pic === 'photo' ? b.image : '', art: pic === 'art' ? b.art : '' };
        try { await onSave(out); } catch (err) { setError(errorText(err, 'Could not save')); setBusy(false); }
    };
    return (
        <Modal title={banner?.id ? 'Edit banner' : 'New banner'} onClose={onClose} wide>
            <div className="modal-body ca-editor">
                <div className="ca-preview">
                    <BannerPreview b={b} lang={lang} />
                    <div className="ca-preview-foot">
                        <small className="muted">Preview, as customers see it in</small>
                        <span className="ca-seg" role="group" aria-label="Preview language">
                            {LANGS.map(([k, l]) => <button key={k} type="button" className={lang === k ? 'on' : ''} onClick={() => setLang(k)}>{l}</button>)}
                        </span>
                    </div>
                </div>

                <div className="ca-field-head"><strong>Picture<InfoTip k="banner_art" /></strong>
                    <span className="ca-seg" role="group" aria-label="Picture">
                        {[['photo', 'Upload photo'], ['art', 'Drawn art'], ['none', 'Just colour']].map(([k, l]) => (
                            <button key={k} type="button" className={pic === k ? 'on' : ''} onClick={() => choosePic(k)}>{l}</button>
                        ))}
                    </span>
                </div>
                {pic === 'photo' && (
                    <div className="ca-image-row">
                        <label className="btn btn-secondary btn-sm"><FiImage /> {b.image ? 'Change photo' : 'Upload photo'}
                            <input type="file" accept="image/*" hidden onChange={e => upload(e.target.files?.[0])} /></label>
                        {b.image && <button type="button" className="btn btn-ghost btn-sm" onClick={() => set('image', '')}>Remove photo</button>}
                        <small className="muted">Wide photos work best. The words sit on the left.</small>
                    </div>
                )}
                {pic === 'art' && (
                    <div className="ca-arts" role="radiogroup" aria-label="Drawn picture">
                        {ART_KINDS.map(k => (
                            <button key={k} type="button" role="radio" aria-checked={b.art === k} className={b.art === k ? 'on' : ''} onClick={() => set('art', k)}>
                                <span>{ART_LABELS[k]}</span><Art kind={k} />
                            </button>
                        ))}
                    </div>
                )}
                {pic !== 'photo' && (
                    <>
                        <div className="ca-field-head"><strong>Background</strong></div>
                        <div className="ca-bgs" role="radiogroup" aria-label="Background">
                            {Object.entries(BANNER_STYLES).map(([k, s]) => (
                                <button key={k} type="button" role="radio" aria-checked={b.style === k} className={b.style === k ? 'on' : ''}
                                    style={{ background: s.bg, color: s.tx || '#fff' }} onClick={() => set('style', k)}>{s.label}</button>
                            ))}
                        </div>
                    </>
                )}

                <div className="ca-field-head"><strong>Words and button</strong><small className="muted">Empty हिन्दी or Hinglish = the English words</small></div>
                <div className="ca-words">
                    <span /><b>English</b><b>हिन्दी</b><b>Hinglish</b>
                    {WORDS.map(([k, label, max, en, hi, hg]) => (
                        <React.Fragment key={k}>
                            <span className="ca-words-label">{label}</span>
                            <input className="input" maxLength={max} aria-label={`${label} · English`} placeholder={en} value={b[k]} onChange={e => set(k, e.target.value)} />
                            <input className="input" lang="hi" maxLength={max} aria-label={`${label} · हिन्दी`} placeholder={hi} value={b[k + 'Hi']} onChange={e => set(k + 'Hi', e.target.value)} />
                            <input className="input" maxLength={max} aria-label={`${label} · Hinglish`} placeholder={hg} value={b[k + 'Hg']} onChange={e => set(k + 'Hg', e.target.value)} />
                        </React.Fragment>
                    ))}
                </div>

                <div className="form-grid">
                    <div className="input-group"><label>Button opens</label>
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
                        <div className="input-group"><label>Dish <span className="hint">shop dishes only; restricted items can't be promoted</span></label>
                            <select className="input" value={b.linkTo} onChange={e => set('linkTo', e.target.value)}>
                                <option value="">Choose…</option>
                                {items.map(i => <option key={i._id} value={i._id}>{i.name} · ₹{i.price}</option>)}
                            </select></div>
                    )}
                    {b.linkType === 'combo' && (
                        <div className="input-group"><label>Combo</label>
                            <select className="input" value={b.linkTo} onChange={e => set('linkTo', e.target.value)}>
                                <option value="">Choose…</option>
                                {combos.map(c => <option key={c._id} value={c._id}>{c.name} · ₹{Number(c.price)}{c.isActive ? '' : ' (off)'}</option>)}
                            </select>
                            {combos.length === 0 && <small className="muted">No combos yet. Make one in <Link to="/admin/combos">Menu → Combos</Link>.</small>}
                        </div>
                    )}
                    {b.linkType === 'url' && (
                        <div className="input-group"><label>Web link</label>
                            <input className="input" value={b.linkTo} onChange={e => set('linkTo', e.target.value)} placeholder="https://instagram.com/…" /></div>
                    )}
                </div>
                <div className="form-grid">
                    <div className="input-group"><label>Show from date <span className="hint">optional</span></label>
                        <input className="input" type="date" value={b.from} onChange={e => set('from', e.target.value)} /></div>
                    <div className="input-group"><label>Until date <span className="hint">optional</span></label>
                        <input className="input" type="date" value={b.to} onChange={e => set('to', e.target.value)} /></div>
                </div>
                <div className="ca-field-head"><strong>Show between<InfoTip k="banner_times" /></strong><small className="muted">Happy-hour banners switch themselves on and off. Empty = all day.</small></div>
                <div className="ca-times">
                    <input className="input" type="time" aria-label="Show from time" value={b.timeFrom} onChange={e => set('timeFrom', e.target.value)} />
                    <span>to</span>
                    <input className="input" type="time" aria-label="Show until time" value={b.timeTo} onChange={e => set('timeTo', e.target.value)} />
                    {(b.timeFrom || b.timeTo) && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setB(p => ({ ...p, timeFrom: '', timeTo: '' }))}>All day</button>}
                </div>
                <Toggle label="Switched on" checked={b.active} onChange={v => set('active', v)} />
                {error && <p className="error-message" role="alert">{error}</p>}
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
    const hours = b.timeFrom && b.timeTo ? ` · ${clock(b.timeFrom)}–${clock(b.timeTo)}` : '';
    return ['live', (b.to ? `Live till ${b.to}` : 'Live') + hours];
};

// Admin → Menu → Customer app: tables and QR behaviour, banners, announcement, what customers see, reminders
// Ways a customer can pay once the food is served; the words are the standard ones the customer app uses
const PAY_WAYS = [
    ['bill', 'Bring the bill to the table', { en: 'Bring the bill to my table', hi: 'बिल टेबल पर लाइए', hg: 'Bill table pe laao' }],
    ['upi', 'UPI QR at the table', { en: 'Pay by UPI at my table', hi: 'टेबल पर UPI से दूँगा', hg: 'Table pe UPI se dunga' }],
    ['counter', 'Pay at the counter', { en: "I'll pay at the counter", hi: 'काउंटर पर दूँगा', hg: 'Counter pe dunga' }],
];

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
    const [combos, setCombos] = useState([]);
    const [params, setParams] = useSearchParams();
    const tab = TABS.some(([k]) => k === params.get('tab')) ? params.get('tab') : 'look';
    const [msg, setMsg] = useState('');
    const [pay, setPay] = useState(null);

    useEffect(() => {
        (async () => {
            const [s, cfg] = await Promise.all([getSettings(), getPortalConfig()]);
            setRaw(s.data);
            setShow(cfg.data.show || {});
            setTables(cfg.data.tables || {});
            setBanners(Array.isArray(s.data.portal_banners) ? s.data.portal_banners : []);
            setAnnounce({ on: false, text: '', ...(s.data.portal_announcement || {}) });
            const po = s.data.pay_options && typeof s.data.pay_options === 'object' ? s.data.pay_options : {};
            setPay(Object.fromEntries(PAY_WAYS.map(([k]) => [k, { on: po[k]?.on !== false, text: { en: '', hi: '', hg: '', ...(po[k]?.text || {}) } }])));
            getAllMenuItems().then(r => setItems(r.data.filter(i => i.soldInShop !== false && !i.isRestricted))).catch(() => {});
            getAllCategories().then(r => setCategories(r.data)).catch(() => {});
            getCombos().then(r => setCombos(r.data)).catch(() => {});
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

            <div className="ca-tabs" role="tablist" aria-label="Customer app settings">
                {TABS.map(([k, l]) => (
                    <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''}
                        onClick={() => setParams(p => { const n = new URLSearchParams(p); n.set('tab', k); return n; }, { replace: true })}>{l}</button>
                ))}
            </div>

            {tab === 'look' && <CxLook initial={raw.cx_look} canEdit={canEdit}
                saveSetting={(k, v, after) => saveSetting(k, v, () => { after?.(); setRaw(r => ({ ...r, [k]: v })); })} />}

            {tab === 'settings' && <div className="ca-narrow">
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

            {pay && (
                <section className="ca-card">
                    <h2>How customers pay<InfoTip k="pay_options" /></h2>
                    <p className="muted small">Shown when the food is served. Switch each way on or off and write its button words in English, हिन्दी and Hinglish (empty = the standard words). At least one stays on.</p>
                    {PAY_WAYS.map(([k, label, std]) => (
                        <div key={k} className="ca-pay">
                            <Toggle disabled={!canEdit || (pay[k].on && PAY_WAYS.filter(([x]) => pay[x].on).length === 1)} checked={pay[k].on}
                                onChange={v => { const next = { ...pay, [k]: { ...pay[k], on: v } }; saveSetting('pay_options', next, () => setPay(next)); }}
                                label={label} hint={k === 'upi' ? 'Staff bring the cafe UPI QR to the table.' : k === 'bill' ? 'Staff bring the bill to the table.' : 'The customer walks to the counter.'} />
                            <div className="ca-pay-texts">
                                {[['en', 'English'], ['hi', 'हिन्दी'], ['hg', 'Hinglish']].map(([l, ln]) => (
                                    <input key={l} className="input" disabled={!canEdit || !pay[k].on} aria-label={`${label} · ${ln}`} placeholder={std[l]} maxLength={60}
                                        value={pay[k].text[l]} onChange={e => setPay({ ...pay, [k]: { ...pay[k], text: { ...pay[k].text, [l]: e.target.value } } })}
                                        onBlur={() => saveSetting('pay_options', pay)} />
                                ))}
                            </div>
                        </div>
                    ))}
                </section>
            )}

            </div>}

            {tab === 'banners' && <div className="ca-narrow">
            <section className="ca-card">
                <div className="ca-card-head">
                    <h2>Banners<InfoTip k="banners" /> <span className="muted small">{live} live</span></h2>
                    {canEdit && banners.length < 12 && <button className="btn btn-primary btn-sm" onClick={() => setEditing({})}><FiPlus /> Add banner</button>}
                </div>
                <p className="muted small">Slides at the top of the home page and menu. Each has a photo or a drawn picture, words in English, हिन्दी and Hinglish, can open a dish, a combo, a category or the rewards page, and can run between dates and times.</p>
                {banners.length === 0 && <p className="ca-empty">No banners yet. The home page shows the standard welcome picture until you add one.</p>}
                <div className="ca-banners">
                    {banners.map((b, i) => {
                        const [cls, label] = bannerStatus(b);
                        return (
                            <div key={b.id} className="ca-banner-row">
                                <div className="ca-banner-thumb"><BannerPreview b={b} small /></div>
                                <div className="ca-banner-meta">
                                    <span className={`ca-pill ${cls}`}>{label}</span>
                                    <span className="small muted">{LINKS.find(l => l[0] === b.linkType)?.[1] || 'No link'}{b.art ? ` · ${ART_LABELS[b.art] || 'Drawn art'}` : ''}</span>
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
                    <input className="input" maxLength={140} disabled={!canEdit} value={announce.text} placeholder="Live music this Friday, 8 pm"
                        onChange={e => setAnnounce(a => ({ ...a, text: e.target.value }))} />
                    <button className="btn btn-primary" disabled={!canEdit} onClick={() => saveSetting('portal_announcement', announce)}>Save</button>
                </div>
            </section>

            </div>}

            {tab === 'settings' && <div className="ca-narrow">
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
            </div>}

            {editing && (
                <BannerEditor banner={editing} items={items} categories={categories} combos={combos} onClose={() => setEditing(null)}
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
