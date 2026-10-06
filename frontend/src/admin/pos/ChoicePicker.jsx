import React, { useMemo, useState } from 'react';
import { FiX, FiMinus, FiPlus } from 'react-icons/fi';
import { inr } from './money';
import { num, sizesOf, minOf, maxOf, isDef, avail, groupsFor, hasChoices, defaultSel, priceDish, priceCombo, splitNote } from './choices';

// Staff picker sheets for sizes, choices and combos, and the choices shown under a dish name.
// Pricing lives in choices.js (a copy of the database pricing, for the offline counter).

// Under a dish name: the choices (and, for a combo, each pick on its own line)
export const LineNote = ({ item, className = 'line-opts' }) => {
    const { picks, text } = splitNote(item);
    if (!picks.length && !text) return null;
    return (
        <span className={className}>
            {picks.map((p, n) => <span key={n} className="lo-pick">{p}</span>)}
            {text && <span className="lo-text">{text}</span>}
        </span>
    );
};

// ---- staff picker sheets -------------------------------------------------------
const Sheet = ({ title, sub, onClose, children, foot }) => (
    <div className="modal-overlay cp-overlay" onClick={onClose}>
        <div className="modal cp-sheet" role="dialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()}>
            <div className="cp-head">
                <div><h2>{title}</h2>{sub && <p className="muted small">{sub}</p>}</div>
                <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}><FiX /></button>
            </div>
            <div className="cp-body">{children}</div>
            <div className="cp-foot">{foot}</div>
        </div>
    </div>
);

// Size buttons and each choice group, for one dish (also used inside a combo)
const DishOptions = ({ item, groups, sel, setSel, upgrade = false }) => {
    const sizes = sizesOf(item);
    const gs = groupsFor(item, groups);
    const toggle = (g, c) => {
        const inGroup = (g.choices || []).map(x => x.id);
        const mine = sel.choices.filter(id => inGroup.includes(id));
        let next;
        if (g.pick === 'one') {
            next = mine.includes(c.id) && minOf(g) === 0 ? [] : [c.id];
        } else if (mine.includes(c.id)) {
            next = mine.filter(id => id !== c.id);
        } else {
            next = mine.length >= maxOf(g) ? [...mine.slice(1), c.id] : [...mine, c.id];
        }
        setSel({ ...sel, choices: [...sel.choices.filter(id => !inGroup.includes(id)), ...next] });
    };
    const basePrice = num((sizes.find(isDef) || sizes[0])?.price);
    return (
        <>
            {sizes.length > 0 && (
                <div className="cp-group">
                    <div className="cp-gname">Size</div>
                    <div className="cp-opts" role="radiogroup" aria-label="Size">
                        {sizes.map(s => (
                            <button key={s.id} type="button" role="radio" aria-checked={sel.size === s.id}
                                className={sel.size === s.id ? 'on' : ''} onClick={() => setSel({ ...sel, size: s.id })}>
                                <b>{s.name}</b>
                                <small>{!upgrade ? inr(s.price) : num(s.price) - basePrice > 0 ? `+${inr(num(s.price) - basePrice)}` : 'included'}</small>
                            </button>
                        ))}
                    </div>
                </div>
            )}
            {gs.map(g => {
                const mine = sel.choices.filter(id => (g.choices || []).some(c => c.id === id));
                const rule = g.pick === 'one' ? (minOf(g) > 0 ? 'Pick one' : 'Optional') : `Up to ${maxOf(g)}${minOf(g) > 0 ? `, at least ${minOf(g)}` : ''}`;
                return (
                    <div key={g.id} className="cp-group">
                        <div className="cp-gname">{g.name} <span className="muted small">{rule}</span></div>
                        <div className="cp-opts" role={g.pick === 'one' ? 'radiogroup' : 'group'} aria-label={g.name}>
                            {(g.choices || []).map(c => (
                                <button key={c.id} type="button" disabled={!avail(c)}
                                    role={g.pick === 'one' ? 'radio' : 'checkbox'} aria-checked={mine.includes(c.id)}
                                    className={mine.includes(c.id) ? 'on' : ''} onClick={() => toggle(g, c)}>
                                    <b>{c.name}</b>
                                    <small>{!avail(c) ? 'Sold out' : num(c.price) > 0 ? `+${inr(c.price)}` : isDef(c) ? 'usual' : 'free'}</small>
                                </button>
                            ))}
                        </div>
                    </div>
                );
            })}
        </>
    );
};

