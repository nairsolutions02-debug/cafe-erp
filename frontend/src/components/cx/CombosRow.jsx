import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Art from './Art';
import { artFor } from './artKinds';
import { getCombosOnSale } from '../../utils/api';
import { getImageUrl } from '../../utils/config';
import useCxLang, { T } from '../../lib/cxLang';
import './CombosRow.css';

// Strip of combos on sale right now (home page). Shows nothing when there are none.
//   <CombosRow title? />
const W = {
    title: T('Combos', 'कॉम्बो', 'Combos'),
    save: T('Save ₹{n}', '₹{n} बचाएँ', '₹{n} bachao'),
    open: T('Open {name}', '{name} खोलें', '{name} kholo'),
};
const rupees = (n) => Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });

const CombosRow = ({ title }) => {
    const { lang, t } = useCxLang();
    const [combos, setCombos] = useState([]);
    useEffect(() => {
        let gone = false;
        getCombosOnSale().then(r => !gone && setCombos(r.data || [])).catch(() => {});
        return () => { gone = true; };
    }, []);
    if (!combos.length) return null;

    return (
        <section className="cx-combos" aria-label={title || t(W.title)}>
            <h3 className="cx-combos-h">{title || t(W.title)}</h3>
            <div className="cx-combos-row">
                {combos.map(c => {
                    const name = (lang === 'hi' && c.nameHi) || c.name;
                    const arts = (c.slots || []).slice(0, 2).map(s => s.items?.[0]).filter(Boolean).map(i => artFor({ name: i.name, art: i.art }));
                    return (
                        <Link key={c.id} to={`/combo/${c.id}`} className="cx-combo-card" style={c.bg ? { background: c.bg } : undefined} aria-label={t(W.open, { name })}>
                            {c.save > 0 && <span className="cx-combo-save">{t(W.save, { n: rupees(c.save) })}</span>}
                            <span className="cx-combo-arts">
                                {c.image ? <img src={getImageUrl(c.image)} alt="" /> : (arts.length ? arts : [c.art || 'plate']).map((k, i) => <Art key={i} kind={k} />)}
                            </span>
                            <b>{name}</b>
                            <small>₹{rupees(c.price)}</small>
                        </Link>
                    );
                })}
            </div>
        </section>
    );
};

export default CombosRow;
