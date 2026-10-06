import React, { useEffect, useMemo, useState } from 'react';
import { FiPlus, FiEdit2, FiTrash2, FiImage, FiX, FiSearch } from 'react-icons/fi';
import { getCombos, saveCombo, deleteCombo, getAllMenuItems, getTaxGroups } from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import { getImageUrl } from '../../utils/config';
import Modal from '../inventory/Modal';
import ViewOnlyNote from '../ViewOnlyNote';
import InfoTip from '../help/InfoTip';
import Art from '../../components/cx/Art';
import { ART_KINDS, ART_LABELS } from '../../components/cx/artKinds';
import { BANNER_STYLES, bannerBg } from '../../components/cx/palettes';
import { DAYS, clock, dishPrice, rupees } from './menuExtras';
import './Menu2.css';

const errorText = (err, fallback = 'Something went wrong') => err?.response?.data?.message || err?.message || fallback;
const hhmm = (t) => (t ? String(t).slice(0, 5) : '');
const EMPTY = () => ({
    name: '', nameHi: '', description: '', image: '', art: 'iced', bg: 'espresso', price: '',
    slots: [{ name: 'Pick a drink', nameHi: 'ड्रिंक चुनें', items: [] }, { name: 'Pick a bite', nameHi: 'कुछ खाने को', items: [] }],
    days: [], timeFrom: '', timeTo: '', isActive: true, doublePoints: false, suggest: true, taxGroup: '',
});

// What the same picks would cost bought one by one (the dishes with the smallest upgrade in each slot)
const separately = (combo, byId) => (combo.slots || []).reduce((sum, s) => {
    const list = (s.items || []).map(x => ({ ...x, item: byId.get(x.menuItem) })).filter(x => x.item);
    if (!list.length) return sum;
    const low = Math.min(...list.map(x => Number(x.extra) || 0));
    const base = list.filter(x => (Number(x.extra) || 0) === low);
    return sum + base.reduce((a, x) => a + dishPrice(x.item), 0) / base.length;
}, 0);
const savesOf = (combo, byId) => Math.round(separately(combo, byId) - Number(combo.price || 0));
const whenOf = (c) => {
    const days = c.days?.length && c.days.length < 7 ? DAYS.filter(([d]) => c.days.includes(d)).map(([, l]) => l).join(', ') : 'Every day';
    const time = c.timeFrom && c.timeTo ? `${clock(hhmm(c.timeFrom))}–${clock(hhmm(c.timeTo))}` : 'all day';
    return `${days} · ${time}`;
};

const Thumb = ({ c }) => (
    <span className="m2-combo-thumb" style={c.image ? { backgroundImage: `url(${getImageUrl(c.image)})` } : { background: bannerBg({ style: c.bg }) }}>
        {!c.image && c.art && <Art kind={c.art} />}
    </span>
);

const Switch = ({ checked, onChange, disabled, label, children }) => (
    <label className="m2-switch">
        {children}
        <input type="checkbox" checked={checked} disabled={disabled} aria-label={label} onChange={e => onChange(e.target.checked)} />
        <span aria-hidden="true" />
    </label>
);

// Search the menu and add a dish to a slot
const DishFinder = ({ items, exclude, onPick }) => {
    const [q, setQ] = useState('');
    const [open, setOpen] = useState(false);
    const term = q.trim().toLowerCase();
    const list = items.filter(i => !exclude.includes(i._id) && (!term || i.name.toLowerCase().includes(term) || (i.category?.name || '').toLowerCase().includes(term))).slice(0, 30);
    return (
        <div className="m2-finder m2-search" onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false); }}>
            <FiSearch />
            <input className="input" placeholder="Add a dish: type to search" aria-label="Add a dish" value={q}
                onFocus={() => setOpen(true)} onChange={e => { setQ(e.target.value); setOpen(true); }} />
            {open && (
                <div className="m2-finder-list">
                    {list.map(i => (
                        <button key={i._id} type="button" onClick={() => { onPick(i); setQ(''); setOpen(false); }}>
                            <span>{i.name} <small className="muted">{i.category?.name}</small></span><span>{rupees(dishPrice(i))}</span>
                        </button>
                    ))}
                    {list.length === 0 && <p className="m2-hint" style={{ padding: 10 }}>No dishes match.</p>}
                </div>
            )}
        </div>
    );
};

