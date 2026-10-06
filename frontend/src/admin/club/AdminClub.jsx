import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FiPlus, FiTrash2, FiCheck, FiX, FiGift, FiDownload } from 'react-icons/fi';
import {
    getClubConfig, saveClubConfig, getRewardRules, saveRewardRule, getClubMembers, activateClubMembership, cancelClubMembership,
    getClubLeaderboard, giveSpecialReward, getBirthdayRequests, decideBirthdayRequest, getBirthdayDuplicates, getAllMenuItems,
} from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import { errorText } from '../inventory/shared';
import Modal from '../inventory/Modal';
import { inr } from '../pos/money';
import '../AdminCustomerApp.css';
import './Club.css';

const TABS = [['tiers', 'Monthly tiers'], ['members', 'Members Club'], ['leaders', 'Leaderboard'], ['birthday', 'Birthday'], ['requests', 'Requests']];
const GIFT_TYPES = [['points', 'Points'], ['flat_coupon', '₹ off coupon'], ['pct_coupon', '% off coupon'], ['free_item', 'Free item']];
const GROUPS = { new: 'New', occasional: 'Occasional', regular: 'Regular', vip: 'VIP', slipping: 'Slipping', lost: 'Lost' };
const STATE = { requested: ['Wants to join', 'warn'], active: ['Active', 'ok'], expiring: ['Ends soon', 'warn'], grace: ['Grace days', 'warn'],
    lapsed: ['Lapsed', 'off'], cancelled: ['Cancelled', 'off'], declined: ['Declined', 'off'] };
const day = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—');
const num = (v) => (v === '' || v == null ? '' : Number(v));

const Toggle = ({ checked, onChange, disabled, label, hint }) => (
    <label className={`ca-toggle ${disabled ? 'disabled' : ''}`}>
        <span className="ca-toggle-copy"><strong>{label}</strong>{hint && <small>{hint}</small>}</span>
        <input type="checkbox" checked={!!checked} disabled={disabled} onChange={e => onChange(e.target.checked)} />
        <span className="ca-switch" aria-hidden="true" />
    </label>
);

