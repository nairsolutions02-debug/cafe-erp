import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FiPlus, FiTrash2, FiArrowUp, FiArrowDown, FiSearch, FiX, FiExternalLink } from 'react-icons/fi';
import Art from '../../components/cx/Art';
import { ART_KINDS, ART_LABELS, artFor } from '../../components/cx/artKinds';
import InfoTip from '../help/InfoTip';
import { uid, MAX_PAIRS, MAX_GROUPS, MAX_SIZES, DETAIL_SHOW, showOf, choiceRange, rupees } from './menuExtras';
import './Menu2.css';

// The parts of Menu → Items → a dish that shape the customer dish page: sizes, choice groups, goes well with,
// what the details page shows, and the drawn picture used when there is no photo.

// Sizes: [{id, name, nameHi, amount, price, isDefault}]
export const SizesEditor = ({ sizes, onChange, basePrice }) => {
    const set = (i, patch) => onChange(sizes.map((s, n) => (n === i ? { ...s, ...patch } : s)));
    const add = (preset) => {
        if (preset) {
            const p = Number(basePrice) || 0;
            onChange([{ id: uid(), name: 'Small', nameHi: 'छोटा', amount: '250 ml', price: Math.max(0, p - 30), isDefault: false },
                { id: uid(), name: 'Medium', nameHi: 'मीडियम', amount: '350 ml', price: p, isDefault: true },
                { id: uid(), name: 'Large', nameHi: 'बड़ा', amount: '450 ml', price: p + 40, isDefault: false }]);
            return;
        }
        onChange([...sizes, { id: uid(), name: '', nameHi: '', amount: '', price: '', isDefault: sizes.length === 0 }]);
    };
    const remove = (i) => {
        const next = sizes.filter((_, n) => n !== i);
        if (next.length && !next.some(s => s.isDefault)) next[0] = { ...next[0], isDefault: true };
        onChange(next);
    };
    return (
        <div className="m2-sec">
            <div className="m2-sec-head"><h3>Sizes<InfoTip k="sizes" /></h3>
                {sizes.length > 0 && sizes.length < MAX_SIZES && <button type="button" className="btn btn-ghost btn-sm" onClick={() => add(false)}><FiPlus /> Add size</button>}</div>
            {sizes.length === 0 ? (
                <div className="m2-empty">
                    <p>One size only. Add sizes when the dish comes in small, medium and large; each size has its own full price.</p>
                    <div className="m2-row-btns">
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => add(true)}>Small / Medium / Large</button>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => add(false)}><FiPlus /> Add one size</button>
                    </div>
                </div>
            ) : (
                <div className="m2-sizes" role="table" aria-label="Sizes">
                    <div className="m2-sizes-head" role="row"><span>Size</span><span>नाम हिंदी</span><span>Amount</span><span>Price ₹</span><span>Default</span><span /></div>
                    {sizes.map((s, i) => (
                        <div key={s.id} className="m2-size" role="row">
                            <input className="input" aria-label="Size name" placeholder="Medium" maxLength={24} value={s.name} onChange={e => set(i, { name: e.target.value })} />
                            <input className="input" aria-label="Size name in Hindi" lang="hi" placeholder="मीडियम" maxLength={24} value={s.nameHi || ''} onChange={e => set(i, { nameHi: e.target.value })} />
                            <input className="input" aria-label="Amount" placeholder="350 ml" maxLength={20} value={s.amount || ''} onChange={e => set(i, { amount: e.target.value })} />
                            <input className="input" aria-label="Price" type="number" min="0" step="1" placeholder="220" value={s.price} onChange={e => set(i, { price: e.target.value })} />
                            <label className="m2-radio"><input type="radio" name="size-default" checked={!!s.isDefault}
                                onChange={() => onChange(sizes.map((x, n) => ({ ...x, isDefault: n === i })))} /><span>Default</span></label>
                            <button type="button" className="icon-btn delete" aria-label={`Remove size ${s.name}`} onClick={() => remove(i)}><FiTrash2 /></button>
                        </div>
                    ))}
                    <p className="m2-hint">The default size is picked first on the dish page, and is what the counter and kiosk sell when nobody picks.</p>
                </div>
            )}
        </div>
    );
};

