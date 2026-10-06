import React, { useCallback, useEffect, useRef, useState } from 'react';
import { shortOfferList } from '../lib/offerList';
import { Link } from 'react-router-dom';
import { FiGift, FiInstagram, FiCamera, FiCopy, FiStar } from 'react-icons/fi';
import Header from '../components/Header';
import { useAuth } from '../context/AuthContext';
import { getMyRewards, getPortalConfig, setMyDates, uploadCustomerSelfie, submitInstagramClaim } from '../utils/api';
import './Rewards.css';
import ClubCards from './club/ClubCards';
import useCxLang, { T, fill, sayReward } from '../lib/cxLang';

// Owner-editable portal texts: the English defaults (exactly as the server sends them) and their translations.
// A text the owner changed is shown as typed; an untouched default follows the customer's language.
const DEFAULT_EN = {
    heading: 'Your rewards',
    pointsLabel: 'Chai-ching! You have {points} points',
    progress: "You're {left} away from {reward}!",
    noRewards: 'No rewards yet — your first one is brewing ☕',
    pointsAdded: 'Chai-ching! {points} points added',
    instagram: 'Tag us on Instagram, earn a treat',
    underReview: 'Under review — up to 2 days',
    feedbackAsk: 'How was it? Rate each dish',
    feedbackThanks: 'Thank you! The kitchen reads every rating.',
    review: 'Loved it? Tell others on Google',
};
const DEFAULT_TR = {
    hi: {
        heading: 'आपके रिवॉर्ड',
        pointsLabel: 'चाय-चिंग! आपके पास {points} पॉइंट हैं',
        progress: '{reward} से बस {left} दूर!',
        noRewards: 'अभी कोई रिवॉर्ड नहीं — पहला बन रहा है ☕',
        pointsAdded: 'चाय-चिंग! {points} पॉइंट जुड़ गए',
        instagram: 'Instagram पर हमें टैग करें, ट्रीट पाएँ',
        underReview: 'जाँच चल रही है — 2 दिन तक',
        feedbackAsk: 'कैसा लगा? हर डिश को रेटिंग दें',
        feedbackThanks: 'धन्यवाद! किचन हर रेटिंग पढ़ता है।',
        review: 'पसंद आया? Google पर बताइए',
    },
    hg: {
        heading: 'Aapke rewards',
        pointsLabel: 'Chai-ching! Aapke paas {points} points hain',
        progress: '{reward} se bas {left} door!',
        noRewards: 'Abhi koi reward nahi — pehla ban raha hai ☕',
        pointsAdded: 'Chai-ching! {points} points jud gaye',
        instagram: 'Instagram pe humein tag karo, treat pao',
        underReview: 'Check ho raha hai — 2 din tak',
        feedbackAsk: 'Kaisa laga? Har dish ko rating do',
        feedbackThanks: 'Thank you! Kitchen har rating padhta hai.',
        review: 'Pasand aaya? Google pe batao',
    },
};

