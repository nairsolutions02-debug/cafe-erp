import React, { useEffect, useMemo, useState } from 'react';
import { FiUpload, FiSave, FiRotateCcw, FiTrash2 } from 'react-icons/fi';
import { getSettings, saveSettingsBatch, uploadBrandLogo } from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import { BRAND_KEYS, THEME_KEYS, mergeBrand, brandChanged } from '../../lib/brandStore';
import { DEFAULT_THEME, PRESETS, FONTS, CORNERS, isHex, contrast, readable, deeper, themeVars, loadFont, MIN_CONTRAST } from '../../lib/theme';
import defaults from '../../brand';
import Skeleton from '../mobile/Skeleton';
import './Brand.css';

const errorText = (err) => err?.response?.data?.message || err?.message || 'Something went wrong';
const initials = (n) => (String(n || '').trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2) || 'C').toUpperCase();
const LIMITS = { name: 40, tagline: 60, heroText: 140, address: 200, phone: 20, email: 80, instagram: 200, facebook: 200, hoursDays: 40, hoursTime: 40 };

// The logo as the app shows it: the uploaded one, else the Vercel / standard logo, else the initials
const Logo = ({ brand, className }) => {
    const [broken, setBroken] = useState('');
    return (
        <span className={className}>
            {broken !== brand.logo ? <img src={brand.logo} alt="" onError={() => setBroken(brand.logo)} /> : initials(brand.name)}
        </span>
    );
};

// Live preview: the customer app, the staff app header and the printed bill with the values being typed
const Preview = ({ brand, theme }) => (
    <div className={`bl-preview bl-c-${theme.corners}`} aria-label="Preview" style={{ ...themeVars(theme), fontFamily: `'${theme.font}', sans-serif` }}>
        <div className="bl-dev">
            <span className="bl-dev-label">Customer app</span>
            <div className="bl-phone"><div className="bl-screen">
                <div className="bl-cx-top"><Logo brand={brand} className="bl-logo" /><span className="bl-name"><b>{brand.name}</b><small>{brand.tagline}</small></span></div>
                <div className="bl-hero"><small>Table 4</small><b>{brand.heroText}</b></div>
                <div className="bl-items">
                    {[['☕', 'Cappuccino', '₹140'], ['🥪', 'Veg Club Sandwich', '₹190'], ['🍫', 'Walnut Brownie', '₹120']].map(([e, n, p]) => (
                        <div key={n} className="bl-item"><span>{e}</span><b>{n}</b><small>{p}</small></div>
                    ))}
                </div>
                <div className="bl-foot"><b>{brand.name}</b>{brand.address && <span>{brand.address}</span>}{brand.phone && <span>{brand.phone}</span>}
                    {(brand.hoursDays || brand.hoursTime) && <span>{brand.hoursDays} · {brand.hoursTime}</span>}</div>
            </div></div>
        </div>
        <div className="bl-dev">
            <span className="bl-dev-label">Staff app</span>
            <div className="bl-phone"><div className="bl-screen">
                <div className="bl-st-top"><Logo brand={brand} className="bl-logo" /><span className="bl-name"><small>{brand.name}</small><b>Orders</b></span></div>
                <div className="bl-st-card"><b>T4 · Meera S.</b><small>2× Cappuccino</small><span>Confirm table</span></div>
                <div className="bl-st-card"><b>Q7 · Walk-in</b><small>1× Cold Coffee · paid</small><span>Start</span></div>
            </div></div>
            <span className="bl-dev-label">Printed bill</span>
            <div className="bl-bill">
                <Logo brand={brand} className="bl-bill-logo" />
                <b>{brand.name}</b>
                {brand.address && <span>{brand.address}</span>}
                {brand.phone && <span>Ph: {brand.phone}</span>}
                <div className="bl-bill-ln"><span>2 × Cappuccino</span><span>280.00</span></div>
                <div className="bl-bill-ln"><b>Total</b><b>₹294</b></div>
            </div>
        </div>
    </div>
);

