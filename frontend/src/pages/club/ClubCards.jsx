import React, { useCallback, useEffect, useState } from 'react';
import { FiCopy, FiLock, FiCheck } from 'react-icons/fi';
import { getMyClub, setMyBirthday, requestBirthdayChange, requestClubJoin } from '../../utils/api';
import './Club.css';
import useCxLang, { T, sayReward } from '../../lib/cxLang';

const W = {
    error: T('Something went wrong', 'कुछ गड़बड़ हो गई', 'Kuch gadbad ho gayi'),
    day: T('Day', 'दिन', 'Din'), month: T('Month', 'महीना', 'Mahina'),
    tier: T('{month} tier', '{month} का लेवल', '{month} level'),
    resets: T('↻ resets in {n} days', '↻ {n} दिन में नया महीना', '↻ {n} din mein naya mahina'),
    resets1: T('↻ resets tomorrow', '↻ कल से नया महीना', '↻ kal se naya mahina'),
    paidThisMonth: T('paid orders this month', 'पेमेंट वाले ऑर्डर इस महीने', 'paid order is mahine'),
    paidThisMonth1: T('paid order this month', 'पेमेंट वाला ऑर्डर इस महीने', 'paid order is mahine'),
    moreFor: T('{n} more orders this month for', 'इस महीने {n} और ऑर्डर, फिर', 'Is mahine {n} aur order, phir'),
    moreFor1: T('1 more order this month for', 'इस महीने 1 और ऑर्डर, फिर', 'Is mahine 1 aur order, phir'),
    topTier: T('Top tier this month. Thank you!', 'इस महीने सबसे ऊँचा लेवल। धन्यवाद!', 'Is mahine sabse upar wala level. Thank you!'),
    xPoints: T('{n}× points', '{n}× पॉइंट', '{n}× points'),
    pctOff: T('{n}% off every order', 'हर ऑर्डर पर {n}% छूट', 'Har order pe {n}% off'),
    kept: T('Kept from last month', 'पिछले महीने से बना हुआ', 'Pichhle mahine se bana hua'),
    milestones: T("This month's milestones", 'इस महीने के इनाम', 'Is mahine ke inaam'),
    nextMs: T('Your {nth} order this month:', 'इस महीने आपका {n}वाँ ऑर्डर:', 'Is mahine aapka {n}va order:'),
    toGo: T('({n} to go)', '({n} बाकी)', '({n} baaki)'),
    allDone: T("All of this month's milestones done!", 'इस महीने के सारे इनाम मिल गए!', 'Is mahine ke saare inaam mil gaye!'),
    minCount: T('Orders of ₹{n} or more count.', '₹{n} या उससे ज़्यादा के ऑर्डर गिने जाते हैं।', '₹{n} ya usse zyada ke order gine jaate hain.'),
    lastMonth: T(' Last month you reached {tier}.', ' पिछले महीने आप {tier} तक पहुँचे।', ' Pichhle mahine aap {tier} tak pahunche.'),
    club: T('Members Club', 'मेंबर्स क्लब', 'Members Club'),
    notYet: T('Not a Club level yet', 'अभी क्लब लेवल नहीं', 'Abhi Club level nahi'),
    member: T('Member {code} · till {date}', 'मेंबर {code} · {date} तक', 'Member {code} · {date} tak'),
    grace: T(' (grace days, renew at the counter)', ' (छूट के दिन, काउंटर पर रिन्यू करें)', ' (grace days, counter pe renew karo)'),
    yearOrders: T('orders in the last 12 months', 'ऑर्डर पिछले 12 महीनों में', 'order pichhle 12 mahino mein'),
    toLevel: T('{n} to {name}', '{name} तक {n} बाकी', '{name} tak {n} baaki'),
    topLevel: T('Top level', 'सबसे ऊँचा लेवल', 'Top level'),
    perMonth: T('Orders per month, last 12 months', 'पिछले 12 महीनों में हर महीने के ऑर्डर', 'Pichhle 12 mahino ke har mahine ke order'),
    nOrders: T('{n} orders', '{n} ऑर्डर', '{n} order'),
    dropsOut: T('{month} ({n} orders) drops out on the 1st as a new month starts.', 'नया महीना शुरू होते ही 1 तारीख़ को {month} ({n} ऑर्डर) गिनती से हट जाएगा।', 'Naya mahina shuru hote hi 1 tareekh ko {month} ({n} order) ginti se hat jayega.'),
    levelLine: T('{n} orders · ₹{price}/{per}', '{n} ऑर्डर · ₹{price}/{per}', '{n} order · ₹{price}/{per}'),
    perMonthWord: T('month', 'महीना', 'mahina'), perMonthsWord: T('{n} months', '{n} महीने', '{n} mahine'),
    offMax: T('{pct}% off (max ₹{cap})', '{pct}% छूट (ज़्यादा से ज़्यादा ₹{cap})', '{pct}% off (max ₹{cap})'),
    requested: T('Request sent for {level}. Pay ₹{price} at the counter and staff will switch it on.', '{level} के लिए रिक्वेस्ट भेज दी। काउंटर पर ₹{price} दें, स्टाफ़ चालू कर देगा।', '{level} ke liye request bhej di. Counter pe ₹{price} do, staff chalu kar dega.'),
    join: T('Join {name}: ₹{price}', '{name} जॉइन करें: ₹{price}', '{name} join karo: ₹{price}'),
    birthday: T('Birthday', 'जन्मदिन', 'Birthday'),
    happy: T('Happy birthday', 'जन्मदिन मुबारक', 'Happy birthday'),
    useBy: T('use by {date}', '{date} तक इस्तेमाल करें', '{date} tak use karo'),
    copyCode: T('Copy {code}', '{code} कॉपी करें', '{code} copy karo'), copied: T('Copied', 'कॉपी हो गया', 'Copy ho gaya'),
    surprise: T('🎁 Get a surprise on your birthday', '🎁 जन्मदिन पर सरप्राइज़ पाइए', '🎁 Birthday pe surprise pao'),
    once: T('You can set this once.', 'यह सिर्फ़ एक बार सेट होता है।', 'Yeh sirf ek baar set hota hai.'),
    save: T('Save my birthday', 'मेरा जन्मदिन सेव करें', 'Mera birthday save karo'),
    locked: T('Locked', 'लॉक', 'Locked'),
    opensOn: T('Your gift opens on {date}', 'आपका गिफ़्ट {date} को खुलेगा', 'Aapka gift {date} ko khulega'),
    inDays: T(' (in {n} days)', ' ({n} दिन में)', ' ({n} din mein)'),
    changeAsked: T('Change to {to} requested. Staff may ask to see an ID at the counter.', '{to} में बदलने की रिक्वेस्ट भेजी। काउंटर पर स्टाफ़ ID देख सकता है।', '{to} mein badalne ki request bheji. Counter pe staff ID dekh sakta hai.'),
    notApproved: T('Your change request was not approved', 'आपकी बदलने की रिक्वेस्ट मंज़ूर नहीं हुई', 'Aapki badalne ki request approve nahi hui'),
    updated: T('Your birthday was updated.', 'आपका जन्मदिन बदल दिया गया।', 'Aapka birthday update ho gaya.'),
    wrongDate: T('Wrong date? Ask the cafe to fix it', 'तारीख़ गलत है? कैफ़े से ठीक करवाएँ', 'Date galat hai? Cafe se theek karwao'),
    reason: T('Reason', 'वजह', 'Reason'), reasonPh: T('e.g. I picked the wrong day', 'जैसे: गलत दिन चुन लिया था', 'Jaise: galat din chun liya tha'),
    idNote: T('Staff may ask to see an ID. One change per year.', 'स्टाफ़ ID देख सकता है। साल में एक बार बदल सकते हैं।', 'Staff ID dekh sakta hai. Saal mein ek baar badal sakte ho.'),
    cancel: T('Cancel', 'रद्द करें', 'Cancel'), send: T('Send request', 'रिक्वेस्ट भेजें', 'Request bhejo'),
};