const W = {
    rewards: T('Rewards', 'रिवॉर्ड', 'Rewards'),
    somethingWrong: T('Something went wrong', 'कुछ गड़बड़ हो गई', 'Kuch gadbad ho gayi'),
    signIn: T('Sign in to see your rewards.', 'अपने रिवॉर्ड देखने के लिए लॉग इन करें।', 'Apne rewards dekhne ke liye login karo.'),
    orderNow: T('Order now', 'अभी ऑर्डर करें', 'Abhi order karo'),
    loading: T('Loading…', 'लोड हो रहा है…', 'Load ho raha hai…'),
    worth: T('Worth ₹{amount} on your next order', 'अगले ऑर्डर पर ₹{amount} की छूट', 'Agle order pe ₹{amount} ki chhoot'),
    multiplier: T('{x}× points till {until}', '{until} तक {x}× पॉइंट', '{until} tak {x}× points'),
    ordersOf: T('{done} of {target} orders', '{target} में से {done} ऑर्डर', '{target} mein se {done} orders'),
    rupeesOf: T('₹{done} of ₹{target}', '₹{target} में से ₹{done}', '₹{target} mein se ₹{done}'),
    leftOrders: T('{n} more orders', '{n} और ऑर्डर', '{n} aur orders'),
    leftOrder: T('1 more order', '1 और ऑर्डर', '1 aur order'),
    leftRupees: T('₹{n} more', '₹{n} और', '₹{n} aur'),
    coupons: T('Your coupons', 'आपके कूपन', 'Aapke coupons'),
    useBy: T(' · use by {date}', ' · {date} तक इस्तेमाल करें', ' · {date} tak use karo'),
    copy: T('Copy {code}', '{code} कॉपी करें', '{code} copy karo'),
    copied: T('Copied', 'कॉपी हो गया', 'Copy ho gaya'),
    enterCode: T('Enter the code at checkout or show it at the counter.', 'चेकआउट पर कोड डालें या काउंटर पर दिखाएँ।', 'Checkout pe code daalo ya counter pe dikhao.'),
    tagPre: T('Tag ', 'अपनी पोस्ट या स्टोरी में ', 'Apni post ya story mein '),
    tagPost: T(' in your post or story.', ' को टैग करें।', ' ko tag karo.'),
    tagged: T('I tagged you', 'मैंने टैग कर दिया', 'Maine tag kar diya'),
    verified: T('verified ✓', 'पक्का हो गया ✓', 'verify ho gaya ✓'),
    notApproved: T('not approved — {reason}', 'मंज़ूर नहीं — {reason}', 'approve nahi hua — {reason}'),
    igUser: T('Your Instagram username', 'आपका Instagram यूज़रनेम', 'Aapka Instagram username'),
    igUserLabel: T('Instagram username', 'Instagram यूज़रनेम', 'Instagram username'),
    whatDid: T('What did you do', 'आपने क्या किया', 'Aapne kya kiya'),
    didTag: T('I tagged the cafe', 'मैंने कैफ़े को टैग किया', 'Maine cafe ko tag kiya'),
    didFollow: T('I followed the cafe', 'मैंने कैफ़े को फ़ॉलो किया', 'Maine cafe ko follow kiya'),
    selfie: T('Selfie at the cafe', 'कैफ़े में सेल्फ़ी', 'Cafe mein selfie'),
    selfieAlt: T('Selfie', 'सेल्फ़ी', 'Selfie'),
    addSelfie: T('Add a selfie taken at the cafe', 'कैफ़े में ली गई सेल्फ़ी जोड़ें', 'Cafe mein li hui selfie daalo'),
    staffCheck: T('Staff check it within 2 days. The selfie is deleted after 30 days.', 'स्टाफ़ 2 दिन में जाँच लेगा। सेल्फ़ी 30 दिन बाद हटा दी जाती है।', 'Staff 2 din mein check karega. Selfie 30 din baad delete ho jaati hai.'),
    sending: T('Sending…', 'भेज रहे हैं…', 'Bhej rahe hain…'),
    sendReview: T('Send for review', 'जाँच के लिए भेजें', 'Check ke liye bhejo'),
    coming: T('Coming your way', 'आपके लिए आने वाले', 'Aapke liye aane wale'),
    anniversary: T('Anniversary', 'सालगिरह', 'Anniversary'),
    saveDate: T('Save date', 'तारीख़ सेव करें', 'Date save karo'),
    usePoints: T('Use your points', 'अपने पॉइंट इस्तेमाल करें', 'Apne points use karo'),
    points: T('{n} points', '{n} पॉइंट', '{n} points'),
    seeAll: T('See all {n} rewards', 'सभी {n} रिवॉर्ड देखें', 'Saare {n} rewards dekho'),
    orderLink: T('Order {no} · {date} →', 'ऑर्डर {no} · {date} →', 'Order {no} · {date} →'),
    history: T('History', 'पिछले रिवॉर्ड', 'Pichhle rewards'),
    nothingYet: T('Nothing yet.', 'अभी कुछ नहीं।', 'Abhi kuch nahi.'),
    used: T(' · used', ' · इस्तेमाल हो गया', ' · use ho gaya'),
};
const WHEN = {
    birthday: T('On your birthday', 'आपके जन्मदिन पर', 'Aapke birthday pe'),
    anniversary: T('On your anniversary', 'आपकी सालगिरह पर', 'Aapki anniversary pe'),
    instagram: T('When you tag us on Instagram', 'जब आप हमें Instagram पर टैग करें', 'Jab aap humein Instagram pe tag karo'),
    streak: T('Visit streak', 'लगातार आने पर', 'Lagataar aane pe'),
};

const errorText = (err, t) => err?.response?.data?.message || err?.message || t(W.somethingWrong);
const day = (d, lang) => (d ? new Date(d).toLocaleDateString(lang === 'hi' ? 'hi-IN' : 'en-IN', { day: 'numeric', month: 'short' }) : '');

