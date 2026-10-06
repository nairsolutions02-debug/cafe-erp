import React, { useEffect, useMemo, useState } from 'react';
import { FiPlus, FiEdit2, FiTrash2, FiStar, FiRotateCcw, FiSave, FiCheck } from 'react-icons/fi';
import { THEME_KEYS, CX_FONTS, DEFAULT_LOOK, normaliseLook, themeOf, loadCxFonts } from '../../lib/cxThemes';
import { contrast, deeper, isHex, MIN_CONTRAST } from '../../lib/theme';
import InfoTip from '../help/InfoTip';
import CxPhone from './CxPhone';
import './CxLook.css';

// Admin → Customer app → Look & themes (setting `cx_look`). The owner switches themes on, marks one ★ (what new
// customers see first) and sets glass, corners, heading font and the bottom bar. Customers pick theirs in Me → Look.
const PALETTE = ['#F08A24', '#EA580C', '#DC2626', '#E11D48', '#DB2777', '#C026D3', '#7C3AED', '#4F46E5', '#2563EB', '#0284C7', '#0891B2', '#0D9488',
    '#059669', '#16A34A', '#65A30D', '#CA8A04', '#D97706', '#B45309', '#92400E', '#78350F', '#57534E', '#334155', '#1E293B', '#0B0B0F'];
const PAIRS = [['Coffee & cream', '#6F4E37', '#F3E2C7'], ['Saffron & ink', '#EA7A12', '#1C1917'], ['Teal & gold', '#0F766E', '#F59E0B'],
    ['Berry & lilac', '#BE185D', '#C4B5FD'], ['Matcha & oat', '#4D7C3A', '#EDE6D6'], ['Navy & sky', '#1E3A8A', '#7DD3FC'], ['Gold & night', '#D4AF37', '#0B0B0F'],
    ['Chai & clay', '#9A3412', '#F5E3C8'], ['Mint & cocoa', '#10B981', '#3E2723'], ['Coral & cream', '#F97362', '#FFF4E6']];
const GLASS_WORD = (g) => (g === 0 ? 'Off' : g < 35 ? 'Light' : g < 70 ? 'Medium' : 'Strong');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const Seg = ({ value, options, onChange, disabled, label, fontPreview }) => (
    <span className="lk-seg" role="group" aria-label={label}>
        {options.map(([k, l]) => (
            <button key={k} type="button" disabled={disabled} aria-pressed={value === k} className={value === k ? 'on' : ''}
                style={fontPreview && k ? { fontFamily: `'${k}', sans-serif` } : undefined} onClick={() => onChange(k)}>{l}</button>
        ))}
    </span>
);

const Switch = ({ checked, onChange, disabled, label }) => (
    <label className={`lk-switch${disabled ? ' disabled' : ''}`} title={label} onClick={e => e.stopPropagation()}>
        <input type="checkbox" checked={checked} disabled={disabled} aria-label={label} onChange={e => onChange(e.target.checked)} />
        <span aria-hidden="true" />
    </label>
);

// The little picture on each theme card: banner strip, two cards, a button
const Mini = ({ t }) => (
    <span className="lk-mini" style={{ background: t.bg }}>
        <i className="lk-mini-ban" style={{ background: t.ban }} />
        <span className="lk-mini-cards"><i style={{ background: t.sf, borderColor: t.ln }} /><i style={{ background: t.sf, borderColor: t.ln }} /></span>
        <i className="lk-mini-btn" style={{ background: t.pr }} />
    </span>
);

const ThemeCard = ({ k, look, previewing, canEdit, onPreview, onToggle, onEdit }) => {
    const t = themeOf(k, look);
    const on = look.enabled.includes(k);
    const first = look.first === k;
    const kind = [t.glass && 'Glass', t.dark ? 'Dark' : 'Light'].filter(Boolean).join(' · ');
    return (
        <div className={`lk-theme${previewing ? ' previewing' : ''}${on ? '' : ' off'}`} role="button" tabIndex={0}
            aria-label={`Preview ${t.name.en}`} onClick={onPreview} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPreview(); } }}>
            <Mini t={t} />
            <span className="lk-theme-name"><b>{t.name.en}</b>{first && <span className="lk-first"><FiStar /> First</span>}</span>
            <span className="lk-theme-foot">
                <small>{kind}</small>
                {onEdit && canEdit && <button type="button" className="lk-icon" aria-label="Change my theme" onClick={e => { e.stopPropagation(); onEdit(); }}><FiEdit2 /></button>}
                <Switch checked={on} disabled={!canEdit || first} label={first ? 'The ★ theme is always on' : `${t.name.en} on for customers`} onChange={onToggle} />
            </span>
        </div>
    );
};

