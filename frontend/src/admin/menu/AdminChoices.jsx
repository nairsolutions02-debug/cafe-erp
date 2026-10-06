import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FiPlus, FiEdit2, FiTrash2, FiLayers, FiZap } from 'react-icons/fi';
import { getOptionGroups, saveOptionGroup, deleteOptionGroup, getAllMenuItems, updateMenuItem } from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import Modal from '../inventory/Modal';
import ViewOnlyNote from '../ViewOnlyNote';
import InfoTip from '../help/InfoTip';
import { uid, choiceRange, rupees, MAX_GROUPS } from './menuExtras';
import './Menu2.css';

const errorText = (err, fallback = 'Something went wrong') => err?.response?.data?.message || err?.message || fallback;
const c = (name, nameHi, price = 0, isDefault = false) => ({ id: uid(), name, nameHi, price, color: '', isDefault, available: true });

// Ready-made groups most cafes need
const STARTERS = () => [
    { name: 'Milk', nameHi: 'दूध', pick: 'one', minPick: 1, maxPick: 1, choices: [c('Regular', 'रेगुलर', 0, true), c('Oat', 'ओट', 40), c('Almond', 'बादाम', 50)] },
    { name: 'Sugar', nameHi: 'चीनी', pick: 'one', minPick: 1, maxPick: 1, choices: [c('Normal', 'नॉर्मल', 0, true), c('Less', 'कम', 0), c('None', 'बिना चीनी', 0)] },
    { name: 'Ice', nameHi: 'बर्फ़', pick: 'one', minPick: 1, maxPick: 1, choices: [c('Normal', 'नॉर्मल', 0, true), c('Less', 'कम', 0), c('Extra', 'ज़्यादा', 0)] },
    { name: 'Flavour', nameHi: 'फ़्लेवर', pick: 'many', minPick: 0, maxPick: 2,
        choices: [c('Hazelnut', 'हेज़लनट', 30), c('Caramel', 'कैरामल', 30), c('Vanilla', 'वनीला', 25), c('Irish cream', 'आयरिश क्रीम', 35)] },
    { name: 'Extra shot', nameHi: 'एक्स्ट्रा शॉट', pick: 'many', minPick: 0, maxPick: 1, choices: [c('Extra espresso shot', 'एक्स्ट्रा एस्प्रेसो शॉट', 40)] },
];
const NEW_GROUP = () => ({ name: '', nameHi: '', pick: 'one', minPick: 1, maxPick: 1, choices: [c('', '', 0, true), c('', '', 0)] });