// Customer portal: points, progress to the next reward, coupons, Instagram tag, history
const Rewards = () => {
    const { lang, t } = useCxLang();
    const { user, isAuthenticated } = useAuth();
    const [cfg, setCfg] = useState(null);
    const [r, setR] = useState(null);
    const [allOffers, setAllOffers] = useState(false);
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
        } catch (err) { setError(errorText(err, t)); }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- t only picks the fallback error text
    }, []);
    useEffect(() => { if (isAuthenticated) load(); }, [isAuthenticated, load]);

    if (!isAuthenticated) {
        return (
            <div className="rewards-page">
                <Header title={t(W.rewards)} />
                <div className="rw-empty"><FiGift size={48} /><p>{t(W.signIn)}</p><Link to="/menu" className="btn btn-primary">{t(W.orderNow)}</Link></div>
            </div>
        );
    }
    if (!r || !cfg) return <div className="rewards-page"><Header title={t(W.rewards)} /><p className="rw-pad">{error || t(W.loading)}</p></div>;
    // Owner's text, or the translated default when the owner kept the default
    const tx = (k) => {
        const own = cfg.texts?.[k];
        if (lang !== 'en' && (own == null || own === DEFAULT_EN[k])) return DEFAULT_TR[lang]?.[k] ?? own ?? DEFAULT_EN[k];
        return own ?? DEFAULT_EN[k];
    };
    const leftText = (p) => {
        const n = Number(p.left);
        if (p.left == null || Number.isNaN(n)) return p.leftLabel;
        if (p.unit === 'orders') return n === 1 ? t(W.leftOrder) : t(W.leftOrders, { n });
        return t(W.leftRupees, { n: n.toLocaleString('en-IN') });
    };
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
        if (!ig.file) { setError(t(W.addSelfie)); return; }
        setIg(s => ({ ...s, busy: true }));
        try {
            const path = await uploadCustomerSelfie(ig.file, user.tenant?.id, user._id || user.id);
            await submitInstagramClaim(ig.handle, ig.kind, path);
            setIg({ open: false, handle: '', kind: 'tag', file: null, preview: '', busy: false });
            load();
        } catch (err) {
            setError(errorText(err, t));
            setIg(s => ({ ...s, busy: false }));
        }
    };
    const saveDates = async () => {
        try { await setMyDates(dates.birthday, dates.anniversary); load(); } catch (err) { setError(errorText(err, t)); }
    };

    return (
        <div className="rewards-page">
            <Header title={tx('heading')} showCart={false} />
            {error && <p className="error-message rw-pad">{error}</p>}
            <ClubCards />

            {show.points && r.points != null && (
                <section className="rw-hero">
                    <div className="rw-points">{r.points}</div>
                    <div>{fill(tx('pointsLabel'), { points: r.points })}</div>
                    <small>{t(W.worth, { amount: Number(r.pointsValue).toLocaleString('en-IN') })}</small>
                    {r.multiplier && <span className="rw-chip">{t(W.multiplier, { x: r.multiplier.x, until: day(r.multiplier.until, lang) })}</span>}
                </section>
            )}

            {show.progress && next && (
                <section className="rw-card">
                    <p className="rw-big">{fill(tx('progress'), { left: leftText(next), reward: sayReward(next.reward, lang) })}</p>
                    {r.progress.map(p => (
                        <div key={p.rule} className="rw-progress">
                            <div className="rw-bar"><span style={{ width: `${Math.min(100, (Number(p.done) / Number(p.target)) * 100)}%` }} /></div>
                            <small>{p.unit === 'orders' ? t(W.ordersOf, { done: p.done, target: p.target }) : t(W.rupeesOf, { done: Number(p.done).toLocaleString('en-IN'), target: Number(p.target).toLocaleString('en-IN') })} → {sayReward(p.reward, lang)}</small>
                        </div>
                    ))}
                </section>
            )}

            <section className="rw-card">
                <h3><FiGift /> {t(W.coupons)}</h3>
                {r.coupons.length === 0 && <p className="muted">{tx('noRewards')}</p>}
                {r.coupons.map(c => (
                    <div key={c.code} className="rw-coupon">
                        <div><strong>{sayReward(c.reward, lang)}</strong><small>{c.title}{c.expiresAt ? t(W.useBy, { date: day(c.expiresAt, lang) }) : ''}</small></div>
                        <button onClick={() => copy(c.code)} aria-label={t(W.copy, { code: c.code })}>{c.code} <FiCopy /> {copied === c.code && t(W.copied)}</button>
                    </div>
                ))}
                {r.coupons.length > 0 && <p className="muted small">{t(W.enterCode)}</p>}
            </section>

            {show.instagram && (
                <section className="rw-card">
                    <h3><FiInstagram /> {tx('instagram')}</h3>
                    {cfg.instagramHandle && <p className="small">{t(W.tagPre)}<strong>@{cfg.instagramHandle}</strong>{t(W.tagPost)}</p>}
                    {r.instagram[0]?.status === 'pending' ? <p className="rw-chip">{tx('underReview')}</p>
                        : !ig.open && <button className="btn btn-secondary" onClick={() => setIg(s => ({ ...s, open: true }))}>{t(W.tagged)}</button>}
                    {r.instagram.filter(i => i.status !== 'pending').slice(0, 2).map((i, n) => (
                        <p key={n} className="small">@{i.handle}: {i.status === 'approved' ? t(W.verified) : t(W.notApproved, { reason: i.reason })}</p>
                    ))}
                    {ig.open && (
                        <form className="rw-ig" onSubmit={sendIg}>
                            <input className="input" placeholder={t(W.igUser)} value={ig.handle} required
                                onChange={e => setIg({ ...ig, handle: e.target.value })} aria-label={t(W.igUserLabel)} />
                            <select className="input" value={ig.kind} onChange={e => setIg({ ...ig, kind: e.target.value })} aria-label={t(W.whatDid)}>
                                <option value="tag">{t(W.didTag)}</option><option value="follow">{t(W.didFollow)}</option>
                            </select>
                            <input ref={fileRef} type="file" accept="image/*" capture="user" hidden onChange={pick} />
                            <button type="button" className="rw-selfie" onClick={() => fileRef.current?.click()} aria-label={t(W.selfie)}>
                                {ig.preview ? <img src={ig.preview} alt={t(W.selfieAlt)} /> : <><FiCamera /> {t(W.selfie)}</>}
                            </button>
                            <p className="muted small">{t(W.staffCheck)}</p>
                            <button className="btn btn-primary" disabled={ig.busy}>{ig.busy ? t(W.sending) : t(W.sendReview)}</button>
                        </form>
                    )}
                </section>
            )}

            {show.upcoming && r.upcoming.some(u => u.when !== 'birthday') && (
                <section className="rw-card">
                    <h3>{t(W.coming)}</h3>
                    {r.upcoming.filter(u => u.when !== 'birthday').map(u => <p key={u.name} className="small"><strong>{WHEN[u.when] ? t(WHEN[u.when]) : u.name}</strong>: {sayReward(u.reward, lang)}</p>)}
                    {r.upcoming.some(u => u.when === 'anniversary') && (
                        <div className="rw-dates">
                            <label className="small">{t(W.anniversary)}<input className="input" type="date" value={dates.anniversary} disabled={!!r.anniversary}
                                onChange={e => setDates({ ...dates, anniversary: e.target.value })} /></label>
                            {!r.anniversary && <button className="btn btn-ghost btn-sm" onClick={saveDates}>{t(W.saveDate)}</button>}
                        </div>
                    )}
                </section>
            )}

            {show.offers && r.offers.length > 0 && (
                <section className="rw-card">
                    <h3>{t(W.usePoints)}</h3>
                    {(() => {
                        const { list, hidden } = shortOfferList(r.offers, { showAll: allOffers });
                        return (
                            <>
                                {list.map((o, i) => (
                                    <p key={o.id || `${o.name}-${o.pointsRequired}-${i}`} className={`small${o.eligible ? '' : ' muted'}`}>{o.eligible ? '✓ ' : ''}<strong>{o.name}</strong> — {t(W.points, { n: o.pointsRequired })}{o.description ? ` · ${o.description}` : ''}</p>
                                ))}
                                {hidden > 0 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAllOffers(true)}>{t(W.seeAll, { n: list.length + hidden })}</button>}
                            </>
                        );
                    })()}
                </section>
            )}

            {show.feedback && r.unratedOrders.length > 0 && (
                <section className="rw-card">
                    <h3><FiStar /> {tx('feedbackAsk')}</h3>
                    {r.unratedOrders.map(o => <Link key={o.id} className="rw-link" to={`/order/${o.id}`}>{t(W.orderLink, { no: o.orderNumber, date: day(o.createdAt, lang) })}</Link>)}
                </section>
            )}

            <section className="rw-card">
                <h3>{t(W.history)}</h3>
                {r.history.length === 0 && <p className="muted small">{t(W.nothingYet)}</p>}
                {r.history.map((h, i) => (
                    <div key={i} className="rw-hist"><span>{h.title}<small>{day(h.at, lang)}</small></span><strong>{sayReward(h.reward, lang)}{h.used ? t(W.used) : ''}</strong></div>
                ))}
            </section>
        </div>
    );
};

export default Rewards;