// Settings → Brand & look, part 1: the cafe's name, logo and contact details (colours and fonts come next)
const AdminBrand = () => {
    const { hasPerm } = useAuth();
    const canEdit = hasPerm('settings.edit');
    const [form, setForm] = useState(null);
    const [saved, setSaved] = useState(null);
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState(null);

    useEffect(() => { FONTS.forEach(loadFont); }, []);
    useEffect(() => {
        getSettings().then(r => {
            const str = (v) => (typeof v === 'string' ? v : '');
            const f = Object.fromEntries(Object.entries(BRAND_KEYS).map(([field, key]) => [field, str(r.data[key])]));
            const main = str(r.data[THEME_KEYS.main]) || str(r.data.portal_theme);
            f.main = isHex(main) ? main.toUpperCase() : DEFAULT_THEME.main;
            f.accent = isHex(str(r.data[THEME_KEYS.accent])) ? str(r.data[THEME_KEYS.accent]).toUpperCase() : DEFAULT_THEME.accent;
            f.corners = CORNERS.some(([k]) => k === r.data[THEME_KEYS.corners]) ? r.data[THEME_KEYS.corners] : DEFAULT_THEME.corners;
            f.font = FONTS.includes(r.data[THEME_KEYS.font]) ? r.data[THEME_KEYS.font] : DEFAULT_THEME.font;
            setForm(f); setSaved(f);
        }).catch(err => setMsg({ type: 'error', text: errorText(err) }));
    }, []);

    const brand = useMemo(() => mergeBrand(form && Object.fromEntries(Object.entries(BRAND_KEYS).map(([field, key]) => [key, form[field]]))), [form]);
    if (!form) return msg ? <p className="error-message">{msg.text}</p> : <Skeleton rows={3} />;
    const theme = { main: isHex(form.main) ? form.main : DEFAULT_THEME.main, accent: isHex(form.accent) ? form.accent : DEFAULT_THEME.accent, corners: form.corners, font: form.font };
    const okColour = readable(theme.main);
    const ratio = contrast(theme.main, '#ffffff');
    const setTheme = (patch) => { setForm({ ...form, ...patch }); setMsg(null); if (patch.font) loadFont(patch.font); };
    const dirty = JSON.stringify(form) !== JSON.stringify(saved);
    const set = (field) => (e) => { setForm({ ...form, [field]: e.target.value.slice(0, LIMITS[field] || 200) }); setMsg(null); };

    const pickLogo = async (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        if (!file.type.startsWith('image/')) { setMsg({ type: 'error', text: 'Choose a picture (PNG or JPG).' }); return; }
        setBusy(true); setMsg(null);
        try { setForm({ ...form, logo: await uploadBrandLogo(file) }); setMsg({ type: 'info', text: 'Logo uploaded. Press Save to use it everywhere.' }); }
        catch (err) { setMsg({ type: 'error', text: errorText(err) }); }
        finally { setBusy(false); }
    };
    const save = async () => {
        if (!form.name.trim()) { setMsg({ type: 'error', text: 'The cafe needs a name.' }); return; }
        if (!okColour) { setMsg({ type: 'error', text: 'The main colour is too pale to read. Use the deeper shade first.' }); return; }
        setBusy(true); setMsg(null);
        try {
            const clean = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, String(v || '').trim()]));
            await saveSettingsBatch({
                ...Object.fromEntries(Object.entries(BRAND_KEYS).map(([field, key]) => [key, clean[field]])),
                ...Object.fromEntries(Object.entries(THEME_KEYS).map(([field, key]) => [key, clean[field]])),
            });
            setForm(clean); setSaved(clean);
            brandChanged();
            setMsg({ type: 'ok', text: 'Saved. Phones, laptops and the pickup TV show it the next time they open or refresh.' });
        } catch (err) { setMsg({ type: 'error', text: errorText(err) }); }
        finally { setBusy(false); }
    };
    const field = (f, label, props = {}) => (
        <label className="bl-field" htmlFor={`bl-${f}`}>{label}
            {props.rows ? <textarea id={`bl-${f}`} rows={props.rows} value={form[f]} disabled={!canEdit} placeholder={props.placeholder} onChange={set(f)} />
                : <input id={`bl-${f}`} type={props.type || 'text'} value={form[f]} disabled={!canEdit} placeholder={props.placeholder} onChange={set(f)} />}
        </label>
    );

    return (
        <div className="bl">
            <div className="bl-head">
                <div>
                    <h1>Brand &amp; look</h1>
                    <p className="muted">Your cafe's name, logo, colours and font, saved once for every phone, laptop, pickup TV and bill. Status colours (late, cooking, ready, paid) never change.</p>
                </div>
            </div>
            {!canEdit && <p className="bl-msg info">Your role can see this page but not change it.</p>}
            <div className="bl-grid">
                <div className="bl-form">
                    <section className="bl-sec">
                        <h2>Name and logo</h2>
                        <div className="bl-logo-row">
                            <Logo brand={brand} className="bl-logo big" />
                            {canEdit && (
                                <>
                                    <label className="btn btn-ghost bl-file"><FiUpload /> {brand.logoIsCustom ? 'Change logo' : 'Upload logo'}
                                        <input type="file" accept="image/png,image/jpeg,image/webp" onChange={pickLogo} disabled={busy} />
                                    </label>
                                    {form.logo && <button type="button" className="btn btn-ghost" onClick={() => setForm({ ...form, logo: '' })}><FiTrash2 /> Remove</button>}
                                </>
                            )}
                        </div>
                        <p className="bl-hint">Square picture works best; it is shrunk automatically. Without your own logo the app keeps the standard one.</p>
                        {field('name', 'Cafe name', { placeholder: defaults.name })}
                        {field('tagline', 'Short line under the name', { placeholder: defaults.tagline })}
                        {field('heroText', 'Banner text on the customer app', { rows: 2, placeholder: defaults.heroText })}
                    </section>
                    <section className="bl-sec">
                        <h2>Colours</h2>
                        <div className="bl-presets" role="group" aria-label="Colour sets">
                            {PRESETS.map(p => (
                                <button key={p.key} type="button" className="bl-preset" disabled={!canEdit}
                                    aria-pressed={p.main === theme.main && p.accent === theme.accent} onClick={() => setTheme({ main: p.main, accent: p.accent })}>
                                    <span className="bl-dots"><i style={{ background: p.main }} /><i style={{ background: p.accent }} /></span>{p.name}
                                </button>
                            ))}
                        </div>
                        <div className="bl-row2">
                            <label className="bl-picker" htmlFor="bl-main">
                                <input id="bl-main" type="color" value={theme.main} disabled={!canEdit} onChange={e => setTheme({ main: e.target.value.toUpperCase() })} />
                                <span>Main colour<code>{theme.main}</code></span>
                            </label>
                            <label className="bl-picker" htmlFor="bl-accent">
                                <input id="bl-accent" type="color" value={theme.accent} disabled={!canEdit} onChange={e => setTheme({ accent: e.target.value.toUpperCase() })} />
                                <span>Second colour<code>{theme.accent}</code></span>
                            </label>
                        </div>
                        {okColour ? (
                            <p className="bl-check ok">✓ Easy to read: prices, links and button text in this colour score {ratio.toFixed(1)} : 1 (needs {MIN_CONTRAST}).</p>
                        ) : (
                            <div className="bl-check bad">
                                <p><b>Too pale to read.</b> Prices, links and button text in this colour score {ratio.toFixed(1)} : 1; they need {MIN_CONTRAST}. They would almost disappear on a phone in daylight.</p>
                                {canEdit && <button type="button" className="btn btn-primary btn-sm" onClick={() => setTheme({ main: deeper(theme.main) })}>Use a deeper shade ({deeper(theme.main)})</button>}
                            </div>
                        )}
                    </section>
                    <section className="bl-sec">
                        <h2>Look</h2>
                        <div className="bl-field">Corners
                            <span className="bl-seg" role="group" aria-label="Corners">
                                {CORNERS.map(([k, l]) => <button key={k} type="button" disabled={!canEdit} aria-pressed={theme.corners === k} onClick={() => setTheme({ corners: k })}>{l}</button>)}
                            </span>
                        </div>
                        <div className="bl-field">Font (all four read Hindi well)
                            <div className="bl-fonts" role="group" aria-label="Font">
                                {FONTS.map(f => (
                                    <button key={f} type="button" className="bl-font" disabled={!canEdit} aria-pressed={theme.font === f}
                                        style={{ fontFamily: `'${f}', sans-serif` }} onMouseEnter={() => loadFont(f)} onFocus={() => loadFont(f)} onClick={() => setTheme({ font: f })}>
                                        <b>{f}</b><small>मसाला चाय ₹60 · Masala chai</small>
                                    </button>
                                ))}
                            </div>
                        </div>
                        {canEdit && (theme.main !== DEFAULT_THEME.main || theme.accent !== DEFAULT_THEME.accent || theme.corners !== DEFAULT_THEME.corners || theme.font !== DEFAULT_THEME.font) && (
                            <button type="button" className="btn btn-ghost bl-reset" onClick={() => setTheme({ ...DEFAULT_THEME })}>Reset colours and look to the FiKA default</button>
                        )}
                    </section>
                    <section className="bl-sec">
                        <h2>Contact and hours</h2>
                        {field('address', 'Address (printed on bills)', { rows: 2, placeholder: 'Shop no., street, area, city' })}
                        <div className="bl-row2">
                            {field('phone', 'Phone', { type: 'tel', placeholder: '+91 98xxx xxxxx' })}
                            {field('email', 'Email', { type: 'email', placeholder: 'hello@yourcafe.in' })}
                        </div>
                        <div className="bl-row2">
                            {field('hoursDays', 'Open on', { placeholder: 'Mon - Sun' })}
                            {field('hoursTime', 'Hours', { placeholder: '9:00 AM - 10:00 PM' })}
                        </div>
                        <div className="bl-row2">
                            {field('instagram', 'Instagram link', { type: 'url', placeholder: 'https://instagram.com/yourcafe' })}
                            {field('facebook', 'Facebook link', { type: 'url', placeholder: 'https://facebook.com/yourcafe' })}
                        </div>
                        <p className="bl-hint">GSTIN, FSSAI number and the bill footer stay in Cafe settings.</p>
                    </section>
                    {msg && <p className={`bl-msg ${msg.type}`} role="status">{msg.text}</p>}
                    {canEdit && (
                        <div className="bl-actions">
                            <button type="button" className="btn btn-primary" disabled={busy || !dirty || !okColour} onClick={save}><FiSave /> {busy ? 'Saving…' : 'Save for the whole cafe'}</button>
                            <button type="button" className="btn btn-ghost" disabled={busy || !dirty} onClick={() => { setForm(saved); setMsg(null); }}><FiRotateCcw /> Undo changes</button>
                        </div>
                    )}
                </div>
                <Preview brand={brand} theme={theme} />
            </div>
        </div>
    );
};

export default AdminBrand;