const GroupEditor = ({ group, onClose, onSaved }) => {
    const [g, setG] = useState(() => ({ ...NEW_GROUP(), ...group, choices: (group?.choices || NEW_GROUP().choices).map(x => ({ available: true, color: '', ...x })) }));
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const set = (patch) => setG(p => ({ ...p, ...patch }));
    const setChoice = (i, patch) => setG(p => ({ ...p, choices: p.choices.map((x, n) => (n === i ? { ...x, ...patch } : x)) }));
    const setDefault = (i, on) => setG(p => ({
        ...p, choices: p.choices.map((x, n) => (p.pick === 'one' ? { ...x, isDefault: n === i } : n === i ? { ...x, isDefault: on } : x)),
    }));
    const save = async () => {
        setError('');
        const choices = g.choices.filter(x => x.name.trim() || Number(x.price) > 0)
            .map(x => ({ ...x, name: x.name.trim(), nameHi: (x.nameHi || '').trim(), price: Number(x.price) || 0 }));
        if (!g.name.trim()) return setError('Give the group a name, e.g. Milk.');
        if (!choices.length) return setError('Add at least one choice.');
        if (choices.some(x => !x.name)) return setError('Each choice needs a name.');
        if (g.pick === 'one' && !choices.some(x => x.isDefault)) choices[0].isDefault = true;
        const minPick = g.pick === 'one' ? 1 : Math.max(0, Number(g.minPick) || 0);
        const maxPick = g.pick === 'one' ? 1 : Math.max(1, Number(g.maxPick) || 1);
        if (minPick > maxPick) return setError('"At least" cannot be more than "at most".');
        if (maxPick > choices.length) return setError(`"At most" is ${maxPick} but there are only ${choices.length} choices.`);
        if (g.pick === 'many' && choices.filter(x => x.isDefault).length > maxPick) return setError(`At most ${maxPick} choices can be ticked as default.`);
        setBusy(true);
        try {
            const saved = (await saveOptionGroup(g._id, { name: g.name.trim(), nameHi: g.nameHi.trim(), pick: g.pick, minPick, maxPick, choices })).data;
            onSaved(saved);
        } catch (err) {
            setError(errorText(err, 'Could not save'));
            setBusy(false);
        }
        return undefined;
    };
    return (
        <div className="m2-modal">
            <Modal title={g._id ? `Edit ${group.name}` : 'New choice group'} onClose={onClose}>
                <div className="modal-body m2-sec">
                    <div className="form-grid">
                        <div className="input-group"><label>Name</label>
                            <input className="input" autoFocus maxLength={40} placeholder="Milk" value={g.name} onChange={e => set({ name: e.target.value })} /></div>
                        <div className="input-group"><label>नाम हिंदी <span className="hint">optional</span></label>
                            <input className="input" lang="hi" maxLength={40} placeholder="दूध" value={g.nameHi} onChange={e => set({ nameHi: e.target.value })} /></div>
                    </div>
                    <div className="m2-pick-type" role="radiogroup" aria-label="How many can be picked">
                        <label className={g.pick === 'one' ? 'on' : ''}><input type="radio" name="pick" checked={g.pick === 'one'}
                            onChange={() => setG(p => {
                                const firstDefault = p.choices.findIndex(x => x.isDefault);
                                return { ...p, pick: 'one', minPick: 1, maxPick: 1, choices: p.choices.map((x, n) => ({ ...x, isDefault: n === Math.max(0, firstDefault) })) };
                            })} />
                            <strong>Pick one</strong><small>Always one answer, e.g. Milk: Regular, Oat or Almond. The default is used when the customer does not choose.</small></label>
                        <label className={g.pick === 'many' ? 'on' : ''}><input type="radio" name="pick" checked={g.pick === 'many'}
                            onChange={() => setG(p => ({ ...p, pick: 'many', minPick: 0, maxPick: Math.max(1, Math.min(2, p.choices.length)), choices: p.choices.map(x => ({ ...x, isDefault: false })) }))} />
                            <strong>Pick many</strong><small>Add-ons, e.g. Flavour: none, one or two syrups.</small></label>
                    </div>
                    {g.pick === 'many' && (
                        <div className="m2-range">
                            <span>At least</span><input className="input" type="number" min={0} max={20} aria-label="At least" value={g.minPick} onChange={e => set({ minPick: e.target.value })} />
                            <span>at most</span><input className="input" type="number" min={1} max={20} aria-label="At most" value={g.maxPick} onChange={e => set({ maxPick: e.target.value })} />
                            <small className="muted">0 at least = optional</small>
                        </div>
                    )}
                    <div className="m2-choice-rows">
                        <div className="m2-choice-head"><span>Choice</span><span>हिंदी</span><span>Extra ₹</span><span>Colour</span><span>Default</span><span>In stock</span><span /></div>
                        {g.choices.map((x, i) => (
                            <div key={x.id} className="m2-choice">
                                <input className="input" aria-label="Choice name" maxLength={40} placeholder={i === 0 ? 'Regular' : 'Oat'} value={x.name} onChange={e => setChoice(i, { name: e.target.value })} />
                                <input className="input" aria-label="Choice name in Hindi" lang="hi" maxLength={40} placeholder="हिंदी" value={x.nameHi || ''} onChange={e => setChoice(i, { nameHi: e.target.value })} />
                                <input className="input" aria-label="Extra price" type="number" min={0} step={1} placeholder="0" value={x.price} onChange={e => setChoice(i, { price: e.target.value })} />
                                {x.color ? (
                                    <span className="m2-cell"><input type="color" aria-label="Colour dot" value={x.color} onChange={e => setChoice(i, { color: e.target.value })}
                                        onDoubleClick={() => setChoice(i, { color: '' })} title="Double-click to remove the colour" /></span>
                                ) : <button type="button" className="m2-dot-off" title="Add a colour dot (optional)" onClick={() => setChoice(i, { color: '#8B5A2B' })}>+ dot</button>}
                                <label className="m2-cell"><input type={g.pick === 'one' ? 'radio' : 'checkbox'} name="choice-default" aria-label="Default" checked={!!x.isDefault}
                                    onChange={e => setDefault(i, e.target.checked)} /></label>
                                <label className="m2-cell"><input type="checkbox" aria-label="In stock" checked={x.available !== false} onChange={e => setChoice(i, { available: e.target.checked })} /></label>
                                <button type="button" className="icon-btn delete" aria-label={`Remove ${x.name || 'choice'}`} disabled={g.choices.length === 1}
                                    onClick={() => setG(p => ({ ...p, choices: p.choices.filter((_, n) => n !== i) }))}><FiTrash2 /></button>
                            </div>
                        ))}
                        {g.choices.length < 20 && (
                            <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }}
                                onClick={() => setG(p => ({ ...p, choices: [...p.choices, c('', '', 0)] }))}><FiPlus /> Add choice</button>
                        )}
                        <p className="m2-hint">Extra ₹ is added to the dish price. Untick "In stock" when oat milk runs out: customers see it greyed out. A colour dot is optional (e.g. for syrups).</p>
                    </div>
                </div>
                <div className="modal-footer">
                    {error && <p className="m2-error" role="alert">{error}</p>}
                    <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
                    <button type="button" className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save group'}</button>
                </div>
            </Modal>
        </div>
    );
};