const ComboEditor = ({ combo, items, taxGroups, onClose, onSaved }) => {
    const byId = useMemo(() => new Map(items.map(i => [i._id, i])), [items]);
    const [c, setC] = useState(() => ({ ...EMPTY(), ...combo, timeFrom: hhmm(combo.timeFrom), timeTo: hhmm(combo.timeTo), taxGroup: combo.taxGroupId || combo.taxGroup || '' }));
    const [pic, setPic] = useState(combo.image ? 'photo' : 'art');
    const [file, setFile] = useState(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const set = (patch) => setC(p => ({ ...p, ...patch }));
    const setSlot = (i, patch) => setC(p => ({ ...p, slots: p.slots.map((s, n) => (n === i ? { ...s, ...patch } : s)) }));
    const fileUrl = useMemo(() => (file ? URL.createObjectURL(file) : ''), [file]);
    useEffect(() => () => { if (fileUrl) URL.revokeObjectURL(fileUrl); }, [fileUrl]);
    const sep = separately(c, byId);

    const save = async () => {
        setError('');
        if (!c.name.trim()) return setError('Give the combo a name.');
        if (c.price === '' || Number(c.price) < 0) return setError('Set the combo price.');
        if (!c.slots.length) return setError('Add at least one part (e.g. Pick a drink).');
        const empty = c.slots.findIndex(s => !s.items.length);
        if (empty >= 0) return setError(`Part ${empty + 1} (${c.slots[empty].name || 'no name'}) needs at least one dish.`);
        if (c.slots.some(s => !s.name.trim())) return setError('Each part needs a name, e.g. Pick a drink.');
        if (!!c.timeFrom !== !!c.timeTo) return setError('Fill both times, or leave both empty for all day.');
        if (c.timeFrom && c.timeFrom >= c.timeTo) return setError('The "until" time must be after the "from" time.');
        const data = {
            name: c.name.trim(), nameHi: c.nameHi.trim(), description: c.description.trim(), price: Number(c.price),
            art: pic === 'art' ? c.art : '', bg: c.bg, image: pic === 'photo' ? c.image : '',
            slots: c.slots.map(s => ({ name: s.name.trim(), nameHi: (s.nameHi || '').trim(), items: s.items.map(x => ({ menuItem: x.menuItem, extra: Number(x.extra) || 0 })) })),
            days: c.days.length === 7 ? [] : c.days, timeFrom: c.timeFrom, timeTo: c.timeTo,
            isActive: c.isActive, doublePoints: c.doublePoints, suggest: c.suggest, taxGroup: c.taxGroup,
        };
        if (pic === 'photo' && !file && !c.image) return setError('Upload a photo, or pick a drawn picture.');
        let payload = data;
        if (pic === 'photo' && file) {
            payload = new FormData();
            Object.entries(data).forEach(([k, v]) => payload.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v)));
            payload.set('image', file);
        }
        setBusy(true);
        try {
            const saved = (await saveCombo(c._id, payload)).data;
            onSaved(saved);
        } catch (err) {
            setError(errorText(err, 'Could not save'));
            setBusy(false);
        }
        return undefined;
    };

    return (
        <div className="m2-modal">
            <Modal title={c._id ? `Edit ${combo.name}` : 'New combo'} onClose={onClose}>
                <div className="modal-body m2-sec">
                    <div className="form-grid">
                        <div className="input-group"><label>Name</label>
                            <input className="input" autoFocus maxLength={60} placeholder="Coffee + bite" value={c.name} onChange={e => set({ name: e.target.value })} /></div>
                        <div className="input-group"><label>नाम हिंदी <span className="hint">optional</span></label>
                            <input className="input" lang="hi" maxLength={60} placeholder="कॉफ़ी + स्नैक" value={c.nameHi} onChange={e => set({ nameHi: e.target.value })} /></div>
                    </div>
                    <div className="input-group"><label>Short description</label>
                        <input className="input" maxLength={140} placeholder="Any coffee with a croissant or cookie" value={c.description} onChange={e => set({ description: e.target.value })} /></div>

                    <div className="m2-sec-head"><span className="m2-label">Picture<InfoTip k="banner_art" /></span>
                        <span className="m2-seg" role="group" aria-label="Picture">
                            {[['photo', 'Upload photo'], ['art', 'Drawn art']].map(([k, l]) => (
                                <button key={k} type="button" className={pic === k ? 'on' : ''} onClick={() => setPic(k)}>{l}</button>
                            ))}
                        </span>
                    </div>
                    {pic === 'photo' ? (
                        <div className="m2-row-btns" style={{ alignItems: 'center' }}>
                            {(fileUrl || c.image) && <span className="m2-combo-thumb" style={{ backgroundImage: `url(${fileUrl || getImageUrl(c.image)})`, width: 84, height: 64 }} />}
                            <label className="btn btn-secondary btn-sm" style={{ cursor: 'pointer' }}><FiImage /> {fileUrl || c.image ? 'Change photo' : 'Upload photo'}
                                <input type="file" accept="image/*" hidden onChange={e => setFile(e.target.files?.[0] || null)} /></label>
                        </div>
                    ) : (
                        <>
                            <div className="m2-arts" role="radiogroup" aria-label="Drawn picture">
                                {ART_KINDS.map(k => (
                                    <button key={k} type="button" role="radio" aria-checked={c.art === k} className={c.art === k ? 'on' : ''} onClick={() => set({ art: k })}>
                                        <Art kind={k} /><span>{ART_LABELS[k]}</span></button>
                                ))}
                            </div>
                            <div className="m2-days" role="radiogroup" aria-label="Background">
                                {Object.entries(BANNER_STYLES).map(([k, s]) => (
                                    <button key={k} type="button" role="radio" aria-checked={c.bg === k} className={c.bg === k ? 'on' : ''}
                                        style={{ background: s.bg, color: s.tx || '#fff', borderColor: c.bg === k ? 'var(--text-primary)' : 'transparent', borderWidth: 2 }}
                                        onClick={() => set({ bg: k })}>{s.label}</button>
                                ))}
                            </div>
                        </>
                    )}

                    <div className="form-grid">
                        <div className="input-group"><label>Combo price ₹</label>
                            <input className="input" type="number" min={0} step={1} placeholder="249" value={c.price} onChange={e => set({ price: e.target.value })} />
                            {sep > 0 && <small className="muted">Bought separately ≈ {rupees(Math.round(sep))}{c.price !== '' && sep - Number(c.price) > 0 ? <> · <span className="m2-save">saves ≈ {rupees(Math.round(sep - Number(c.price)))}</span></> : ''}</small>}
                        </div>
                        <div className="input-group"><label>Tax group</label>
                            <select className="input" value={c.taxGroup || ''} onChange={e => set({ taxGroup: e.target.value })}>
                                <option value="">Cafe default (Settings)</option>
                                {taxGroups.map(t => <option key={t._id} value={t._id}>{t.name}</option>)}
                            </select></div>
                    </div>

                    <span className="m2-label">What's in it</span>
                    <p className="m2-hint">Each part is one pick for the customer. "+₹ extra" is what a dish costs on top of the combo price (e.g. +₹30 for a large cold brew).</p>
                    {c.slots.map((s, i) => (
                        <div key={i} className="m2-slot">
                            <div className="m2-slot-head">
                                <b>{i + 1}</b>
                                <input className="input" aria-label="Part name" maxLength={40} placeholder="Pick a drink" value={s.name} onChange={e => setSlot(i, { name: e.target.value })} />
                                <input className="input" aria-label="Part name in Hindi" lang="hi" maxLength={40} placeholder="ड्रिंक चुनें" value={s.nameHi || ''} onChange={e => setSlot(i, { nameHi: e.target.value })} />
                                <button type="button" className="icon-btn delete" aria-label={`Remove part ${i + 1}`} disabled={c.slots.length === 1}
                                    onClick={() => set({ slots: c.slots.filter((_, n) => n !== i) })}><FiTrash2 /></button>
                            </div>
                            <div className="m2-slot-items">
                                {s.items.map((x, n) => {
                                    const it = byId.get(x.menuItem);
                                    return (
                                        <div key={x.menuItem} className="m2-slot-item">
                                            <span>{it?.name || 'Removed dish'}</span>
                                            <span className="m2-pill grey">{it ? rupees(dishPrice(it)) : ''}</span>
                                            <span className="m2-extra">+₹<input className="input" type="number" min={0} step={1} aria-label={`Extra for ${it?.name}`} value={x.extra}
                                                onChange={e => setSlot(i, { items: s.items.map((y, m) => (m === n ? { ...y, extra: e.target.value } : y)) })} /></span>
                                            <button type="button" className="icon-btn delete" aria-label={`Remove ${it?.name}`}
                                                onClick={() => setSlot(i, { items: s.items.filter((_, m) => m !== n) })}><FiX /></button>
                                        </div>
                                    );
                                })}
                            </div>
                            <DishFinder items={items} exclude={s.items.map(x => x.menuItem)} onPick={(it) => setSlot(i, { items: [...s.items, { menuItem: it._id, extra: 0 }] })} />
                        </div>
                    ))}
                    {c.slots.length < 5 && <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }}
                        onClick={() => set({ slots: [...c.slots, { name: '', nameHi: '', items: [] }] })}><FiPlus /> Add a part</button>}

                    <span className="m2-label">When it's on sale</span>
                    <div className="m2-days" role="group" aria-label="Days">
                        {DAYS.map(([d, l]) => (
                            <button key={d} type="button" aria-pressed={c.days.includes(d)} className={c.days.includes(d) ? 'on' : ''}
                                onClick={() => set({ days: c.days.includes(d) ? c.days.filter(x => x !== d) : [...c.days, d].sort() })}>{l}</button>
                        ))}
                    </div>
                    <p className="m2-hint">{c.days.length === 0 || c.days.length === 7 ? 'No days ticked = every day.' : 'Only on the ticked days.'}</p>
                    <div className="m2-row-btns" style={{ alignItems: 'center' }}>
                        <input className="input" type="time" aria-label="From time" style={{ width: 140 }} value={c.timeFrom} onChange={e => set({ timeFrom: e.target.value })} />
                        <span>to</span>
                        <input className="input" type="time" aria-label="Until time" style={{ width: 140 }} value={c.timeTo} onChange={e => set({ timeTo: e.target.value })} />
                        {(c.timeFrom || c.timeTo) && <button type="button" className="btn btn-ghost btn-sm" onClick={() => set({ timeFrom: '', timeTo: '' })}>All day</button>}
                    </div>

                    <div className="m2-toggles">
                        <Switch checked={c.isActive} onChange={v => set({ isActive: v })} label="On sale"><b>On sale<small>Off = hidden everywhere</small></b></Switch>
                        <Switch checked={c.doublePoints} onChange={v => set({ doublePoints: v })} label="Double points"><b>Double points<small>Customers earn twice the points on this combo</small></b></Switch>
                        <Switch checked={c.suggest} onChange={v => set({ suggest: v })} label="Suggest on dish pages"><b>Suggest on dish pages<small>"Make it a combo and save" on the dishes in it</small></b></Switch>
                    </div>
                </div>
                <div className="modal-footer">
                    {error && <p className="m2-error" role="alert">{error}</p>}
                    <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
                    <button type="button" className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save combo'}</button>
                </div>
            </Modal>
        </div>
    );
};