// Make my own: name, main and second colour, dark yes / no. The main colour must carry white text.
const MakeOwn = ({ value, onSave, onCancel, onRemove }) => {
    const [c, setC] = useState({ name: 'My theme', main: '#C87316', accent: '#F3E2C7', dark: false, ...(value || {}) });
    const [slot, setSlot] = useState('main');
    const ratio = isHex(c.main) ? contrast(c.main, '#ffffff') : 0;
    const ok = ratio >= MIN_CONTRAST;
    const set = (k, v) => setC(p => ({ ...p, [k]: v }));
    return (
        <div className="lk-own">
            <div className="lk-own-head">
                <h3>{value ? 'My theme' : 'Make my own'}</h3>
                <small className="muted">24 colours, ready pairs, or type any colour code. The app checks the text stays readable.</small>
            </div>
            <div className="lk-own-fields">
                <label className="lk-field">Name<input className="input" maxLength={24} value={c.name} onChange={e => set('name', e.target.value)} /></label>
                {[['main', 'Main colour'], ['accent', 'Second colour']].map(([k, l]) => (
                    <label key={k} className={`lk-field lk-colour${slot === k ? ' on' : ''}`} onClick={() => setSlot(k)}>{l}
                        <span><i style={{ background: isHex(c[k]) ? c[k] : '#fff' }} />
                            <input className="input" value={c[k]} maxLength={7} onFocus={() => setSlot(k)} onChange={e => set(k, e.target.value.trim())} /></span>
                    </label>
                ))}
                <label className="lk-field">Background<Seg label="Light or dark" value={c.dark ? 'dark' : 'light'} options={[['light', 'Light'], ['dark', 'Dark']]} onChange={v => set('dark', v === 'dark')} /></label>
            </div>
            <p className="lk-hint">Tap a colour for the <b>{slot === 'main' ? 'main colour' : 'second colour'}</b>:</p>
            <div className="lk-pal">
                {PALETTE.map(h => (
                    <button key={h} type="button" style={{ background: h }} aria-label={h} className={c[slot]?.toUpperCase() === h ? 'on' : ''} onClick={() => set(slot, h)} />
                ))}
            </div>
            <p className="lk-hint">Ready-made pairs (main + second colour):</p>
            <div className="lk-pairs">
                {PAIRS.map(([n, a, b]) => (
                    <button key={n} type="button" className={c.main === a && c.accent === b ? 'on' : ''} onClick={() => setC(p => ({ ...p, main: a, accent: b }))}>
                        <i><b style={{ background: a }} /><b style={{ background: b }} /></i>{n}
                    </button>
                ))}
            </div>
            <div className={`lk-check ${ok ? 'ok' : 'bad'}`} role="status">
                <span className="lk-check-chip" style={{ background: isHex(c.main) ? c.main : '#ccc' }}>Add · ₹220</span>
                {!isHex(c.main) ? 'Type a colour like #C87316.'
                    : ok ? <span><FiCheck /> Easy to read ({ratio.toFixed(1)} : 1).</span>
                        : <span>Too pale for white text ({ratio.toFixed(1)} : 1, needs {MIN_CONTRAST}).{' '}
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => set('main', deeper(c.main))}>Use a deeper shade</button></span>}
            </div>
            <div className="lk-own-actions">
                {value && <button type="button" className="btn btn-ghost btn-sm lk-danger" onClick={onRemove}><FiTrash2 /> Remove my theme</button>}
                <span className="lk-spacer" />
                <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
                <button type="button" className="btn btn-primary btn-sm" disabled={!ok || !isHex(c.accent) || !c.name.trim()}
                    onClick={() => onSave({ name: c.name.trim(), main: c.main.toUpperCase(), accent: c.accent.toUpperCase(), dark: !!c.dark })}>
                    {value ? 'Use these colours' : 'Add my theme'}
                </button>
            </div>
        </div>
    );
};