// Which dishes have this group: tick to add it, untick to take it off
const DishesModal = ({ group, items, onClose, onDone }) => {
    const has = (i) => (i.optionGroups || []).includes(group._id);
    const [picked, setPicked] = useState(() => new Set(items.filter(has).map(i => i._id)));
    const [q, setQ] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const term = q.trim().toLowerCase();
    const byCat = useMemo(() => {
        const m = new Map();
        items.filter(i => !term || i.name.toLowerCase().includes(term) || (i.category?.name || '').toLowerCase().includes(term)).forEach(i => {
            const k = i.category?.name || 'No category';
            if (!m.has(k)) m.set(k, []);
            m.get(k).push(i);
        });
        return [...m.entries()];
    }, [items, term]);
    const flip = (id, on) => setPicked(p => { const n = new Set(p); if (on) n.add(id); else n.delete(id); return n; });
    const save = async () => {
        const add = items.filter(i => picked.has(i._id) && !has(i));
        const remove = items.filter(i => !picked.has(i._id) && has(i));
        const full = add.filter(i => (i.optionGroups || []).length >= MAX_GROUPS);
        if (full.length) { setError(`${full.map(i => i.name).join(', ')} already ${full.length === 1 ? 'has' : 'have'} ${MAX_GROUPS} groups.`); return; }
        setBusy(true);
        setError('');
        const results = await Promise.allSettled([
            ...add.map(i => updateMenuItem(i._id, { optionGroups: [...(i.optionGroups || []), group._id] })),
            ...remove.map(i => updateMenuItem(i._id, { optionGroups: (i.optionGroups || []).filter(x => x !== group._id) })),
        ]);
        const failed = results.filter(r => r.status === 'rejected');
        if (failed.length) { setError(`${failed.length} not saved: ${errorText(failed[0].reason)}`); setBusy(false); onDone(null); return; }
        onDone(`${group.name}: added to ${add.length}, taken off ${remove.length} dish${remove.length === 1 ? '' : 'es'}`);
    };
    return (
        <div className="m2-modal">
            <Modal title={`Dishes with ${group.name}`} onClose={onClose}>
                <div className="modal-body m2-sec">
                    <p className="m2-hint">Tick every dish that should ask about {group.name.toLowerCase()}. It is added after the dish's other groups.</p>
                    <input className="input" placeholder="Search dishes" aria-label="Search dishes" value={q} onChange={e => setQ(e.target.value)} />
                    <div className="m2-multi">
                        {byCat.map(([cat, list]) => (
                            <React.Fragment key={cat}>
                                <div className="m2-cat"><span>{cat}</span>
                                    <button type="button" onClick={() => { const all = list.every(i => picked.has(i._id)); list.forEach(i => flip(i._id, !all)); }}>
                                        {list.every(i => picked.has(i._id)) ? 'Untick all' : 'Tick all'}</button></div>
                                {list.map(i => (
                                    <label key={i._id} className={`m2-pick${picked.has(i._id) ? ' on' : ''}`}>
                                        <input type="checkbox" checked={picked.has(i._id)} onChange={e => flip(i._id, e.target.checked)} />
                                        <span className="m2-pick-name">{i.name}{has(i) && <small>has it now</small>}</span>
                                        <span>{rupees(i.price)}</span>
                                    </label>
                                ))}
                            </React.Fragment>
                        ))}
                    </div>
                </div>
                <div className="modal-footer">
                    {error && <p className="m2-error" role="alert">{error}</p>}
                    <span className="m2-count" style={{ marginRight: 'auto' }}>{picked.size} dishes ticked</span>
                    <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
                    <button type="button" className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
                </div>
            </Modal>
        </div>
    );
};