// Menu → Combos: a set price for picks from several parts (a drink + a bite), on chosen days and hours
const AdminCombos = () => {
    const { hasPerm } = useAuth();
    const canCreate = hasPerm('menu.create');
    const canEdit = hasPerm('menu.edit');
    const canDelete = hasPerm('menu.delete');
    const [combos, setCombos] = useState(null);
    const [items, setItems] = useState([]);
    const [taxGroups, setTaxGroups] = useState([]);
    const [editing, setEditing] = useState(null);
    const [msg, setMsg] = useState('');
    const [error, setError] = useState('');
    const byId = useMemo(() => new Map(items.map(i => [i._id, i])), [items]);

    const [tick, setTick] = useState(0);
    const load = () => setTick(t => t + 1);
    useEffect(() => {
        let live = true;
        Promise.all([getCombos(), getAllMenuItems()]).then(([c, m]) => {
            if (!live) return;
            setCombos(c.data);
            setItems(m.data.filter(i => !i.isRestricted));
        }).catch(err => { if (live) { setError(errorText(err)); setCombos(x => x || []); } });
        return () => { live = false; };
    }, [tick]);
    useEffect(() => { getTaxGroups().then(r => setTaxGroups(r.data)).catch(() => {}); }, []);
    const flash = (t) => { setMsg(t); setTimeout(() => setMsg(''), 3000); };

    const toggle = async (c, on) => {
        setCombos(list => list.map(x => (x._id === c._id ? { ...x, isActive: on } : x)));
        try { await saveCombo(c._id, { isActive: on }); flash(`${c.name} ${on ? 'on sale' : 'switched off'}`); } catch (err) { setError(errorText(err)); load(); }
    };
    const remove = async (c) => {
        if (!window.confirm(`Delete the combo ${c.name}? Past bills keep it.`)) return;
        try { await deleteCombo(c._id); flash(`${c.name} deleted`); load(); } catch (err) { setError(errorText(err, 'Could not delete')); }
    };

    if (!combos) return <div className="admin-loading"><div className="spinner" /></div>;
    const builtFrom = (c) => (c.slots || []).map(s => `${s.name} (${(s.items || []).length})`).join(' + ');
    const saves = (c) => { const v = savesOf(c, byId); return v > 0 ? <span className="m2-save">≈ {rupees(v)}</span> : <span className="muted">—</span>; };
    const actions = (c) => (
        <span className="m2-actions">
            {canEdit && <button type="button" className="icon-btn edit" aria-label={`Edit ${c.name}`} onClick={() => setEditing(c)}><FiEdit2 /></button>}
            {canDelete && <button type="button" className="icon-btn delete" aria-label={`Delete ${c.name}`} onClick={() => remove(c)}><FiTrash2 /></button>}
        </span>
    );

    return (
        <div className="m2-page">
            <div className="page-header">
                <div>
                    <h1>Combos<InfoTip k="combos" /></h1>
                    <p className="muted">One price for a drink and a bite. Customers pick one dish from each part; the price is checked at checkout.</p>
                </div>
                {canCreate && <div className="m2-head-actions"><button type="button" className="btn btn-secondary" onClick={() => setEditing(EMPTY())}><FiPlus /> New combo</button></div>}
            </div>
            {!canCreate && !canEdit && !canDelete && <ViewOnlyNote what="change combos" />}
            {msg && <div className="m2-flash" role="status">{msg}</div>}
            {error && <p className="m2-error" role="alert">{error}</p>}
            {combos.length === 0 ? (
                <div className="m2-card"><p className="m2-hint">No combos yet. {canCreate ? 'Tap New combo: e.g. "Coffee + bite" for ₹249 with any coffee and a croissant or cookie.' : ''}</p></div>
            ) : (
                <>
                    <table className="m2-table">
                        <thead><tr><th>Combo</th><th>Built from</th><th>Price</th><th>Saves</th><th>When</th><th>On</th><th /></tr></thead>
                        <tbody>
                            {combos.map(c => (
                                <tr key={c._id}>
                                    <td><span className="m2-combo-name"><Thumb c={c} /><span><b>{c.name}</b>{c.description && <small>{c.description}</small>}
                                        {c.doublePoints && <small>Double points</small>}</span></span></td>
                                    <td>{builtFrom(c)}</td>
                                    <td><b>{rupees(c.price)}</b></td>
                                    <td>{saves(c)}</td>
                                    <td>{whenOf(c)}</td>
                                    <td><Switch checked={c.isActive} disabled={!canEdit} label={`${c.name} on sale`} onChange={v => toggle(c, v)} /></td>
                                    <td>{actions(c)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    <div className="m2-combo-cards">
                        {combos.map(c => (
                            <div key={c._id} className="m2-card">
                                <div className="m2-card-head"><span className="m2-combo-name"><Thumb c={c} /><span><b>{c.name}</b><small>{builtFrom(c)}</small></span></span>
                                    <span className="m2-spacer" /><Switch checked={c.isActive} disabled={!canEdit} label={`${c.name} on sale`} onChange={v => toggle(c, v)} /></div>
                                <div className="m2-card-head"><b>{rupees(c.price)}</b><small>saves {saves(c)}</small><span className="m2-spacer" />{actions(c)}</div>
                                <small className="muted">{whenOf(c)}</small>
                            </div>
                        ))}
                    </div>
                </>
            )}
            {editing && <ComboEditor combo={editing} items={items} taxGroups={taxGroups} onClose={() => setEditing(null)}
                onSaved={(saved) => { setEditing(null); flash(`${saved.name} saved`); load(); }} />}
        </div>
    );
};

export default AdminCombos;
