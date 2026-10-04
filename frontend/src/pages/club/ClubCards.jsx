import React, { useCallback, useEffect, useState } from 'react';
import { FiCopy, FiLock, FiCheck } from 'react-icons/fi';
import { getMyClub, setMyBirthday, requestBirthdayChange, requestClubJoin } from '../../utils/api';
import './Club.css';

const errorText = (err) => err?.response?.data?.message || err?.message || 'Something went wrong';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const shade = (hex, f) => {
    const n = parseInt(String(hex || '#888888').slice(1), 16);
    const c = (v) => Math.max(0, Math.min(255, Math.round(v * f)));
    return `rgb(${c(n >> 16)}, ${c((n >> 8) & 255)}, ${c(n & 255)})`;
};
const ord = (n) => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');
const dayMonth = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '');

const DatePick = ({ value, onChange, idPrefix }) => (
    <div className="cl-dob">
        <label htmlFor={`${idPrefix}-d`}>Day
            <select id={`${idPrefix}-d`} value={value.day} onChange={e => onChange({ ...value, day: e.target.value })}>
                <option value="">Day</option>{Array.from({ length: 31 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}
            </select></label>
        <label htmlFor={`${idPrefix}-m`}>Month
            <select id={`${idPrefix}-m`} value={value.month} onChange={e => onChange({ ...value, month: e.target.value })}>
                <option value="">Month</option>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select></label>
    </div>
);

// Monthly tier, this month's milestones, Club level (12 months) and birthday, for the customer Rewards page
const ClubCards = () => {
    const [c, setC] = useState(null);
    const [error, setError] = useState('');
    const [bday, setBday] = useState({ day: '', month: '' });
    const [change, setChange] = useState({ open: false, day: '', month: '', reason: '' });
    const [copied, setCopied] = useState(false);
    const [busy, setBusy] = useState(false);

    const load = useCallback(() => getMyClub().then(r => setC(r.data)).catch(err => setError(errorText(err))), []);
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
        try { await fn(); await load(); } catch (err) { setError(errorText(err)); } finally { setBusy(false); }
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
                <div className="cl-tier-top"><span className="cl-kicker">{m.label} tier</span><span className="cl-reset">↻ resets in {m.daysLeft} day{m.daysLeft === 1 ? '' : 's'}</span></div>
                <p className="cl-tier-name">{tier.name}</p>
                <p className="cl-count"><b>{m.orders}</b> paid order{m.orders === 1 ? '' : 's'} this month</p>
                <div className="cl-bar"><i style={{ width: `${pct}%` }} /></div>
                <p className="cl-next">{next ? <>{next.orders - m.orders} more order{next.orders - m.orders === 1 ? '' : 's'} this month for <b>{next.name}</b></> : 'Top tier this month. Thank you!'}</p>
                <div className="cl-perks">
                    {Number(tier.multiplier) > 1 && <span>{tier.multiplier}× points</span>}
                    {Number(tier.pct) > 0 && <span>{tier.pct}% off every order</span>}
                    {tier.perks && <span>{tier.perks}</span>}
                    {tier.carried && <span>Kept from last month</span>}
                </div>
            </section>

            {m.milestones.length > 0 && (
                <section className="cl-card">
                    <p className="cl-title">This month's milestones</p>
                    <div className="cl-ms" style={{ gridTemplateColumns: `repeat(${m.milestones.length}, 1fr)` }}>
                        {m.milestones.map(x => {
                            const nextMs = m.milestones.find(y => !y.done && y.n > m.orders);
                            return (
                                <div key={x.n} className={x.done ? 'done' : nextMs && nextMs.n === x.n ? 'next' : ''}>
                                    <span className="cl-dot">{x.done ? <FiCheck /> : x.n}</span>
                                    <small>{x.reward}</small>
                                </div>
                            );
                        })}
                    </div>
                    {(() => { const n = m.milestones.find(y => !y.done && y.n > m.orders); return n
                        ? <p className="cl-small">Your {ord(n.n)} order this month: <b>{n.reward}</b> ({n.n - m.orders} to go)</p>
                        : <p className="cl-small">All of this month's milestones done!</p>; })()}
                    <p className="cl-small muted">{`Orders of ₹${m.minOrderValue} or more count.`}{m.lastMonth?.orders > 0 ? ` Last month you reached ${m.lastMonth.tier}.` : ''}</p>
                </section>
            )}

            {/* Club level, last 12 months */}
            {club.on && (
                <section className="cl-club">
                    <span className="cl-shine" aria-hidden="true" />
                    <p className="cl-kicker gold">Members Club</p>
                    <p className="cl-club-name">{club.member ? club.member.level : club.level ? club.level.name : 'Not a Club level yet'}</p>
                    {club.member && <p className="cl-small light">Member {club.member.code} · till {dayMonth(club.member.endsOn)}{club.member.inGrace ? ' (grace days, renew at the counter)' : ''}</p>}
                    <div className="cl-year">
                        <span><b>{club.yearOrders}</b> orders in the last 12 months</span>
                        {club.next ? <span className="cl-pill">{club.next.orders - club.yearOrders} to {club.next.name}</span> : <span className="cl-pill">Top level</span>}
                    </div>
                    <div className="cl-bar gold"><i style={{ width: `${Math.min(100, Math.round((club.yearOrders / goal) * 100))}%` }} /></div>
                    <div className="cl-bars" role="img" aria-label="Orders per month, last 12 months">
                        {club.series.map((s, i) => (
                            <div key={s.start}><i className={i === 0 ? 'old' : i === club.series.length - 1 ? 'now' : ''} style={{ height: `${Math.round((s.orders / maxBar) * 56) + 3}px` }} title={`${s.orders} orders`} /><span>{s.month[0]}</span></div>
                        ))}
                    </div>
                    <p className="cl-small light">{club.series[0]?.month} ({club.series[0]?.orders} orders) drops out on the 1st as a new month starts.</p>
                    <div className="cl-levels">
                        {club.levels.map((l, i) => (
                            <div key={l.name} className={club.level && club.level.index === i ? 'cur' : club.yearOrders >= l.orders ? 'got' : ''}>
                                <span>{l.name}</span><span>{l.orders} orders · ₹{l.price}/{l.months === 1 ? 'month' : `${l.months} months`}</span>
                                <small>{[l.pct > 0 && `${l.pct}% off (max ₹${l.cap})`, l.multiplier > 1 && `${l.multiplier}× points`, l.perks].filter(Boolean).join(' · ')}</small>
                            </div>
                        ))}
                    </div>
                    {club.level && (!club.member || club.member.inGrace) && (club.request
                        ? <p className="cl-wait">Request sent for {club.request.level}. Pay ₹{club.request.price} at the counter and staff will switch it on.</p>
                        : <button className="cl-join" disabled={busy} onClick={() => act(() => requestClubJoin())}>Join {club.level.name}: ₹{club.level.price}</button>)}
                </section>
            )}

            {/* Birthday */}
            <section className="cl-card cl-bday">
                <p className="cl-title">Birthday</p>
                {b.gift && !b.gift.used && new Date(b.gift.expiresAt) > new Date() && (
                    <div className="cl-gift">
                        <span className="cl-cake" aria-hidden="true">🎂</span>
                        <div><b>Happy birthday{c.name ? `, ${c.name.split(' ')[0]}` : ''}!</b><small>{b.gift.reward} · use by {dayMonth(b.gift.expiresAt)}</small></div>
                        {b.gift.code && <button onClick={() => copy(b.gift.code)} aria-label={`Copy ${b.gift.code}`}>{b.gift.code} <FiCopy /> {copied && 'Copied'}</button>}
                    </div>
                )}
                {!b.day ? (
                    <div className="cl-ask">
                        <p><b>🎁 Get a surprise on your birthday</b>{b.giftLabel ? `: ${b.giftLabel}` : ''}</p>
                        <DatePick value={bday} onChange={setBday} idPrefix="cl-b" />
                        <p className="cl-small muted"><FiLock /> You can set this once.</p>
                        <button className="btn btn-primary" disabled={busy || !bday.day || !bday.month} onClick={() => act(() => setMyBirthday(bday.day, bday.month))}>Save my birthday</button>
                    </div>
                ) : (
                    <>
                        <div className="cl-locked"><b>{b.label}</b><span><FiLock /> Locked</span></div>
                        {b.window && !b.window.open && <p className="cl-small">Your gift opens on {dayMonth(b.window.from)}{b.window.inDays != null ? ` (in ${b.window.inDays} days)` : ''}.</p>}
                        {b.blocked && b.blocked !== 'Birthday gift already given this year' && b.blocked !== 'No birthday saved' && <p className="cl-small muted">{b.blocked}.</p>}
                        {b.request?.status === 'open' && <p className="cl-wait">Change to {b.request.to} requested. Staff may ask to see an ID at the counter.</p>}
                        {b.request?.status === 'rejected' && <p className="cl-small">Your change request was not approved{b.request.note ? `: ${b.request.note}` : ''}.</p>}
                        {b.request?.status === 'approved' && <p className="cl-small">Your birthday was updated.</p>}
                        {b.request?.status !== 'open' && (!change.open
                            ? <button className="cl-link" onClick={() => setChange({ ...change, open: true })}>Wrong date? Ask the cafe to fix it</button>
                            : (
                                <div className="cl-change">
                                    <DatePick value={change} onChange={v => setChange({ ...change, ...v })} idPrefix="cl-c" />
                                    <label htmlFor="cl-why" className="cl-small">Reason
                                        <input id="cl-why" className="input" value={change.reason} placeholder="e.g. I picked the wrong day" onChange={e => setChange({ ...change, reason: e.target.value })} /></label>
                                    <p className="cl-small muted">Staff may ask to see an ID. One change per year.</p>
                                    <div className="cl-row">
                                        <button className="btn btn-ghost" onClick={() => setChange({ open: false, day: '', month: '', reason: '' })}>Cancel</button>
                                        <button className="btn btn-primary" disabled={busy || !change.day || !change.month || !change.reason.trim()}
                                            onClick={() => act(async () => { await requestBirthdayChange(change.day, change.month, change.reason); setChange({ open: false, day: '', month: '', reason: '' }); })}>Send request</button>
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
