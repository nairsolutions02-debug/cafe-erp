import React, { useEffect, useMemo, useState } from 'react';
import { FiUpload, FiSave, FiRotateCcw, FiTrash2 } from 'react-icons/fi';
import { getSettings, saveSettingsBatch, uploadBrandLogo } from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import { BRAND_KEYS, mergeBrand, brandChanged } from '../../lib/brandStore';
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
const Preview = ({ brand }) => (
    <div className="bl-preview" aria-label="Preview">
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

    useEffect(() => {
        getSettings().then(r => {
            const f = Object.fromEntries(Object.entries(BRAND_KEYS).map(([field, key]) => [field, typeof r.data[key] === 'string' ? r.data[key] : '']));
            setForm(f); setSaved(f);
        }).catch(err => setMsg({ type: 'error', text: errorText(err) }));
    }, []);

    const brand = useMemo(() => mergeBrand(form && Object.fromEntries(Object.entries(BRAND_KEYS).map(([field, key]) => [key, form[field]]))), [form]);
    if (!form) return msg ? <p className="error-message">{msg.text}</p> : <Skeleton rows={3} />;
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
        setBusy(true); setMsg(null);
        try {
            const clean = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, String(v || '').trim()]));
            await saveSettingsBatch(Object.fromEntries(Object.entries(BRAND_KEYS).map(([field, key]) => [key, clean[field]])));
            setForm(clean); setSaved(clean);
            brandChanged();
            setMsg({ type: 'ok', text: 'Saved. Phones, laptops, the kiosk and the pickup TV show it the next time they open or refresh.' });
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
                    <p className="muted">Your cafe's name, logo and details, saved once for every phone, laptop, kiosk, pickup TV and bill. Colours, corners and fonts come in the next update.</p>
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
                            <button type="button" className="btn btn-primary" disabled={busy || !dirty} onClick={save}><FiSave /> {busy ? 'Saving…' : 'Save for the whole cafe'}</button>
                            <button type="button" className="btn btn-ghost" disabled={busy || !dirty} onClick={() => { setForm(saved); setMsg(null); }}><FiRotateCcw /> Undo changes</button>
                        </div>
                    )}
                </div>
                <Preview brand={brand} />
            </div>
        </div>
    );
};

export default AdminBrand;