const CxLook = ({ initial, canEdit, saveSetting }) => {
    const [saved, setSaved] = useState(() => normaliseLook(initial));
    const [look, setLook] = useState(saved);
    const [preview, setPreview] = useState(saved.first);
    const [own, setOwn] = useState(false);
    const [busy, setBusy] = useState(false);
    const dirty = !same(look, saved);
    useEffect(() => { loadCxFonts(CX_FONTS); }, []);

    useEffect(() => {
        if (!dirty) return undefined;
        const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
        window.addEventListener('beforeunload', warn);
        return () => window.removeEventListener('beforeunload', warn);
    }, [dirty]);

    const keys = useMemo(() => [...THEME_KEYS, ...(look.custom ? ['custom'] : [])], [look.custom]);
    const set = (patch) => setLook(l => normaliseLook({ ...l, ...patch }));
    const toggle = (k, on) => {
        if (!on && look.enabled.length <= 1) return;
        set({ enabled: on ? [...look.enabled, k].filter((x, i, a) => a.indexOf(x) === i) : look.enabled.filter(x => x !== k) });
    };
    const save = async () => {
        setBusy(true);
        await saveSetting('cx_look', look, () => setSaved(look));
        setBusy(false);
    };
    const pt = themeOf(preview, look);

    return (
        <section className="ca-card lk">
            <div className="lk-top">
                <div>
                    <h2>Look &amp; themes<InfoTip k="cx_themes" /></h2>
                    <p className="muted small">Pick which themes customers can choose from, and the one new customers see first. Tap a card to preview it.</p>
                </div>
                {canEdit && (
                    <div className="lk-top-actions">
                        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => { setLook(normaliseLook(DEFAULT_LOOK)); setPreview(DEFAULT_LOOK.first); }}
                            title="Back to the standard themes and style"><FiRotateCcw /> Standard</button>
                        {dirty && <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => { setLook(saved); setPreview(saved.first); }}>Undo changes</button>}
                        <button type="button" className="btn btn-primary btn-sm" disabled={!dirty || busy} onClick={save}><FiSave /> {dirty ? 'Save look' : 'Saved'}</button>
                    </div>
                )}
            </div>
            <div className="lk-grid">
                <div className="lk-form">
                    <h3>Themes customers can pick</h3>
                    <p className="lk-hint">Switch on the ones you like. <FiStar /> marks the theme new customers see first; it is always on. Customers change theirs in Me → Look.</p>
                    <div className="lk-themes">
                        {keys.map(k => (
                            <ThemeCard key={k} k={k} look={look} canEdit={canEdit} previewing={preview === k}
                                onPreview={() => setPreview(k)} onToggle={(v) => toggle(k, v)} onEdit={k === 'custom' ? () => setOwn(true) : null} />
                        ))}
                        {!look.custom && canEdit && !own && (
                            <button type="button" className="lk-theme lk-add" onClick={() => setOwn(true)}><FiPlus /> Make my own</button>
                        )}
                    </div>
                    {own && (
                        <MakeOwn value={look.custom} onCancel={() => setOwn(false)}
                            onSave={(c) => { set({ custom: c, enabled: look.custom ? look.enabled : [...look.enabled, 'custom'] }); setPreview('custom'); setOwn(false); }}
                            onRemove={() => {
                                const enabled = look.enabled.filter(x => x !== 'custom');
                                set({ custom: null, enabled: enabled.length ? enabled : ['latte'], first: look.first === 'custom' ? (enabled[0] || 'latte') : look.first });
                                setPreview(look.first === 'custom' ? (enabled[0] || 'latte') : look.first);
                                setOwn(false);
                            }} />
                    )}

                    <h3>Rules</h3>
                    <div className="lk-rows">
                        <div className="lk-row"><span><b>Let customers choose a theme</b><small>Off = everyone sees your <FiStar /> theme</small></span>
                            <Switch checked={look.customerPick} disabled={!canEdit} label="Let customers choose a theme" onChange={v => set({ customerPick: v })} /></div>
                        <div className="lk-row"><span><b>Let customers choose light or dark</b><small>Off = every theme shows as it is (dark themes stay dark)</small></span>
                            <Switch checked={look.modePick} disabled={!canEdit} label="Let customers choose light or dark" onChange={v => set({ modePick: v })} /></div>
                        <div className="lk-row"><span><b><FiStar /> First theme</b><small>Now: {themeOf(look.first, look).name.en}. Previewing: {pt.name.en}</small></span>
                            <button type="button" className="btn btn-secondary btn-sm" disabled={!canEdit || preview === look.first}
                                onClick={() => set({ first: preview, enabled: look.enabled.includes(preview) ? look.enabled : [...look.enabled, preview] })}>
                                <FiStar /> Make {pt.name.en} first</button></div>
                    </div>

                    <h3>Style</h3>
                    <div className="lk-rows">
                        <div className="lk-row"><span><b>Glass look<InfoTip k="cx_glass" /></b><small>Frosted cards over a soft colour background. Only glass themes use it.</small></span>
                            <span className="lk-slider"><input type="range" min={0} max={100} step={5} value={look.glass} disabled={!canEdit} aria-label="Glass strength"
                                onChange={e => set({ glass: Number(e.target.value) })} /><small>{GLASS_WORD(look.glass)}</small></span></div>
                        <div className="lk-row"><span><b>Corners</b><small>Cards, pictures and buttons</small></span>
                            <Seg label="Corners" disabled={!canEdit} value={look.corners} options={[['square', 'Square'], ['soft', 'Soft'], ['round', 'Round']]} onChange={v => set({ corners: v })} /></div>
                        <div className="lk-row lk-row-wrap"><span><b>Heading font</b><small>All read Hindi well</small></span>
                            <Seg label="Heading font" fontPreview disabled={!canEdit} value={look.headingFont} options={[['', 'Theme font'], ...CX_FONTS.map(f => [f, f])]} onChange={v => set({ headingFont: v })} /></div>
                        <div className="lk-row"><span><b>Bottom bar</b><small>Floating pill or a classic bar</small></span>
                            <Seg label="Bottom bar" disabled={!canEdit} value={look.nav} options={[['floating', 'Floating'], ['classic', 'Classic']]} onChange={v => set({ nav: v })} /></div>
                    </div>
                    {dirty && canEdit && <p className="lk-unsaved">Not saved yet. Tap <b>Save look</b> to show it to customers.</p>}
                </div>
                <aside className="lk-side">
                    <span className="lk-side-label">Live preview · {pt.name.en}{look.enabled.includes(preview) ? '' : ' (switched off)'}</span>
                    <CxPhone themeKey={preview} look={look} />
                </aside>
            </div>
        </section>
    );
};

export default CxLook;