const missingIn = (item, groups, sel) => groupsFor(item, groups).filter(g => {
    const n = sel.choices.filter(id => (g.choices || []).some(c => c.id === id)).length;
    return n < minOf(g) || n > maxOf(g);
}).map(g => g.name);

const Qty = ({ qty, setQty }) => (
    <span className="cp-qty">
        <button type="button" aria-label="One less" onClick={() => setQty(Math.max(1, qty - 1))}><FiMinus /></button>
        <b aria-live="polite">{qty}</b>
        <button type="button" aria-label="One more" onClick={() => setQty(Math.min(99, qty + 1))}><FiPlus /></button>
    </span>
);

// Dish picker: size, choices, live price, Add
export const ChoicePicker = ({ item, groups, onAdd, onClose }) => {
    const [sel, setSel] = useState(() => defaultSel(item, groups));
    const [qty, setQty] = useState(1);
    const d = priceDish(item, sel, groups);
    const missing = missingIn(item, groups, sel);
    return (
        <Sheet title={item.name} sub={d.words || (d.name !== item.name ? d.name : '')} onClose={onClose}
            foot={<>
                <Qty qty={qty} setQty={setQty} />
                <button type="button" className="btn btn-primary btn-lg cp-add" disabled={missing.length > 0}
                    onClick={() => onAdd({ sel, qty, ...d })}>
                    {missing.length ? `Pick ${missing.join(', ')}` : `Add · ${inr(d.price * qty)}`}
                </button>
            </>}>
            <DishOptions item={item} groups={groups} sel={sel} setSel={setSel} />
        </Sheet>
    );
};

// Combo picker: one dish per slot (with its own size and choices), live price, Add
export const ComboPicker = ({ combo, itemsById, groups, onAdd, onClose }) => {
    const [picks, setPicks] = useState(() => (combo.slots || []).map(s => {
        const first = (s.items || []).find(i => itemsById[i.menuItem]);
        return first ? { menuItem: first.menuItem, ...defaultSel(itemsById[first.menuItem], groups) } : null;
    }));
    const [qty, setQty] = useState(1);
    const setPick = (n, p) => setPicks(ps => ps.map((x, i) => (i === n ? p : x)));
    const q = useMemo(() => priceCombo(combo, picks, itemsById, groups), [combo, picks, itemsById, groups]);
    const ready = picks.every(Boolean) && picks.every(p => !missingIn(itemsById[p.menuItem], groups, p).length);
    return (
        <Sheet title={combo.name} sub={q.words} onClose={onClose}
            foot={<>
                <Qty qty={qty} setQty={setQty} />
                <button type="button" className="btn btn-primary btn-lg cp-add" disabled={!ready}
                    onClick={() => onAdd({ picks: picks.map(p => ({ menuItem: p.menuItem, size: p.size || undefined, choices: p.choices })), qty, ...q })}>
                    {ready ? `Add · ${inr(q.price * qty)}` : 'Pick each part'}
                </button>
            </>}>
            {(combo.slots || []).map((slot, n) => {
                const pick = picks[n];
                const item = pick && itemsById[pick.menuItem];
                return (
                    <div key={n} className="cp-slot">
                        <div className="cp-gname cp-slot-name">{n + 1}. {slot.name}</div>
                        <div className="cp-opts" role="radiogroup" aria-label={slot.name}>
                            {(slot.items || []).filter(i => itemsById[i.menuItem]).map(i => (
                                <button key={i.menuItem} type="button" role="radio" aria-checked={pick?.menuItem === i.menuItem}
                                    className={pick?.menuItem === i.menuItem ? 'on' : ''}
                                    onClick={() => setPick(n, { menuItem: i.menuItem, ...defaultSel(itemsById[i.menuItem], groups) })}>
                                    <b>{itemsById[i.menuItem].name}</b>
                                    <small>{num(i.extra) > 0 ? `+${inr(i.extra)}` : 'included'}</small>
                                </button>
                            ))}
                        </div>
                        {item && hasChoices(item, groups) && (
                            <div className="cp-sub">
                                <DishOptions item={item} groups={groups} sel={pick} setSel={(p) => setPick(n, p)} upgrade />
                            </div>
                        )}
                    </div>
                );
            })}
        </Sheet>
    );
};
