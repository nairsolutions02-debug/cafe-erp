import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { FiGift, FiInstagram, FiCamera, FiCopy, FiStar } from 'react-icons/fi';
import Header from '../components/Header';
import { useAuth } from '../context/AuthContext';
import { getMyRewards, getPortalConfig, setMyDates, uploadCustomerSelfie, submitInstagramClaim } from '../utils/api';
import './Rewards.css';
import ClubCards from './club/ClubCards';

const errorText = (err) => err?.response?.data?.message || err?.message || 'Something went wrong';
const fill = (text, vars) => String(text || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m));
const day = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '');
const WHEN = { birthday: 'On your birthday', anniversary: 'On your anniversary', instagram: 'When you tag us on Instagram', streak: 'Visit streak' };

// Customer portal: points, progress to the next reward, coupons, Instagram tag, history
const Rewards = () => {
    const { user, isAuthenticated } = useAuth();
    const [cfg, setCfg] = useState(null);
    const [r, setR] = useState(null);
    const [error, setError] = useState('');
    const [ig, setIg] = useState({ open: false, handle: '', kind: 'tag', file: null, preview: '', busy: false });
    const [dates, setDates] = useState({ birthday: '', anniversary: '' });
    const [copied, setCopied] = useState('');
    const fileRef = useRef(null);

    const load = useCallback(async () => {
        try {
            const [c, m] = await Promise.all([getPortalConfig(), getMyRewards()]);
            setCfg(c.data);
            setR(m.data);
            setDates({ birthday: m.data.birthday || '', anniversary: m.data.anniversary || '' });
        } catch (err) { setError(errorText(err)); }
    }, []);
    useEffect(() => { if (isAuthenticated) load(); }, [isAuthenticated, load]);

    if (!isAuthenticated) {
        return (
            <div className="rewards-page">
                <Header title="Rewards" />
                <div className="rw-empty"><FiGift size={48} /><p>Sign in to see your rewards.</p><Link to="/menu" className="btn btn-primary">Order now</Link></div>
            </div>
        );
    }
    if (!r || !cfg) return <div className="rewards-page"><Header title="Rewards" /><p className="rw-pad">{error || 'Loading…'}</p></div>;
    const t = cfg.texts;
    const show = cfg.show;
    const next = r.progress[0];

    const copy = async (code) => {
        try { await navigator.clipboard.writeText(code); } catch { /* old browsers */ }
        setCopied(code);
        setTimeout(() => setCopied(''), 1500);
    };
    const pick = (e) => {
        const f = e.target.files[0];
        if (f) setIg(s => ({ ...s, file: f, preview: URL.createObjectURL(f) }));
    };
    const sendIg = async (e) => {
        e.preventDefault();
        setError('');
        if (!ig.file) { setError('Add a selfie taken at the cafe'); return; }
        setIg(s => ({ ...s, busy: true }));
        try {
            const path = await uploadCustomerSelfie(ig.file, user.tenant?.id, user._id || user.id);
            await submitInstagramClaim(ig.handle, ig.kind, path);
            setIg({ open: false, handle: '', kind: 'tag', file: null, preview: '', busy: false });
            load();
        } catch (err) {
            setError(errorText(err));
            setIg(s => ({ ...s, busy: false }));
        }
    };
    const saveDates = async () => {
        try { await setMyDates(dates.birthday, dates.anniversary); load(); } catch (err) { setError(errorText(err)); }
    };

    return (
        <div className="rewards-page">
            <Header title={t.heading} showCart={false} />
            {error && <p className="error-message rw-pad">{error}</p>}
            <ClubCards />

            {show.points && r.points != null && (
                <section className="rw-hero">
                    <div className="rw-points">{r.points}</div>
                    <div>{fill(t.pointsLabel, { points: r.points })}</div>
                    <small>Worth ₹{Number(r.pointsValue).toLocaleString('en-IN')} on your next order</small>
                    {r.multiplier && <span className="rw-chip">{r.multiplier.x}× points till {day(r.multiplier.until)}</span>}
                </section>
            )}

            {show.progress && next && (
                <section className="rw-card">
                    <p className="rw-big">{fill(t.progress, { left: next.leftLabel, reward: next.reward })}</p>
                    {r.progress.map(p => (
                        <div key={p.rule} className="rw-progress">
                            <div className="rw-bar"><span style={{ width: `${Math.min(100, (Number(p.done) / Number(p.target)) * 100)}%` }} /></div>
                            <small>{p.unit === 'orders' ? `${p.done} of ${p.target} orders` : `₹${Number(p.done).toLocaleString('en-IN')} of ₹${Number(p.target).toLocaleString('en-IN')}`} → {p.reward}</small>
                        </div>
                    ))}
                </section>
            )}

            <section className="rw-card">
                <h3><FiGift /> Your coupons</h3>
                {r.coupons.length === 0 && <p className="muted">{t.noRewards}</p>}
                {r.coupons.map(c => (
                    <div key={c.code} className="rw-coupon">
                        <div><strong>{c.reward}</strong><small>{c.title}{c.expiresAt ? ` · use by ${day(c.expiresAt)}` : ''}</small></div>
                        <button onClick={() => copy(c.code)} aria-label={`Copy ${c.code}`}>{c.code} <FiCopy /> {copied === c.code && 'Copied'}</button>
                    </div>
                ))}
                {r.coupons.length > 0 && <p className="muted small">Enter the code at checkout or show it at the counter.</p>}
            </section>

            {show.instagram && (
                <section className="rw-card">
                    <h3><FiInstagram /> {t.instagram}</h3>
                    {cfg.instagramHandle && <p className="small">Tag <strong>@{cfg.instagramHandle}</strong> in your post or story.</p>}
                    {r.instagram[0]?.status === 'pending' ? <p className="rw-chip">{t.underReview}</p>
                        : !ig.open && <button className="btn btn-secondary" onClick={() => setIg(s => ({ ...s, open: true }))}>I tagged you</button>}
                    {r.instagram.filter(i => i.status !== 'pending').slice(0, 2).map((i, n) => (
                        <p key={n} className="small">@{i.handle}: {i.status === 'approved' ? 'verified ✓' : `not approved — ${i.reason}`}</p>
                    ))}
                    {ig.open && (
                        <form className="rw-ig" onSubmit={sendIg}>
                            <input className="input" placeholder="Your Instagram username" value={ig.handle} required
                                onChange={e => setIg({ ...ig, handle: e.target.value })} aria-label="Instagram username" />
                            <select className="input" value={ig.kind} onChange={e => setIg({ ...ig, kind: e.target.value })} aria-label="What did you do">
                                <option value="tag">I tagged the cafe</option><option value="follow">I followed the cafe</option>
                            </select>
                            <input ref={fileRef} type="file" accept="image/*" capture="user" hidden onChange={pick} />
                            <button type="button" className="rw-selfie" onClick={() => fileRef.current?.click()} aria-label="Selfie at the cafe">
                                {ig.preview ? <img src={ig.preview} alt="Selfie" /> : <><FiCamera /> Selfie at the cafe</>}
                            </button>
                            <p className="muted small">Staff check it within 2 days. The selfie is deleted after 30 days.</p>
                            <button className="btn btn-primary" disabled={ig.busy}>{ig.busy ? 'Sending…' : 'Send for review'}</button>
                        </form>
                    )}
                </section>
            )}

            {show.upcoming && r.upcoming.some(u => u.when !== 'birthday') && (
                <section className="rw-card">
                    <h3>Coming your way</h3>
                    {r.upcoming.filter(u => u.when !== 'birthday').map(u => <p key={u.name} className="small"><strong>{WHEN[u.when] || u.name}</strong>: {u.reward}</p>)}
                    {r.upcoming.some(u => u.when === 'anniversary') && (
                        <div className="rw-dates">
                            <label className="small">Anniversary<input className="input" type="date" value={dates.anniversary} disabled={!!r.anniversary}
                                onChange={e => setDates({ ...dates, anniversary: e.target.value })} /></label>
                            {!r.anniversary && <button className="btn btn-ghost btn-sm" onClick={saveDates}>Save date</button>}
                        </div>
                    )}
                </section>
            )}

            {show.offers && r.offers.length > 0 && (
                <section className="rw-card">
                    <h3>Use your points</h3>
                    {r.offers.map(o => (
                        <p key={o.name} className={`small${o.eligible ? '' : ' muted'}`}>{o.eligible ? '✓ ' : ''}<strong>{o.name}</strong> — {o.pointsRequired} points{o.description ? ` · ${o.description}` : ''}</p>
                    ))}
                </section>
            )}

            {show.feedback && r.unratedOrders.length > 0 && (
                <section className="rw-card">
                    <h3><FiStar /> {t.feedbackAsk}</h3>
                    {r.unratedOrders.map(o => <Link key={o.id} className="rw-link" to={`/order/${o.id}`}>Order {o.orderNumber} · {day(o.createdAt)} →</Link>)}
                </section>
            )}

            <section className="rw-card">
                <h3>History</h3>
                {r.history.length === 0 && <p className="muted small">Nothing yet.</p>}
                {r.history.map((h, i) => (
                    <div key={i} className="rw-hist"><span>{h.title}<small>{day(h.at)}</small></span><strong>{h.reward}{h.used ? ' · used' : ''}</strong></div>
                ))}
            </section>
        </div>
    );
};

export default Rewards;
