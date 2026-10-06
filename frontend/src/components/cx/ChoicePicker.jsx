import React from 'react';
import { FiCheck } from 'react-icons/fi';
import { T, fill } from '../../lib/cxLang';
import { sizeOf } from './choices';
import './ChoicePicker.css';

// Size buttons and choice groups of one dish. Used by the dish page and by each pick of a combo.
//   value: { size, choices: [ids] }   onChange(nextValue)
//   compact: smaller buttons (combo builder); sizeBase: price the size differences are shown against
const W = {
    size: T('Size', 'साइज़', 'Size'),
    included: T('included', 'शामिल', 'included'),
    upTo: T('pick up to {n}', 'ज़्यादा से ज़्यादा {n}', 'max {n} chuno'),
    between: T('pick {a} to {b}', '{a} से {b} चुनें', '{a} se {b} chuno'),
    atLeast: T('pick at least {n}', 'कम से कम {n} चुनें', 'kam se kam {n} chuno'),
    full: T('You can pick {n}. Untick one to change.', 'आप {n} चुन सकते हैं। बदलने के लिए एक हटाएँ।', '{n} chun sakte ho. Badalne ke liye ek hatao.'),
};

const rupees = (n) => `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const nm = (x, lang) => (lang === 'hi' && x?.nameHi) || x?.name || '';

// A cup that grows with the size
const Cup = ({ step, steps }) => {
    const h = 14 + Math.round((steps > 1 ? step / (steps - 1) : 0) * 10);
    return (
        <svg className="cxo-cup" viewBox="0 0 24 28" style={{ height: h, width: h * 0.86 }} aria-hidden="true">
            <path d="M4 6h16l-2 19a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2z" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" />
            <path d="M3 6h18M9 2h6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
    );
};

const ChoicePicker = ({ sizes = [], groups = [], value, onChange, lang = 'en', t, compact = false, sizeBase }) => {
    const sel = value || { size: '', choices: [] };
    const cur = sizeOf(sizes, sel.size);
    const base = sizeBase ?? (sizeOf(sizes)?.price ?? 0);
    const setSize = (id) => onChange({ ...sel, size: id });
    const pickOne = (g, id) => {
        const ids = (g.choices || []).map(c => c.id);
        onChange({ ...sel, choices: [...sel.choices.filter(c => !ids.includes(c)), id] });
    };
    const toggle = (g, id) => {
        const on = sel.choices.includes(id);
        const inGroup = sel.choices.filter(c => (g.choices || []).some(x => x.id === c));
        if (!on && inGroup.length >= (g.max || 99)) {
            // pick one more than allowed in a max-1 add-on group: swap
            if ((g.max || 99) === 1) onChange({ ...sel, choices: [...sel.choices.filter(c => !inGroup.includes(c)), id] });
            return;
        }
        onChange({ ...sel, choices: on ? sel.choices.filter(c => c !== id) : [...sel.choices, id] });
    };

    return (
        <div className={`cxo ${compact ? 'cxo-compact' : ''}`}>
            {sizes.length > 1 && (
                <div className="cxo-grp">
                    {!compact && <h5>{t(W.size)}</h5>}
                    <div className="cxo-seg" role="radiogroup" aria-label={t(W.size)}>
                        {sizes.map((s, i) => {
                            const d = Number(s.price) - Number(base);
                            return (
                                <button key={s.id} type="button" role="radio" aria-checked={cur?.id === s.id}
                                    className={`cxo-opt cxo-size ${cur?.id === s.id ? 'on' : ''}`} onClick={() => setSize(s.id)}>
                                    {!compact && <Cup step={i} steps={sizes.length} />}
                                    <span className="cxo-name">{nm(s, lang)}</span>
                                    {(s.amount || d !== 0) && (
                                        <small>{[!compact && s.amount, d !== 0 && `${d > 0 ? '+' : '−'}${rupees(Math.abs(d))}`].filter(Boolean).join(' · ')}</small>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}
            {groups.map(g => {
                const list = (g.choices || []).filter(c => c.available !== false);
                if (!list.length) return null;
                const priced = list.some(c => Number(c.price) > 0);
                if (g.pick === 'one') {
                    const chosen = list.find(c => sel.choices.includes(c.id))?.id;
                    return (
                        <div className="cxo-grp" key={g.id}>
                            <h5>{nm(g, lang)}</h5>
                            <div className="cxo-seg" role="radiogroup" aria-label={nm(g, lang)}>
                                {list.map(c => (
                                    <button key={c.id} type="button" role="radio" aria-checked={chosen === c.id}
                                        className={`cxo-opt ${chosen === c.id ? 'on' : ''}`} onClick={() => pickOne(g, c.id)}>
                                        <span className="cxo-name">{nm(c, lang)}</span>
                                        {priced && <small>{Number(c.price) > 0 ? `+${rupees(c.price)}` : t(W.included)}</small>}
                                    </button>
                                ))}
                            </div>
                        </div>
                    );
                }
                const inGroup = sel.choices.filter(id => list.some(c => c.id === id));
                const max = g.max || list.length;
                const full = inGroup.length >= max && max > 1;
                const hint = g.min > 0
                    ? (g.min === max ? fill(t(W.atLeast), { n: g.min }) : fill(t(W.between), { a: g.min, b: max }))
                    : fill(t(W.upTo), { n: max });
                return (
                    <div className="cxo-grp" key={g.id}>
                        <h5>{nm(g, lang)} <small>{hint}</small></h5>
                        {list.map(c => {
                            const on = sel.choices.includes(c.id);
                            const off = !on && full;
                            return (
                                <button key={c.id} type="button" role="checkbox" aria-checked={on} aria-disabled={off}
                                    className={`cxo-addon ${on ? 'on' : ''} ${off ? 'off' : ''}`} onClick={() => toggle(g, c.id)}>
                                    <span className="cxo-box">{on && <FiCheck />}</span>
                                    {c.color && <span className="cxo-dot" style={{ background: c.color }} />}
                                    <span className="cxo-name">{nm(c, lang)}</span>
                                    <em>{Number(c.price) > 0 ? `+${rupees(c.price)}` : ''}</em>
                                </button>
                            );
                        })}
                        {full && <p className="cxo-full">{fill(t(W.full), { n: max })}</p>}
                    </div>
                );
            })}
        </div>
    );
};

export default ChoicePicker;