// Choice groups on this dish, in order
export const ChoicesPicker = ({ value, groups, onChange, loading }) => {
    const [adding, setAdding] = useState('');
    const on = value.map(id => groups.find(g => g._id === id)).filter(Boolean);
    const rest = groups.filter(g => !value.includes(g._id));
    const move = (i, d) => { const n = [...value]; [n[i], n[i + d]] = [n[i + d], n[i]]; onChange(n); };
    return (
        <div className="m2-sec">
            <div className="m2-sec-head"><h3>Choices &amp; add-ons<InfoTip k="choices" /></h3>
                <Link className="btn btn-ghost btn-sm" to="/admin/choices" target="_blank" rel="noreferrer"><FiExternalLink /> Manage groups</Link></div>
            <p className="m2-hint">Groups are shared by many dishes (Milk, Sugar, Flavour…). "Pick one" groups always have an answer; add-on groups are optional. The customer sees them in this order.</p>
            {loading && <p className="m2-hint">Loading groups…</p>}
            {!loading && groups.length === 0 && <div className="m2-empty"><p>No choice groups yet. <Link to="/admin/choices" target="_blank" rel="noreferrer">Make the first ones</Link> (there are ready-made ones for milk, sugar and ice), then come back here.</p></div>}
            <div className="m2-groups">
                {on.map((g, i) => (
                    <div key={g._id} className="m2-group">
                        <div className="m2-group-head">
                            <b>{g.name}</b>
                            <span className="m2-pill">{choiceRange(g)}</span>
                            <span className="m2-spacer" />
                            <button type="button" className="icon-btn" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}><FiArrowUp /></button>
                            <button type="button" className="icon-btn" aria-label="Move down" disabled={i === on.length - 1} onClick={() => move(i, 1)}><FiArrowDown /></button>
                            <button type="button" className="icon-btn delete" aria-label={`Take ${g.name} off this dish`} onClick={() => onChange(value.filter(x => x !== g._id))}><FiX /></button>
                        </div>
                        <div className="m2-chips">
                            {(g.choices || []).map(c => (
                                <span key={c.id} className={`m2-chip${c.available === false ? ' off' : ''}`}>
                                    {c.color && <i style={{ background: c.color }} />}{c.name} <small>{Number(c.price) > 0 ? `+${rupees(c.price)}` : 'free'}</small>{c.isDefault && <em>default</em>}
                                </span>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
            {rest.length > 0 && value.length < MAX_GROUPS && (
                <div className="m2-add-row">
                    <select className="input" aria-label="Add a choice group" value={adding} onChange={e => setAdding(e.target.value)}>
                        <option value="">Add a group…</option>
                        {rest.map(g => <option key={g._id} value={g._id}>{g.name} · {(g.choices || []).map(c => c.name).join(', ')}</option>)}
                    </select>
                    <button type="button" className="btn btn-secondary btn-sm" disabled={!adding} onClick={() => { onChange([...value, adding]); setAdding(''); }}><FiPlus /> Add</button>
                </div>
            )}
        </div>
    );
};

// Goes well with: up to 8 other dishes
export const PairsPicker = ({ value, items, selfId, onChange }) => {
    const [q, setQ] = useState('');
    const others = useMemo(() => items.filter(i => i._id !== selfId && i.soldInShop !== false), [items, selfId]);
    const picked = value.map(id => others.find(i => i._id === id)).filter(Boolean);
    const term = q.trim().toLowerCase();
    const list = others.filter(i => !term || i.name.toLowerCase().includes(term) || (i.category?.name || '').toLowerCase().includes(term)).slice(0, 60);
    const full = value.length >= MAX_PAIRS;
    return (
        <div className="m2-sec">
            <div className="m2-sec-head"><h3>Goes well with<InfoTip k="goes_well" /></h3><span className="m2-count">{value.length} of {MAX_PAIRS}</span></div>
            <p className="m2-hint">Shown on the dish page so customers add a bite to their coffee. Up to {MAX_PAIRS} dishes, in this order.</p>
            {picked.length > 0 && (
                <div className="m2-chips m2-picked">
                    {picked.map(i => (
                        <span key={i._id} className="m2-chip">{i.name} <small>{rupees(i.price)}</small>
                            <button type="button" aria-label={`Remove ${i.name}`} onClick={() => onChange(value.filter(x => x !== i._id))}><FiX /></button></span>
                    ))}
                </div>
            )}
            <div className="m2-search"><FiSearch /><input className="input" placeholder="Search dishes" value={q} onChange={e => setQ(e.target.value)} aria-label="Search dishes" /></div>
            <div className="m2-pick-list">
                {list.map(i => {
                    const on = value.includes(i._id);
                    return (
                        <label key={i._id} className={`m2-pick${on ? ' on' : ''}${!on && full ? ' disabled' : ''}`}>
                            <input type="checkbox" checked={on} disabled={!on && full}
                                onChange={e => onChange(e.target.checked ? [...value, i._id] : value.filter(x => x !== i._id))} />
                            <span className="m2-pick-name">{i.name}<small>{i.category?.name}</small></span>
                            <span>{rupees(i.price)}</span>
                        </label>
                    );
                })}
                {list.length === 0 && <p className="m2-hint">No dishes match.</p>}
            </div>
        </div>
    );
};

// Details page: facts and what the page shows
export const DetailsEditor = ({ details, onChange }) => {
    const show = showOf(details);
    const set = (k, v) => onChange({ ...details, [k]: v });
    return (
        <div className="m2-sec">
            <div className="m2-sec-head"><h3>Details page<InfoTip k="details_page" /></h3></div>
            <p className="m2-hint">Facts shown on the customer dish page. Leave empty what you don't know; empty facts are hidden.</p>
            <div className="form-grid">
                <div className="input-group"><label>Calories</label>
                    <input className="input" maxLength={20} placeholder="210 kcal" value={details.calories || ''} onChange={e => set('calories', e.target.value)} /></div>
                <div className="input-group"><label>Caffeine</label>
                    <input className="input" maxLength={20} placeholder="150 mg" value={details.caffeine || ''} onChange={e => set('caffeine', e.target.value)} /></div>
                <div className="input-group"><label>Allergens</label>
                    <input className="input" maxLength={80} placeholder="Milk, nuts" value={details.allergens || ''} onChange={e => set('allergens', e.target.value)} /></div>
                <div className="input-group"><label>Served</label>
                    <input className="input" maxLength={60} placeholder="Cold, in a 350 ml glass" value={details.served || ''} onChange={e => set('served', e.target.value)} /></div>
            </div>
            <div className="input-group"><label>Ingredients</label>
                <textarea className="input" rows={2} maxLength={300} placeholder="Double espresso, milk, house caramel, whipped cream" value={details.ingredients || ''}
                    onChange={e => set('ingredients', e.target.value)} /></div>
            <h4 className="m2-sub">The page shows</h4>
            <div className="m2-show">
                {DETAIL_SHOW.map(([k, l]) => (
                    <label key={k} className={show[k] ? 'on' : ''}>
                        <input type="checkbox" checked={show[k]} onChange={e => onChange({ ...details, show: { ...show, [k]: e.target.checked } })} /> {l}
                    </label>
                ))}
            </div>
        </div>
    );
};

// Drawn picture, used when the dish has no photo
export const ArtPicker = ({ value, item, onChange }) => {
    const auto = artFor({ name: item.name, category: item.category });
    return (
        <div className="m2-art">
            <span className="m2-art-label">Drawn picture <small>used when there is no photo</small><InfoTip k="dish_art" /></span>
            <div className="m2-arts" role="radiogroup" aria-label="Drawn picture">
                <button type="button" role="radio" aria-checked={!value} className={!value ? 'on' : ''} onClick={() => onChange('')}>
                    <Art kind={auto} /><span>Automatic<small>{ART_LABELS[auto]}</small></span></button>
                {ART_KINDS.map(k => (
                    <button key={k} type="button" role="radio" aria-checked={value === k} className={value === k ? 'on' : ''} onClick={() => onChange(k)}>
                        <Art kind={k} /><span>{ART_LABELS[k]}</span></button>
                ))}
            </div>
        </div>
    );
};