// A gift picker used by milestones, the birthday gift and special rewards
const GiftFields = ({ value, onChange, items, idPrefix, disabled }) => (
    <div className="cb-gift">
        <select className="input" aria-label="Gift" id={`${idPrefix}-type`} disabled={disabled} value={value.rewardType}
            onChange={e => onChange({ ...value, rewardType: e.target.value })}>
            {GIFT_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        {value.rewardType === 'free_item' ? (
            <select className="input" aria-label="Free item" disabled={disabled} value={value.rewardItemId || ''} onChange={e => onChange({ ...value, rewardItemId: e.target.value })}>
                <option value="">Choose…</option>
                {items.map(i => <option key={i._id} value={i._id}>{i.name} · ₹{i.price}</option>)}
            </select>
        ) : (
            <input className="input cb-num" type="number" min="1" aria-label="Amount" disabled={disabled} value={value.rewardValue ?? ''}
                onChange={e => onChange({ ...value, rewardValue: num(e.target.value) })} />
        )}
    </div>
);

const TiersTab = ({ cfg, setCfg, save, rules, saveRule, items, canEdit }) => {
    const tiers = cfg.tiers;
    const setTier = (i, k, v) => setCfg({ ...cfg, tiers: tiers.map((t, n) => (n === i ? { ...t, [k]: v } : t)) });
    const milestones = rules.filter(r => r.triggerKind === 'month_milestone').sort((a, b) => a.triggerValue - b.triggerValue);
    const [draft, setDraft] = useState({});
    const addMilestone = () => saveRule({ name: 'New milestone', triggerKind: 'month_milestone', triggerValue: 20, triggerPeriod: 'month',
        rewardType: 'points', rewardValue: 50, perCustomerLimit: 1, perCustomerPeriod: 'month', expiryDays: 14, showCustomer: true, isActive: true });
    return (
        <>
            <section className="ca-card">
                <h2>Monthly tiers <span className="cb-tag">reset on the 1st</span></h2>
                <p className="muted small">Counted on paid orders in the current calendar month. Everyone starts again at the first tier on the 1st.</p>
                <div className="cb-tiers">
                    <div className="cb-tier head"><span /><span>Name</span><span>Orders this month</span><span>Points ×</span><span>% off</span><span>Extra perk shown to customers</span><span /></div>
                    {tiers.map((t, i) => (
                        <div className="cb-tier" key={i}>
                            <input type="color" aria-label={`${t.name} colour`} value={t.color || '#888888'} disabled={!canEdit} onChange={e => setTier(i, 'color', e.target.value)} />
                            <input className="input" aria-label="Tier name" value={t.name} disabled={!canEdit} onChange={e => setTier(i, 'name', e.target.value)} />
                            <input className="input cb-num" type="number" min="0" aria-label={`${t.name} orders`} value={t.orders} disabled={!canEdit || i === 0} onChange={e => setTier(i, 'orders', num(e.target.value))} />
                            <input className="input cb-num" type="number" min="1" step="0.25" aria-label={`${t.name} points multiplier`} value={t.multiplier} disabled={!canEdit} onChange={e => setTier(i, 'multiplier', num(e.target.value))} />
                            <input className="input cb-num" type="number" min="0" max="50" aria-label={`${t.name} discount`} value={t.pct} disabled={!canEdit} onChange={e => setTier(i, 'pct', num(e.target.value))} />
                            <input className="input" aria-label={`${t.name} perk`} value={t.perks || ''} placeholder="e.g. free cookie on Fridays" disabled={!canEdit} onChange={e => setTier(i, 'perks', e.target.value)} />
                            {canEdit && i > 0 && tiers.length > 1 ? <button className="icon-btn delete" aria-label={`Remove ${t.name}`} onClick={() => setCfg({ ...cfg, tiers: tiers.filter((_, n) => n !== i) })}><FiTrash2 /></button> : <span />}
                        </div>
                    ))}
                </div>
                {canEdit && tiers.length < 6 && <button className="btn btn-ghost btn-sm" onClick={() => setCfg({ ...cfg, tiers: [...tiers, { name: 'New tier', color: '#0E6B5F', orders: (tiers[tiers.length - 1]?.orders || 0) + 5, multiplier: 1, pct: 0, perks: '' }] })}><FiPlus /> Add tier</button>}
                <div className="cb-grid2">
                    <label className="input-group"><span>Orders count from ₹</span>
                        <input className="input" type="number" min="0" value={cfg.minOrderValue} disabled={!canEdit} onChange={e => setCfg({ ...cfg, minOrderValue: num(e.target.value) })} />
                        <small className="muted">Smaller orders don't count towards tiers, milestones or the Club.</small></label>
                    <label className="input-group"><span>Most discount on one bill (%)</span>
                        <input className="input" type="number" min="0" max="100" value={cfg.discountCap} disabled={!canEdit} onChange={e => setCfg({ ...cfg, discountCap: num(e.target.value) })} />
                        <small className="muted">Tier %, member % and coupons together never go above this.</small></label>
                </div>
                <Toggle disabled={!canEdit} checked={cfg.carry} onChange={v => setCfg({ ...cfg, carry: v })} label="Keep this month's tier through next month"
                    hint="Off = strict monthly reset. On = a tier reached late in the month still works next month." />
                {canEdit && <div className="cb-save"><button className="btn btn-primary" onClick={() => save(cfg)}>Save tiers</button></div>}
            </section>

            <section className="ca-card">
                <div className="ca-card-head"><h2>Monthly milestones</h2>{canEdit && <button className="btn btn-primary btn-sm" onClick={addMilestone}><FiPlus /> Add milestone</button>}</div>
                <p className="muted small">A gift on the customer's Nth paid order of the month, once per month.</p>
                {milestones.map(r => {
                    const d = draft[r.id] || r;
                    const set = (v) => setDraft({ ...draft, [r.id]: v });
                    return (
                        <div className="cb-ms" key={r.id}>
                            <span className="cb-ms-n">Order</span>
                            <input className="input cb-num" type="number" min="1" aria-label="Order number" value={d.triggerValue} disabled={!canEdit} onChange={e => set({ ...d, triggerValue: num(e.target.value) })} />
                            <span className="cb-ms-n">this month →</span>
                            <GiftFields value={d} onChange={set} items={items} idPrefix={`ms-${r.id}`} disabled={!canEdit} />
                            <label className="chk small"><input type="checkbox" checked={d.isActive} disabled={!canEdit} onChange={e => set({ ...d, isActive: e.target.checked })} /> On</label>
                            {canEdit && draft[r.id] && <button className="btn btn-primary btn-sm" onClick={async () => {
                                await saveRule({ ...d, name: `${d.triggerValue}${['th', 'st', 'nd', 'rd'][(d.triggerValue % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][d.triggerValue % 100] || 'th'} order this month`,
                                    triggerPeriod: 'month', perCustomerLimit: 1, perCustomerPeriod: 'month', expiryDays: d.rewardType === 'points' ? 0 : (d.expiryDays || 14) });
                                setDraft(x => { const y = { ...x }; delete y[r.id]; return y; });
                            }}>Save</button>}
                        </div>
                    );
                })}
                {milestones.length === 0 && <p className="ca-empty">No milestones yet.</p>}
            </section>
        </>
    );
};

const MembersTab = ({ cfg, setCfg, save, canEdit, canServe, flash }) => {
    const [list, setList] = useState([]);
    const [act, setAct] = useState(null);
    const [cancel, setCancel] = useState(null);
    const load = useCallback(() => getClubMembers().then(r => setList(r.data)).catch(() => {}), []);
    useEffect(() => { load(); }, [load]);
    const levels = cfg.levels;
    const setLevel = (i, k, v) => setCfg({ ...cfg, levels: levels.map((l, n) => (n === i ? { ...l, [k]: v } : l)) });
    const counts = useMemo(() => list.reduce((a, m) => ({ ...a, [m.state]: (a[m.state] || 0) + 1 }), {}), [list]);
    return (
        <>
            <section className="ca-card">
                <h2>Club levels <span className="cb-tag">rolling 12 months</span></h2>
                <p className="muted small">Paid orders in the last 12 calendar months (this month and the 11 before). Reaching a level lets a customer join.</p>
                <Toggle disabled={!canEdit} checked={cfg.clubOn} onChange={v => setCfg({ ...cfg, clubOn: v })} label="Members Club is open" hint="Off: no new members; current members keep their benefits until their end date." />
                {levels.map((l, i) => (
                    <div className="cb-level" key={i}>
                        <div className="cb-level-row">
                            <input className="input" aria-label="Level name" value={l.name} disabled={!canEdit} onChange={e => setLevel(i, 'name', e.target.value)} />
                            <label><span>Orders in 12 months</span><input className="input cb-num" type="number" min="1" value={l.orders} disabled={!canEdit} onChange={e => setLevel(i, 'orders', num(e.target.value))} /></label>
                            <label><span>Price ₹ (incl. GST)</span><input className="input cb-num" type="number" min="0" value={l.price} disabled={!canEdit} onChange={e => setLevel(i, 'price', num(e.target.value))} /></label>
                            <label><span>Months</span><input className="input cb-num" type="number" min="1" max="12" value={l.months} disabled={!canEdit} onChange={e => setLevel(i, 'months', num(e.target.value))} /></label>
                            {canEdit && <button className="icon-btn delete" aria-label={`Remove ${l.name}`} onClick={() => setCfg({ ...cfg, levels: levels.filter((_, n) => n !== i) })}><FiTrash2 /></button>}
                        </div>
                        <div className="cb-level-row">
                            <label><span>% off</span><input className="input cb-num" type="number" min="0" max="50" value={l.pct} disabled={!canEdit} onChange={e => setLevel(i, 'pct', num(e.target.value))} /></label>
                            <label><span>Max ₹ off per bill</span><input className="input cb-num" type="number" min="0" value={l.cap} disabled={!canEdit} onChange={e => setLevel(i, 'cap', num(e.target.value))} /></label>
                            <label><span>Points ×</span><input className="input cb-num" type="number" min="1" step="0.5" value={l.multiplier} disabled={!canEdit} onChange={e => setLevel(i, 'multiplier', num(e.target.value))} /></label>
                            <label className="cb-grow"><span>Other perks (shown to customers)</span><input className="input" value={l.perks || ''} disabled={!canEdit} onChange={e => setLevel(i, 'perks', e.target.value)} /></label>
                        </div>
                    </div>
                ))}
                {canEdit && levels.length < 3 && <button className="btn btn-ghost btn-sm" onClick={() => setCfg({ ...cfg, levels: [...levels, { name: 'New level', orders: (levels[levels.length - 1]?.orders || 0) + 60, price: 199, months: 1, pct: 10, cap: 50, multiplier: 2, perks: '' }] })}><FiPlus /> Add level</button>}
                <div className="cb-grid2">
                    <label className="input-group"><span>Grace days after a membership ends</span>
                        <input className="input" type="number" min="0" max="14" value={cfg.graceDays} disabled={!canEdit} onChange={e => setCfg({ ...cfg, graceDays: num(e.target.value) })} /></label>
                </div>
                <p className="muted small">The member discount works on one bill a day. The fee is billed with CGST 9% + SGST 9% included and goes into the drawer like any sale.</p>
                {canEdit && <div className="cb-save"><button className="btn btn-primary" onClick={() => save(cfg)}>Save Club levels</button></div>}
            </section>

            <section className="ca-card">
                <h2>Members {counts.active ? <span className="cb-pill ok">{counts.active} active</span> : null} {counts.requested ? <span className="cb-pill warn">{counts.requested} waiting</span> : null} {counts.expiring ? <span className="cb-pill warn">{counts.expiring} ending soon</span> : null}</h2>
                {list.length === 0 && <p className="ca-empty">No members yet. Customers who reach a Club level can ask to join from their Rewards page.</p>}
                <div className="tbl-wrap"><table className="cb-table">
                    <thead><tr><th>Customer</th><th>Level</th><th className="num">12-mo orders</th><th>Ends</th><th>Status</th><th /></tr></thead>
                    <tbody>{list.map(m => (
                        <tr key={m.id}>
                            <td>{m.name || 'Customer'}<small>{m.phone}{m.code ? ` · ${m.code}` : ''}</small></td>
                            <td>{m.level}</td><td className="num">{m.yearOrders}</td><td>{m.status === 'requested' ? '—' : day(m.endsOn)}</td>
                            <td><span className={`cb-pill ${STATE[m.state]?.[1] || ''}`}>{STATE[m.state]?.[0] || m.state}</span></td>
                            <td className="cb-actions">
                                {canServe && ['requested', 'expiring', 'grace', 'lapsed'].includes(m.state) && <button className="btn btn-primary btn-sm" onClick={() => setAct(m)}>{m.state === 'requested' ? 'Paid · Activate' : 'Renew'}</button>}
                                {canEdit && ['requested', 'active', 'expiring', 'grace'].includes(m.state) && <button className="btn btn-ghost btn-sm" onClick={() => setCancel(m)}>{m.state === 'requested' ? 'Decline' : 'Cancel'}</button>}
                            </td>
                        </tr>))}</tbody>
                </table></div>
            </section>

            {act && <ActivateModal m={act} levels={levels} canOverride={canEdit} onClose={() => setAct(null)} onDone={(r) => { setAct(null); load(); flash(`${act.name || 'Member'}: ${r.level} till ${day(r.endsOn)} (${r.code})`); }} />}
            {cancel && (
                <ReasonModal title={`${cancel.state === 'requested' ? 'Decline' : 'Cancel'} ${cancel.name || 'membership'}`} onClose={() => setCancel(null)}
                    onSubmit={async (reason) => { await cancelClubMembership(cancel.id, reason); setCancel(null); load(); }} />
            )}
        </>
    );
};

const ActivateModal = ({ m, levels, canOverride, onClose, onDone }) => {
    const [level, setLevel] = useState(m.levelIndex ?? 0);
    const [method, setMethod] = useState('cash');
    const [override, setOverride] = useState(false);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const l = levels[level];
    const short = l && m.yearOrders < l.orders;
    return (
        <Modal title={`Members Club · ${m.name || 'Customer'}`} onClose={onClose}>
            <div className="modal-body">
                <div className="input-group"><label htmlFor="act-level">Level</label>
                    <select id="act-level" className="input" value={level} onChange={e => setLevel(Number(e.target.value))}>
                        {levels.map((x, i) => <option key={x.name} value={i}>{x.name} · {inr(x.price)} · {x.months} month{x.months > 1 ? 's' : ''}</option>)}
                    </select></div>
                <p className="small">{m.yearOrders} paid orders in the last 12 months{l ? `; ${l.name} needs ${l.orders}` : ''}.</p>
                {short && canOverride && <label className="chk small"><input type="checkbox" checked={override} onChange={e => setOverride(e.target.checked)} /> Let them join anyway (owner decision, logged)</label>}
                <div className="pay-methods">{['cash', 'upi', 'card'].map(x => <button key={x} className={method === x ? 'active' : ''} onClick={() => setMethod(x)}>{x === 'upi' ? 'UPI' : x[0].toUpperCase() + x.slice(1)}</button>)}</div>
                <p className="small">Take <b>{l ? inr(l.price) : ''}</b> by {method === 'upi' ? 'UPI' : method}, then tap Activate. A bill is made and the money goes into the drawer.</p>
                {error && <p className="error-message">{error}</p>}
            </div>
            <div className="modal-footer">
                <button className="btn btn-ghost" onClick={onClose}>Back</button>
                <button className="btn btn-primary" disabled={busy || (short && !override)} onClick={async () => {
                    setBusy(true);
                    try { onDone((await activateClubMembership(m.customerId, level, method, override)).data); } catch (err) { setError(errorText(err)); setBusy(false); }
                }}>Paid · Activate</button>
            </div>
        </Modal>
    );
};

const ReasonModal = ({ title, onClose, onSubmit }) => {
    const [reason, setReason] = useState('');
    const [error, setError] = useState('');
    return (
        <Modal title={title} onClose={onClose}>
            <div className="modal-body"><div className="input-group"><label htmlFor="rs">Reason *</label>
                <input id="rs" className="input" value={reason} onChange={e => setReason(e.target.value)} autoFocus /></div>
                {error && <p className="error-message">{error}</p>}</div>
            <div className="modal-footer"><button className="btn btn-ghost" onClick={onClose}>Back</button>
                <button className="btn btn-danger" disabled={!reason.trim()} onClick={async () => { try { await onSubmit(reason); } catch (err) { setError(errorText(err)); } }}>Confirm</button></div>
        </Modal>
    );
};

const LeadersTab = ({ items, canGive, flash }) => {
    const [period, setPeriod] = useState('month');
    const [rows, setRows] = useState([]);
    const [picked, setPicked] = useState([]);
    const [gift, setGift] = useState(null);
    useEffect(() => { getClubLeaderboard(period).then(r => { setRows(r.data); setPicked([]); }).catch(() => {}); }, [period]);
    const toggle = (id) => setPicked(p => (p.includes(id) ? p.filter(x => x !== id) : [...p, id]));
    const exportCsv = () => {
        const head = ['Rank', 'Name', 'Phone', 'Tier', 'Club level', 'Member', 'This month', '12 months', 'Spend 12 months', 'Group', 'Last visit'];
        const lines = rows.map(r => [r.rank, r.name, r.phone, r.tier, r.level || '', r.member || '', r.month, r.year, r.spend, GROUPS[r.group] || r.group, day(r.lastVisit)]);
        const csv = [head, ...lines].map(l => l.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
        a.download = `leaderboard-${period}.csv`;
        a.click();
    };
    return (
        <section className="ca-card">
            <div className="ca-card-head">
                <h2>Leaderboard <span className="cb-tag">owner only</span></h2>
                <div className="cb-seg">
                    <button className={period === 'month' ? 'on' : ''} onClick={() => setPeriod('month')}>This month</button>
                    <button className={period === 'year' ? 'on' : ''} onClick={() => setPeriod('year')}>Last 12 months</button>
                </div>
            </div>
            <p className="muted small">Customers never see rankings. Staff phone numbers are left out.</p>
            <div className="cb-bar">
                {canGive && <button className="btn btn-primary btn-sm" disabled={!picked.length} onClick={() => setGift({ type: 'flat_coupon', value: 100, days: 14, note: 'Thank you for being a regular' })}><FiGift /> Give reward to {picked.length || '…'}</button>}
                {canGive && rows.length > 0 && <button className="btn btn-ghost btn-sm" onClick={() => setPicked(rows.slice(0, 10).map(r => r.id))}>Pick top 10</button>}
                <button className="btn btn-ghost btn-sm" onClick={exportCsv} disabled={!rows.length}><FiDownload /> Export CSV</button>
            </div>
            {rows.length === 0 && <p className="ca-empty">No paid orders with a customer {period === 'month' ? 'this month' : 'in the last 12 months'} yet.</p>}
            <div className="tbl-wrap"><table className="cb-table">
                <thead><tr>{canGive && <th />}<th className="num">#</th><th>Customer</th><th>Tier</th><th>Club</th><th className="num">This month</th><th className="num">12 months</th><th className="num">Spend 12 mo</th><th>Group</th><th>Last visit</th></tr></thead>
                <tbody>{rows.map(r => (
                    <tr key={r.id} className={picked.includes(r.id) ? 'picked' : ''}>
                        {canGive && <td><input type="checkbox" aria-label={`Pick ${r.name}`} checked={picked.includes(r.id)} onChange={() => toggle(r.id)} /></td>}
                        <td className="num">{r.rank}</td>
                        <td>{r.name || 'Customer'}<small>{r.phone}</small></td>
                        <td><span className="cb-pill" style={{ background: `${r.tierColor}22`, color: r.tierColor }}>{r.tier}</span></td>
                        <td>{r.member ? <span className="cb-pill gold">👑 {r.member}</span> : r.level ? <span className="cb-pill">{r.level} level</span> : '—'}</td>
                        <td className="num">{r.month}</td><td className="num">{r.year}</td><td className="num">{inr(r.spend)}</td>
                        <td><span className={`cb-pill ${r.group === 'slipping' || r.group === 'lost' ? 'warn' : r.group === 'vip' ? 'gold' : ''}`}>{GROUPS[r.group] || r.group}</span></td>
                        <td>{day(r.lastVisit)}</td>
                    </tr>))}</tbody>
            </table></div>
            {gift && (
                <Modal title={`Special reward for ${picked.length} customer${picked.length > 1 ? 's' : ''}`} onClose={() => setGift(null)}>
                    <div className="modal-body">
                        <GiftFields value={{ rewardType: gift.type, rewardValue: gift.value, rewardItemId: gift.itemId }} items={items} idPrefix="sp"
                            onChange={v => setGift({ ...gift, type: v.rewardType, value: v.rewardValue, itemId: v.rewardItemId })} />
                        {gift.type !== 'points' && <div className="input-group"><label htmlFor="sp-days">Valid for (days)</label><input id="sp-days" className="input" type="number" min="1" value={gift.days} onChange={e => setGift({ ...gift, days: num(e.target.value) })} /></div>}
                        <div className="input-group"><label htmlFor="sp-note">Note (shown as the reward name)</label><input id="sp-note" className="input" value={gift.note} onChange={e => setGift({ ...gift, note: e.target.value })} /></div>
                        <p className="small">This reaches <b>{picked.length}</b> customer{picked.length > 1 ? 's' : ''}. It's logged with your name, and a WhatsApp message for each is added to the reward to-do list.</p>
                    </div>
                    <div className="modal-footer"><button className="btn btn-ghost" onClick={() => setGift(null)}>Back</button>
                        <button className="btn btn-primary" onClick={async () => {
                            try {
                                const r = await giveSpecialReward(picked, { type: gift.type, value: gift.value, itemId: gift.itemId, days: gift.days, note: gift.note });
                                setGift(null); setPicked([]); flash(`Reward given to ${r.data.given} customer${r.data.given > 1 ? 's' : ''}`);
                            } catch (err) { flash(errorText(err)); }
                        }}>Give</button></div>
                </Modal>
            )}
        </section>
    );
};

const BirthdayTab = ({ cfg, setCfg, save, rules, saveRule, items, canEdit }) => {
    const b = cfg.birthday;
    const setB = (k, v) => setCfg({ ...cfg, birthday: { ...b, [k]: v } });
    const rule = rules.find(r => r.triggerKind === 'birthday' && r.isActive) || rules.find(r => r.triggerKind === 'birthday');
    const [gift, setGift] = useState(rule || null);
    return (
        <section className="ca-card">
            <h2>Birthday</h2>
            <Toggle disabled={!canEdit} checked={b.askAtSignin} onChange={v => setB('askAtSignin', v)} label="Ask at sign-in" hint="Day and month only; customers can skip and add it later on their Rewards page." />
            <p className="muted small">A birthday is saved once and locked. Changes come to Requests for you to approve after checking an ID.</p>
            {gift && (
                <>
                    <h3 className="cb-h3">Gift</h3>
                    <div className="cb-row">
                        <GiftFields value={gift} onChange={setGift} items={items} idPrefix="bd" disabled={!canEdit} />
                        <span className="small">+</span>
                        <input className="input cb-num" type="number" min="0" aria-label="Bonus points" value={b.bonusPoints} disabled={!canEdit} onChange={e => setB('bonusPoints', num(e.target.value))} />
                        <span className="small">bonus points</span>
                        <label className="chk small"><input type="checkbox" checked={gift.isActive} disabled={!canEdit} onChange={e => setGift({ ...gift, isActive: e.target.checked })} /> Gift on</label>
                    </div>
                </>
            )}
            <h3 className="cb-h3">When and who</h3>
            <div className="cb-row">
                <span className="small">Valid from</span><input className="input cb-num" type="number" min="0" max="14" aria-label="Days before" value={b.before} disabled={!canEdit} onChange={e => setB('before', num(e.target.value))} />
                <span className="small">days before to</span><input className="input cb-num" type="number" min="0" max="30" aria-label="Days after" value={b.after} disabled={!canEdit} onChange={e => setB('after', num(e.target.value))} />
                <span className="small">days after the birthday</span>
            </div>
            <div className="cb-row">
                <span className="small">Needs at least</span><input className="input cb-num" type="number" min="0" aria-label="Paid orders" value={b.minOrders} disabled={!canEdit} onChange={e => setB('minOrders', num(e.target.value))} />
                <span className="small">paid order(s), account at least</span><input className="input cb-num" type="number" min="0" aria-label="Account age in days" value={b.minAccountDays} disabled={!canEdit} onChange={e => setB('minAccountDays', num(e.target.value))} />
                <span className="small">days old before the birthday</span>
            </div>
            <p className="muted small">Once a year per customer, even if their date is changed. 29 February birthdays get it on 28 February in other years. The WhatsApp message is in Rewards → Rules.</p>
            {canEdit && <div className="cb-save"><button className="btn btn-primary" onClick={async () => {
                await save(cfg);
                if (gift) await saveRule({ ...gift, perCustomerLimit: 1, perCustomerPeriod: 'year' });
            }}>Save birthday settings</button></div>}
        </section>
    );
};

const RequestsTab = ({ canDecide, flash }) => {
    const [list, setList] = useState([]);
    const [dups, setDups] = useState([]);
    const [all, setAll] = useState(false);
    const load = useCallback(() => {
        getBirthdayRequests(all ? 'all' : 'open').then(r => setList(r.data)).catch(() => {});
        getBirthdayDuplicates().then(r => setDups(r.data)).catch(() => {});
    }, [all]);
    useEffect(() => { load(); }, [load]);
    const decide = async (r, ok) => {
        try { await decideBirthdayRequest(r.id, ok, ok ? 'ID checked' : ''); load(); flash(ok ? `Birthday changed to ${r.to}` : 'Request rejected'); } catch (err) { flash(errorText(err)); }
    };
    return (
        <>
            <section className="ca-card">
                <div className="ca-card-head"><h2>Birthday change requests</h2><label className="chk small"><input type="checkbox" checked={all} onChange={e => setAll(e.target.checked)} /> Show decided</label></div>
                <p className="muted small">Ask to see an ID at the counter before approving. One approved change per customer per year; the gift still comes only once a year.</p>
                {list.length === 0 && <p className="ca-empty">No requests waiting.</p>}
                {list.map(r => (
                    <div className={`cb-req ${r.status !== 'open' ? 'done' : ''}`} key={r.id}>
                        <div><b>{r.name || 'Customer'}</b> <span className="muted small">{r.phone}</span>
                            <p className="small">{r.from} → <b>{r.to}</b> · "{r.reason}"</p></div>
                        {r.status === 'open' && canDecide ? (
                            <div className="cb-actions"><button className="btn btn-primary btn-sm" onClick={() => decide(r, true)}><FiCheck /> Approve</button><button className="btn btn-ghost btn-sm" onClick={() => decide(r, false)}><FiX /> Reject</button></div>
                        ) : <span className={`cb-pill ${r.status === 'approved' ? 'ok' : r.status === 'rejected' ? 'off' : 'warn'}`}>{r.status === 'open' ? 'Waiting' : `${r.status[0].toUpperCase()}${r.status.slice(1)}${r.by ? ` by ${r.by}` : ''}`}</span>}
                    </div>
                ))}
            </section>
            {dups.length > 0 && (
                <section className="ca-card">
                    <h2>Possible second accounts</h2>
                    <p className="muted small">Same name and birthday on different numbers. They could be two people, or one person collecting two birthday gifts.</p>
                    {dups.map((d, i) => <p key={i} className="small"><b>{d.name}</b> · {d.birthday} · {d.count} numbers: {d.phones.join(', ')}</p>)}
                </section>
            )}
        </>
    );
};

// Admin → Customers → Club: monthly tiers and milestones, Members Club, leaderboard, birthday, requests
const AdminClub = () => {
    const { hasPerm } = useAuth();
    const [params, setParams] = useSearchParams();
    const tab = TABS.some(([k]) => k === params.get('tab')) ? params.get('tab') : 'tiers';
    const [cfg, setCfg] = useState(null);
    const [rules, setRules] = useState([]);
    const [items, setItems] = useState([]);
    const [msg, setMsg] = useState('');
    const canEdit = hasPerm('settings.edit');
    const flash = (t) => { setMsg(t); setTimeout(() => setMsg(''), 3000); };
    // Reward rules need "View rewards"; without it the tabs show the club settings only
    const seeRules = hasPerm('rewards.view');
    const loadRules = useCallback(() => (seeRules ? getRewardRules().then(r => setRules(r.data)).catch(() => {}) : Promise.resolve()), [seeRules]);
    useEffect(() => {
        getClubConfig().then(r => setCfg(r.data)).catch(err => flash(errorText(err)));
        loadRules();
        getAllMenuItems().then(r => setItems(r.data.filter(i => !i.isRestricted && i.soldInShop !== false))).catch(() => {});
    }, [loadRules]);
    const save = async (next) => {
        try { setCfg((await saveClubConfig(next)).data); flash('Saved. Customers see it straight away.'); } catch (err) { flash(errorText(err)); }
    };
    const saveRule = async (r) => {
        try { await saveRewardRule(r); await loadRules(); flash('Saved'); } catch (err) { flash(errorText(err)); }
    };
    if (!cfg) return <div className="admin-loading"><div className="spinner" /></div>;
    return (
        <div className="club-admin customer-app-admin">
            <div className="page-header"><div><h1>FiKA Club</h1><p className="muted">Monthly tiers, the Members Club, birthdays and your best customers.</p></div></div>
            <div className="cb-tabs" role="tablist">
                {TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setParams(k === 'tiers' ? {} : { tab: k })}>{l}</button>)}
            </div>
            {!canEdit && <p className="ca-note">You can look; only staff with "Edit settings" can change the rules.</p>}
            {msg && <div className="ca-flash" role="status">{msg}</div>}
            {tab === 'tiers' && <TiersTab cfg={cfg} setCfg={setCfg} save={save} rules={rules} saveRule={saveRule} items={items} canEdit={canEdit && hasPerm('rewards.edit')} />}
            {tab === 'members' && <MembersTab cfg={cfg} setCfg={setCfg} save={save} canEdit={canEdit} canServe={hasPerm('orders.create')} flash={flash} />}
            {tab === 'leaders' && <LeadersTab items={items} canGive={hasPerm('customers.edit')} flash={flash} />}
            {tab === 'birthday' && <BirthdayTab key={(rules.find(r => r.triggerKind === 'birthday') || {}).id || 'none'} cfg={cfg} setCfg={setCfg} save={save} rules={rules} saveRule={saveRule} items={items} canEdit={canEdit && hasPerm('rewards.edit')} />}
            {tab === 'requests' && <RequestsTab canDecide={hasPerm('customers.edit')} flash={flash} />}
        </div>
    );
};

export default AdminClub;