const StartersModal = ({ existing, onClose, onDone }) => {
    const list = useMemo(() => STARTERS(), []);
    const there = (s) => existing.some(g => g.name.trim().toLowerCase() === s.name.toLowerCase());
    const [picked, setPicked] = useState(() => new Set(list.filter(s => !there(s)).map(s => s.name)));
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const save = async () => {
        setBusy(true);
        setError('');
        try {
            for (const s of list.filter(x => picked.has(x.name))) await saveOptionGroup(null, s);
            onDone(`Added ${picked.size} ready-made group${picked.size === 1 ? '' : 's'}`);
        } catch (err) {
            setError(errorText(err, 'Could not add'));
            setBusy(false);
        }
    };
    return (
        <div className="m2-modal">
            <Modal title="Ready-made groups" onClose={onClose}>
                <div className="modal-body m2-starters">
                    <p className="m2-hint">Change names and prices afterwards if yours differ.</p>
                    {list.map(s => {
                        const done = there(s);
                        return (
                            <label key={s.name} className={done ? 'done' : ''}>
                                <input type="checkbox" disabled={done} checked={!done && picked.has(s.name)}
                                    onChange={e => setPicked(p => { const n = new Set(p); if (e.target.checked) n.add(s.name); else n.delete(s.name); return n; })} />
                                <span><b>{s.name} <small>· {choiceRange(s)}</small></b>
                                    <small>{done ? 'Already there' : s.choices.map(x => `${x.name}${x.price ? ` +${rupees(x.price)}` : ''}${x.isDefault ? ' (default)' : ''}`).join(' · ')}</small></span>
                            </label>
                        );
                    })}
                </div>
                <div className="modal-footer">
                    {error && <p className="m2-error" role="alert">{error}</p>}
                    <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
                    <button type="button" className="btn btn-primary" disabled={busy || picked.size === 0} onClick={save}>{busy ? 'Adding…' : `Add ${picked.size}`}</button>
                </div>
            </Modal>
        </div>
    );
};