const errorText = (err, t) => err?.response?.data?.message || err?.message || t(W.error);
const monthNames = (lang) => Array.from({ length: 12 }, (_, i) => new Date(2000, i, 1).toLocaleString(lang === 'hi' ? 'hi-IN' : 'en-IN', { month: 'long' }));
const shade = (hex, f) => {
    const n = parseInt(String(hex || '#888888').slice(1), 16);
    const c = (v) => Math.max(0, Math.min(255, Math.round(v * f)));
    return `rgb(${c(n >> 16)}, ${c((n >> 8) & 255)}, ${c(n & 255)})`;
};
const ord = (n) => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');
const dayMonth = (d, lang) => (d ? new Date(d).toLocaleDateString(lang === 'hi' ? 'hi-IN' : 'en-IN', { day: 'numeric', month: 'short' }) : '');

const DatePick = ({ value, onChange, idPrefix }) => {
    const { lang, t } = useCxLang();
    return (
        <div className="cl-dob">
            <label htmlFor={`${idPrefix}-d`}>{t(W.day)}
                <select id={`${idPrefix}-d`} value={value.day} onChange={e => onChange({ ...value, day: e.target.value })}>
                    <option value="">{t(W.day)}</option>{Array.from({ length: 31 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}
                </select></label>
            <label htmlFor={`${idPrefix}-m`}>{t(W.month)}
                <select id={`${idPrefix}-m`} value={value.month} onChange={e => onChange({ ...value, month: e.target.value })}>
                    <option value="">{t(W.month)}</option>{monthNames(lang).map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                </select></label>
        </div>
    );
};

// Monthly tier, this month's milestones, Club level (12 months) and birthday, for the customer Rewards page
const ClubCards = () => {
    const { lang, t } = useCxLang();
    const [c, setC] = useState(null);
    const [error, setError] = useState('');
    const [bday, setBday] = useState({ day: '', month: '' });
    const [change, setChange] = useState({ open: false, day: '', month: '', reason: '' });
    const [copied, setCopied] = useState(false);
    const [busy, setBusy] = useState(false);

    // eslint-disable-next-line react-hooks/exhaustive-deps -- t changes every render; the fallback text is fine from the first one
    const load = useCallback(() => getMyClub().then(r => setC(r.data)).catch(err => setError(errorText(err, t))), []);
    useEffect(() => { load(); }, [load]);
    // Not loaded (or the club isn't set up on this database yet): show nothing rather than an error
    if (!c) return null;

    const m = c.month;
    const tier = m.tier || {};
    const next = m.next;
    const pct = next ? Math.min(100, Math.round(((m.orders - tier.orders) / (next.orders - tier.orders)) * 100)) : 100;
    const club = c.club;
    const goal = club.next ? club.next.orders : club.level ? club.level.orders : 1;
    const maxBar = Math.max(1, ...club.series.map(s => s.orders));
    const b = c.birthday;

    const act = async (fn) => {
        setBusy(true); setError('');
        try { await fn(); await load(); } catch (err) { setError(errorText(err, t)); } finally { setBusy(false); }
    };
    const copy = async (code) => {
        try { await navigator.clipboard.writeText(code); } catch { /* old browsers */ }
        setCopied(true); setTimeout(() => setCopied(false), 1500);
    };

    return (
        <div className="cl">
            {error && <p className="error-message">{error}</p>}

            {/* This month */}
            <section className="cl-tier" style={{ background: `linear-gradient(135deg, ${shade(tier.color, 1.15)}, ${shade(tier.color, 0.62)})` }}>
                <div className="cl-tier-top"><span className="cl-kicker">{t(W.tier, { month: lang === 'hi' ? new Date().toLocaleString('hi-IN', { month: 'long' }) : m.label })}</span><span className="cl-reset">{m.daysLeft === 1 ? t(W.resets1) : t(W.resets, { n: m.daysLeft })}</span></div>
                <p className="cl-tier-name">{tier.name}</p>
                <p className="cl-count"><b>{m.orders}</b> {t(m.orders === 1 ? W.paidThisMonth1 : W.paidThisMonth)}</p>
                <div className="cl-bar"><i style={{ width: `${pct}%` }} /></div>
                <p className="cl-next">{next ? <>{next.orders - m.orders === 1 ? t(W.moreFor1) : t(W.moreFor, { n: next.orders - m.orders })} <b>{next.name}</b></> : t(W.topTier)}</p>
                <div className="cl-perks">
                    {Number(tier.multiplier) > 1 && <span>{t(W.xPoints, { n: tier.multiplier })}</span>}
                    {Number(tier.pct) > 0 && <span>{t(W.pctOff, { n: tier.pct })}</span>}
                    {tier.perks && <span>{tier.perks}</span>}
                    {tier.carried && <span>{t(W.kept)}</span>}
                </div>
            </section>

            {m.milestones.length > 0 && (
                <section className="cl-card">
                    <p className="cl-title">{t(W.milestones)}</p>
                    <div className="cl-ms" style={{ gridTemplateColumns: `repeat(${m.milestones.length}, 1fr)` }}>
                        {m.milestones.map(x => {
                            const nextMs = m.milestones.find(y => !y.done && y.n > m.orders);
                            return (
                                <div key={x.n} className={x.done ? 'done' : nextMs && nextMs.n === x.n ? 'next' : ''}>
                                    <span className="cl-dot">{x.done ? <FiCheck /> : x.n}</span>
                                    <small>{sayReward(x.reward, lang)}</small>
                                </div>
                            );
                        })}
                    </div>
                    {(() => { const n = m.milestones.find(y => !y.done && y.n > m.orders); return n
                        ? <p className="cl-small">{t(W.nextMs, { nth: ord(n.n), n: n.n })} <b>{sayReward(n.reward, lang)}</b> {t(W.toGo, { n: n.n - m.orders })}</p>
                        : <p className="cl-small">{t(W.allDone)}</p>; })()}
                    <p className="cl-small muted">{t(W.minCount, { n: m.minOrderValue })}{m.lastMonth?.orders > 0 ? t(W.lastMonth, { tier: m.lastMonth.tier }) : ''}</p>
                </section>
            )}

            {/* Club level, last 12 months */}
            {club.on && (
                <section className="cl-club">
                    <span className="cl-shine" aria-hidden="true" />
                    <p className="cl-kicker gold">{t(W.club)}</p>
                    <p className="cl-club-name">{club.member ? club.member.level : club.level ? club.level.name : t(W.notYet)}</p>
                    {club.member && <p className="cl-small light">{t(W.member, { code: club.member.code, date: dayMonth(club.member.endsOn, lang) })}{club.member.inGrace ? t(W.grace) : ''}</p>}
                    <div className="cl-year">
                        <span><b>{club.yearOrders}</b> {t(W.yearOrders)}</span>
                        {club.next ? <span className="cl-pill">{t(W.toLevel, { n: club.next.orders - club.yearOrders, name: club.next.name })}</span> : <span className="cl-pill">{t(W.topLevel)}</span>}
                    </div>
                    <div className="cl-bar gold"><i style={{ width: `${Math.min(100, Math.round((club.yearOrders / goal) * 100))}%` }} /></div>
                    <div className="cl-bars" role="img" aria-label={t(W.perMonth)}>
                        {club.series.map((s, i) => (
                            <div key={s.start}><i className={i === 0 ? 'old' : i === club.series.length - 1 ? 'now' : ''} style={{ height: `${Math.round((s.orders / maxBar) * 56) + 3}px` }} title={t(W.nOrders, { n: s.orders })} /><span>{s.month[0]}</span></div>
                        ))}
                    </div>
                    <p className="cl-small light">{t(W.dropsOut, { month: club.series[0]?.month, n: club.series[0]?.orders })}</p>
                    <div className="cl-levels">
                        {club.levels.map((l, i) => (
                            <div key={l.name} className={club.level && club.level.index === i ? 'cur' : club.yearOrders >= l.orders ? 'got' : ''}>
                                <span>{l.name}</span><span>{t(W.levelLine, { n: l.orders, price: l.price, per: l.months === 1 ? t(W.perMonthWord) : t(W.perMonthsWord, { n: l.months }) })}</span>
                                <small>{[l.pct > 0 && t(W.offMax, { pct: l.pct, cap: l.cap }), l.multiplier > 1 && t(W.xPoints, { n: l.multiplier }), l.perks].filter(Boolean).join(' · ')}</small>
                            </div>
                        ))}
                    </div>
                    {club.level && (!club.member || club.member.inGrace) && (club.request
                        ? <p className="cl-wait">{t(W.requested, { level: club.request.level, price: club.request.price })}</p>
                        : <button className="cl-join" disabled={busy} onClick={() => act(() => requestClubJoin())}>{t(W.join, { name: club.level.name, price: club.level.price })}</button>)}
                </section>
            )}

            {/* Birthday */}
            <section className="cl-card cl-bday">
                <p className="cl-title">{t(W.birthday)}</p>
                {b.gift && !b.gift.used && new Date(b.gift.expiresAt) > new Date() && (
                    <div className="cl-gift">
                        <span className="cl-cake" aria-hidden="true">🎂</span>
                        <div><b>{t(W.happy)}{c.name ? `, ${c.name.split(' ')[0]}` : ''}!</b><small>{sayReward(b.gift.reward, lang)} · {t(W.useBy, { date: dayMonth(b.gift.expiresAt, lang) })}</small></div>
                        {b.gift.code && <button onClick={() => copy(b.gift.code)} aria-label={t(W.copyCode, { code: b.gift.code })}>{b.gift.code} <FiCopy /> {copied && t(W.copied)}</button>}
                    </div>
                )}
                {!b.day ? (
                    <div className="cl-ask">
                        <p><b>{t(W.surprise)}</b>{b.giftLabel ? `: ${sayReward(b.giftLabel, lang)}` : ''}</p>
                        <DatePick value={bday} onChange={setBday} idPrefix="cl-b" />
                        <p className="cl-small muted"><FiLock /> {t(W.once)}</p>
                        <button className="btn btn-primary" disabled={busy || !bday.day || !bday.month} onClick={() => act(() => setMyBirthday(bday.day, bday.month))}>{t(W.save)}</button>
                    </div>
                ) : (
                    <>
                        <div className="cl-locked"><b>{b.label}</b><span><FiLock /> {t(W.locked)}</span></div>
                        {b.window && !b.window.open && <p className="cl-small">{t(W.opensOn, { date: dayMonth(b.window.from, lang) })}{b.window.inDays != null ? t(W.inDays, { n: b.window.inDays }) : ''}.</p>}
                        {b.blocked && b.blocked !== 'Birthday gift already given this year' && b.blocked !== 'No birthday saved' && <p className="cl-small muted">{b.blocked}.</p>}
                        {b.request?.status === 'open' && <p className="cl-wait">{t(W.changeAsked, { to: b.request.to })}</p>}
                        {b.request?.status === 'rejected' && <p className="cl-small">{t(W.notApproved)}{b.request.note ? `: ${b.request.note}` : ''}.</p>}
                        {b.request?.status === 'approved' && <p className="cl-small">{t(W.updated)}</p>}
                        {b.request?.status !== 'open' && (!change.open
                            ? <button className="cl-link" onClick={() => setChange({ ...change, open: true })}>{t(W.wrongDate)}</button>
                            : (
                                <div className="cl-change">
                                    <DatePick value={change} onChange={v => setChange({ ...change, ...v })} idPrefix="cl-c" />
                                    <label htmlFor="cl-why" className="cl-small">{t(W.reason)}
                                        <input id="cl-why" className="input" value={change.reason} placeholder={t(W.reasonPh)} onChange={e => setChange({ ...change, reason: e.target.value })} /></label>
                                    <p className="cl-small muted">{t(W.idNote)}</p>
                                    <div className="cl-row">
                                        <button className="btn btn-ghost" onClick={() => setChange({ open: false, day: '', month: '', reason: '' })}>{t(W.cancel)}</button>
                                        <button className="btn btn-primary" disabled={busy || !change.day || !change.month || !change.reason.trim()}
                                            onClick={() => act(async () => { await requestBirthdayChange(change.day, change.month, change.reason); setChange({ open: false, day: '', month: '', reason: '' }); })}>{t(W.send)}</button>
                                    </div>
                                </div>
                            ))}
                    </>
                )}
            </section>
        </div>
    );
};

export default ClubCards;