// Menu → Sizes & choices: choice groups shared by many dishes (Milk, Sugar, Flavour…)
const AdminChoices = () => {
    const { hasPerm } = useAuth();
    const canCreate = hasPerm('menu.create');
    const canEdit = hasPerm('menu.edit');
    const canDelete = hasPerm('menu.delete');
    const [groups, setGroups] = useState(null);
    const [items, setItems] = useState([]);
    const [editing, setEditing] = useState(null);
    const [dishesFor, setDishesFor] = useState(null);
    const [starters, setStarters] = useState(false);
    const [msg, setMsg] = useState('');
    const [error, setError] = useState('');

    const [tick, setTick] = useState(0);
    const load = () => setTick(t => t + 1);
    useEffect(() => {
        let live = true;
        Promise.all([getOptionGroups(), getAllMenuItems()]).then(([g, m]) => {
            if (!live) return;
            setGroups(g.data);
            setItems(m.data);
        }).catch(err => { if (live) { setError(errorText(err)); setGroups(g => g || []); } });
        return () => { live = false; };
    }, [tick]);
    const flash = (t) => { setMsg(t); setTimeout(() => setMsg(''), 3000); };
    const usedOn = (id) => items.filter(i => (i.optionGroups || []).includes(id));

    const remove = async (g) => {
        const used = usedOn(g._id);
        const warn = used.length
            ? `Delete ${g.name}? It is used on ${used.length} dish${used.length === 1 ? '' : 'es'} (${used.slice(0, 4).map(i => i.name).join(', ')}${used.length > 4 ? '…' : ''}). They stop asking for it.`
            : `Delete ${g.name}?`;
        if (!window.confirm(warn)) return;
        try {
            await Promise.all(used.map(i => updateMenuItem(i._id, { optionGroups: (i.optionGroups || []).filter(x => x !== g._id) })));
            await deleteOptionGroup(g._id);
            flash(`${g.name} deleted`);
            load();
        } catch (err) {
            setError(errorText(err, 'Could not delete'));
        }
    };

    if (!groups) return <div className="admin-loading"><div className="spinner" /></div>;
    const sized = items.filter(i => Array.isArray(i.sizes) && i.sizes.length > 0).length;

    return (
        <div className="m2-page">
            <div className="page-header">
                <div>
                    <h1>Sizes &amp; choices<InfoTip k="choices" /></h1>
                    <p className="muted">Choice groups like Milk, Sugar and Flavour, shared by many dishes. Prices are added to the dish.</p>
                </div>
                <div className="m2-head-actions">
                    {canCreate && <button type="button" className="btn btn-ghost" onClick={() => setStarters(true)}><FiZap /> Ready-made groups</button>}
                    {canCreate && <button type="button" className="btn btn-secondary" onClick={() => setEditing({})}><FiPlus /> New group</button>}
                </div>
            </div>
            {!canCreate && !canEdit && !canDelete && <ViewOnlyNote what="change choice groups" />}
            {msg && <div className="m2-flash" role="status">{msg}</div>}
            {error && <p className="m2-error" role="alert">{error}</p>}

            <div className="m2-card">
                <div className="m2-card-head"><b>Sizes</b><InfoTip k="sizes" /><span className="m2-pill grey">{sized} dish{sized === 1 ? '' : 'es'} with sizes</span></div>
                <p className="m2-hint">Sizes (Small 250 ml, Medium, Large) are set on each dish, each with its own price: <Link to="/admin/menu">Menu → Items</Link> → a dish → <b>Sizes</b>.</p>
            </div>

            <h2 style={{ fontSize: '1.05rem', margin: '18px 0 8px' }}>Choice groups</h2>
            {groups.length === 0 && (
                <div className="m2-card"><p className="m2-hint">No choice groups yet. {canCreate ? 'Tap Ready-made groups for Milk, Sugar, Ice, Flavour and Extra shot, or make your own.' : ''}</p></div>
            )}
            <div className="m2-list">
                {groups.map(g => {
                    const used = usedOn(g._id);
                    return (
                        <div key={g._id} className="m2-card">
                            <div className="m2-card-head">
                                <b>{g.name}</b>{g.nameHi && <small lang="hi">{g.nameHi}</small>}
                                <span className="m2-pill">{choiceRange(g)}</span>
                                <span className="m2-spacer" />
                                <small>Used on {used.length} dish{used.length === 1 ? '' : 'es'}</small>
                            </div>
                            <div className="m2-chips">
                                {(g.choices || []).map(x => (
                                    <span key={x.id} className={`m2-chip${x.available === false ? ' off' : ''}`} title={x.available === false ? 'Out of stock' : undefined}>
                                        {x.color && <i style={{ background: x.color }} />}{x.name} <small>{Number(x.price) > 0 ? `+${rupees(x.price)}` : 'free'}</small>{x.isDefault && <em>default</em>}
                                    </span>
                                ))}
                            </div>
                            {(canEdit || canDelete) && (
                                <div className="m2-actions">
                                    {canEdit && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDishesFor(g)}><FiLayers /> Add to dishes…</button>}
                                    {canEdit && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(g)}><FiEdit2 /> Edit</button>}
                                    {canDelete && <button type="button" className="btn btn-ghost btn-sm" style={{ color: '#B42318' }} onClick={() => remove(g)}><FiTrash2 /> Delete</button>}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {editing && <GroupEditor group={editing} onClose={() => setEditing(null)}
                onSaved={(saved) => { setEditing(null); flash(`${saved.name} saved`); load(); }} />}
            {dishesFor && <DishesModal group={dishesFor} items={items} onClose={() => setDishesFor(null)}
                onDone={(t) => { if (t) { setDishesFor(null); flash(t); } load(); }} />}
            {starters && <StartersModal existing={groups} onClose={() => setStarters(false)}
                onDone={(t) => { setStarters(false); flash(t); load(); }} />}
        </div>
    );
};

export default AdminChoices;
