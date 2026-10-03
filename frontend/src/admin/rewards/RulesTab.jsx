import React, { useCallback, useEffect, useState } from 'react';
import { FiPlus, FiEdit2, FiTrash2, FiGift } from 'react-icons/fi';
import { getRewardRules, saveRewardRule, deleteRewardRule, giveReward, findCustomers, getAllMenuItems, getAllCategories, getStaff } from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import Modal from '../inventory/Modal';
import { errorText, fmtMoney } from '../inventory/shared';

export const TRIGGERS = [
    { value: 'nth_order', label: 'Every Nth order', unit: 'orders' },
    { value: 'spend_crosses', label: 'Spend crosses ₹X', unit: '₹' },
    { value: 'first_order', label: 'First order' },
    { value: 'streak', label: 'Visit streak (days in a row)', unit: 'days' },
    { value: 'birthday', label: 'Birthday' },
    { value: 'anniversary', label: 'Anniversary' },
    { value: 'inactive', label: 'Not visited for X days', unit: 'days' },
    { value: 'group', label: 'Customer moves into a group' },
    { value: 'instagram', label: 'Instagram verified' },
    { value: 'manual', label: 'Given by staff' },
];
export const GROUPS = [
    { value: 'new', label: 'New (1 order)' }, { value: 'regular', label: 'Regular (3+ orders in 30 days)' },
    { value: 'vip', label: 'VIP (top 10% by spend)' }, { value: 'slipping', label: 'Slipping (late vs their usual gap)' },
    { value: 'lost', label: 'Lost (60+ days)' }, { value: 'occasional', label: 'Occasional' },
];
const REWARDS = [
    { value: 'points', label: 'Points' }, { value: 'flat_coupon', label: '₹ off coupon' }, { value: 'pct_coupon', label: '% off coupon' },
    { value: 'free_item', label: 'Free item' }, { value: 'multiplier', label: 'Points multiplier' }, { value: 'text', label: 'Custom reward (text)' },
];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const CHANNELS = [{ value: 'qr', label: 'QR / table' }, { value: 'dine_in', label: 'Dine-in' }, { value: 'takeaway', label: 'Takeaway' }, { value: 'kiosk', label: 'Kiosk' }];
const blank = {
    name: '', isActive: true, triggerKind: 'nth_order', triggerValue: 10, triggerPeriod: 'lifetime', triggerGroup: 'slipping',
    conditions: {}, rewardType: 'flat_coupon', rewardValue: 100, rewardCap: '', rewardItemId: '', rewardDays: 7, rewardText: '',
    perCustomerLimit: 0, perCustomerPeriod: 'ever', monthlyLimit: 0, monthlyBudget: 0, expiryDays: 30, minGapDays: 0,
    pauseWhenBehind: false, showCustomer: true, assignedStaff: [],
    whatsappTemplate: 'Hi {name}! {cafe} has a reward for you: {reward}. Use code {code} before {expiry}.',
};
const toggle = (arr, v) => (arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v]);

const RuleForm = ({ rule, menu, categories, staff, onClose, onSaved }) => {
    const [f, setF] = useState(rule ? { ...blank, ...rule, rewardCap: rule.rewardCap ?? '', rewardItemId: rule.rewardItemId || '' } : blank);
    const [error, setError] = useState('');
    const set = (k, v) => setF(x => ({ ...x, [k]: v }));
    const cond = (k, v) => setF(x => ({ ...x, conditions: { ...x.conditions, [k]: v } }));
    const c = f.conditions || {};
    const trig = TRIGGERS.find(t => t.value === f.triggerKind);
    const submit = async (e) => {
        e.preventDefault();
        try { await saveRewardRule(f); onSaved(); } catch (err) { setError(errorText(err, 'Could not save')); }
    };
    return (
        <Modal title={rule ? `Edit ${rule.name}` : 'New reward rule'} onClose={onClose} wide>
            <form onSubmit={submit}>
                <div className="modal-body rule-form">
                    <div className="input-group"><label>Rule name *</label>
                        <input className="input" value={f.name} onChange={e => set('name', e.target.value)} required placeholder="e.g. Every 25th order: ₹500 off" /></div>

                    <fieldset><legend>When</legend>
                        <div className="form-grid">
                            <div className="input-group"><label>Trigger</label>
                                <select className="input" value={f.triggerKind} onChange={e => set('triggerKind', e.target.value)}>
                                    {TRIGGERS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                                </select></div>
                            {trig?.unit && <div className="input-group"><label>Number ({trig.unit})</label>
                                <input className="input" type="number" min="1" value={f.triggerValue} onChange={e => set('triggerValue', e.target.value)} /></div>}
                            {['nth_order', 'spend_crosses'].includes(f.triggerKind) && <div className="input-group"><label>Counting</label>
                                <select className="input" value={f.triggerPeriod} onChange={e => set('triggerPeriod', e.target.value)}>
                                    <option value="lifetime">All time</option><option value="month">This month</option></select></div>}
                            {f.triggerKind === 'group' && <div className="input-group"><label>Group</label>
                                <select className="input" value={f.triggerGroup} onChange={e => set('triggerGroup', e.target.value)}>
                                    {GROUPS.map(g => <option key={g.value} value={g.value}>{g.label}</option>)}</select></div>}
                            {f.triggerKind === 'instagram' && <div className="input-group"><label>For</label>
                                <select className="input" value={c.igKind || ''} onChange={e => cond('igKind', e.target.value)}>
                                    <option value="">Tag or follow</option><option value="tag">Tag (post/story)</option><option value="follow">Follow</option></select></div>}
                        </div>
                    </fieldset>

                    {['nth_order', 'spend_crosses', 'first_order', 'streak'].includes(f.triggerKind) && (
                        <fieldset><legend>If (all optional)</legend>
                            <div className="form-grid">
                                <div className="input-group"><label>Minimum bill ₹</label>
                                    <input className="input" type="number" min="0" value={c.minBill || ''} onChange={e => cond('minBill', e.target.value)} /></div>
                                <div className="input-group"><label>From time</label>
                                    <input className="input" type="time" value={c.fromTime || ''} onChange={e => cond('fromTime', e.target.value)} /></div>
                                <div className="input-group"><label>To time</label>
                                    <input className="input" type="time" value={c.toTime || ''} onChange={e => cond('toTime', e.target.value)} /></div>
                                <div className="input-group"><label>Order has an item from</label>
                                    <select className="input" multiple size={4} value={c.categoryIds || []} aria-label="Categories"
                                        onChange={e => cond('categoryIds', [...e.target.selectedOptions].map(o => o.value))}>
                                        {categories.map(x => <option key={x._id} value={x._id}>{x.name}</option>)}</select></div>
                                <div className="input-group"><label>…or these items</label>
                                    <select className="input" multiple size={4} value={c.itemIds || []} aria-label="Items"
                                        onChange={e => cond('itemIds', [...e.target.selectedOptions].map(o => o.value))}>
                                        {menu.filter(m => !m.isRestricted).map(x => <option key={x._id} value={x._id}>{x.name}</option>)}</select></div>
                            </div>
                            <div className="chip-row">{DAYS.map((d, i) => (
                                <button type="button" key={d} className={`chip${(c.days || []).includes(i) ? ' on' : ''}`} onClick={() => cond('days', toggle(c.days || [], i))}>{d}</button>))}
                                <span className="muted small">days (none = every day)</span></div>
                            <div className="chip-row">{CHANNELS.map(ch => (
                                <button type="button" key={ch.value} className={`chip${(c.channels || []).includes(ch.value) ? ' on' : ''}`}
                                    onClick={() => cond('channels', toggle(c.channels || [], ch.value))}>{ch.label}</button>))}</div>
                            <div className="chip-row">{GROUPS.map(g => (
                                <button type="button" key={g.value} className={`chip${(c.groups || []).includes(g.value) ? ' on' : ''}`}
                                    onClick={() => cond('groups', toggle(c.groups || [], g.value))}>{g.value}</button>))}
                                <span className="muted small">groups</span></div>
                            <p className="muted small">Restricted items (cigarettes etc.) never count.</p>
                        </fieldset>
                    )}

                    <fieldset><legend>Give</legend>
                        <div className="form-grid">
                            <div className="input-group"><label>Reward</label>
                                <select className="input" value={f.rewardType} onChange={e => set('rewardType', e.target.value)}>
                                    {REWARDS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}</select></div>
                            {['points', 'flat_coupon', 'pct_coupon', 'multiplier'].includes(f.rewardType) && <div className="input-group">
                                <label>{{ points: 'Points', flat_coupon: '₹ off', pct_coupon: '% off', multiplier: 'Multiplier (2 = double)' }[f.rewardType]}</label>
                                <input className="input" type="number" min="0" step="0.5" value={f.rewardValue} onChange={e => set('rewardValue', e.target.value)} /></div>}
                            {f.rewardType === 'pct_coupon' && <div className="input-group"><label>Max ₹ off</label>
                                <input className="input" type="number" min="0" value={f.rewardCap} onChange={e => set('rewardCap', e.target.value)} /></div>}
                            {f.rewardType === 'free_item' && <div className="input-group"><label>Free item</label>
                                <select className="input" value={f.rewardItemId} onChange={e => set('rewardItemId', e.target.value)}>
                                    <option value="">Pick…</option>{menu.filter(m => !m.isRestricted).map(x => <option key={x._id} value={x._id}>{x.name} · ₹{x.price}</option>)}</select></div>}
                            {f.rewardType === 'multiplier' && <div className="input-group"><label>For days</label>
                                <input className="input" type="number" min="1" value={f.rewardDays} onChange={e => set('rewardDays', e.target.value)} /></div>}
                            {f.rewardType === 'text' && <div className="input-group"><label>Reward text</label>
                                <input className="input" value={f.rewardText} onChange={e => set('rewardText', e.target.value)} placeholder="Free dessert tasting" /></div>}
                            {!['points', 'multiplier', 'text'].includes(f.rewardType) && <div className="input-group"><label>Coupon valid (days)</label>
                                <input className="input" type="number" min="1" value={f.expiryDays} onChange={e => set('expiryDays', e.target.value)} /></div>}
                        </div>
                    </fieldset>

                    <fieldset><legend>Limits</legend>
                        <div className="form-grid">
                            <div className="input-group"><label>Per customer (0 = no limit)</label>
                                <input className="input" type="number" min="0" value={f.perCustomerLimit} onChange={e => set('perCustomerLimit', e.target.value)} /></div>
                            <div className="input-group"><label>…per</label>
                                <select className="input" value={f.perCustomerPeriod} onChange={e => set('perCustomerPeriod', e.target.value)}>
                                    <option value="ever">Ever</option><option value="year">Year</option><option value="month">Month</option><option value="week">Week</option></select></div>
                            <div className="input-group"><label>Max per month (all customers)</label>
                                <input className="input" type="number" min="0" value={f.monthlyLimit} onChange={e => set('monthlyLimit', e.target.value)} /></div>
                            <div className="input-group"><label>Monthly budget ₹ (0 = none)</label>
                                <input className="input" type="number" min="0" value={f.monthlyBudget} onChange={e => set('monthlyBudget', e.target.value)} /></div>
                            <div className="input-group"><label>Min. days between rewards</label>
                                <input className="input" type="number" min="0" value={f.minGapDays} onChange={e => set('minGapDays', e.target.value)} /></div>
                        </div>
                        <label className="check"><input type="checkbox" checked={f.pauseWhenBehind} onChange={e => set('pauseWhenBehind', e.target.checked)} /> Hold this reward while the week is behind the profit target</label>
                    </fieldset>

                    <fieldset><legend>Tell</legend>
                        <label className="check"><input type="checkbox" checked={f.showCustomer} onChange={e => set('showCustomer', e.target.checked)} /> Show it to the customer in their rewards page</label>
                        <div className="input-group"><label>WhatsApp message <span className="hint">{'{name} {reward} {code} {expiry} {cafe} {points}'} · empty = no WhatsApp</span></label>
                            <textarea className="input" rows={3} value={f.whatsappTemplate} onChange={e => set('whatsappTemplate', e.target.value)} /></div>
                        <div className="input-group"><label>Who sends it (empty = anyone with Customers access)</label>
                            <div className="chip-row">{staff.map(s => (
                                <button type="button" key={s.id} className={`chip${f.assignedStaff.includes(s.id) ? ' on' : ''}`}
                                    onClick={() => set('assignedStaff', toggle(f.assignedStaff, s.id))}>{s.name}</button>))}</div></div>
                        <p className="muted small">Assign the phone that has the cafe's WhatsApp Business — WhatsApp sends from whichever account is on that phone.</p>
                    </fieldset>
                    <label className="check"><input type="checkbox" checked={f.isActive} onChange={e => set('isActive', e.target.checked)} /> Rule is on</label>
                    {error && <p className="error-message">{error}</p>}
                </div>
                <div className="modal-footer">
                    <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
                    <button type="submit" className="btn btn-primary">Save rule</button>
                </div>
            </form>
        </Modal>
    );
};

const GiveForm = ({ rule, onClose }) => {
    const [q, setQ] = useState('');
    const [list, setList] = useState([]);
    const [msg, setMsg] = useState('');
    useEffect(() => {
        if (q.trim().length < 2) { setList([]); return undefined; }
        const t = setTimeout(() => findCustomers(q).then(r => setList(r.data)).catch(() => {}), 250);
        return () => clearTimeout(t);
    }, [q]);
    const give = async (c) => {
        try { await giveReward(rule.id, c.id); setMsg(`Given to ${c.name || c.phone}. It's in the WhatsApp to-do.`); } catch (err) { setMsg(errorText(err, 'Could not give')); }
    };
    return (
        <Modal title={`Give: ${rule.name}`} onClose={onClose}>
            <div className="modal-body">
                <input className="input" autoFocus placeholder="Customer name or phone" value={q} onChange={e => setQ(e.target.value)} aria-label="Find customer" />
                {list.map(c => <button key={c.id} className="list-btn" onClick={() => give(c)}>{c.name || 'Customer'} · {c.phone}</button>)}
                {msg && <p className="small">{msg}</p>}
            </div>
        </Modal>
    );
};

const describe = (r) => {
    const t = TRIGGERS.find(x => x.value === r.triggerKind)?.label || r.triggerKind;
    const v = { nth_order: `every ${r.triggerValue}th order`, spend_crosses: `spend crosses ${fmtMoney(r.triggerValue)}${r.triggerPeriod === 'month' ? ' in a month' : ''}`,
        streak: `${r.triggerValue} days in a row`, inactive: `no visit for ${r.triggerValue} days`, group: `moves to ${r.triggerGroup}` }[r.triggerKind];
    return v || t;
};

const RulesTab = () => {
    const { hasPerm } = useAuth();
    const [rules, setRules] = useState([]);
    const [menu, setMenu] = useState([]);
    const [categories, setCategories] = useState([]);
    const [staff, setStaff] = useState([]);
    const [modal, setModal] = useState(null);
    const load = useCallback(async () => setRules((await getRewardRules()).data), []);
    useEffect(() => {
        load();
        getAllMenuItems().then(r => setMenu(r.data)).catch(() => {});
        getAllCategories().then(r => setCategories(r.data)).catch(() => {});
        if (hasPerm('staff.view')) getStaff().then(r => setStaff(r.data.staff || [])).catch(() => {});
    }, [load, hasPerm]);
    const canEdit = hasPerm('rewards.edit');
    const total = rules.filter(r => r.isActive).reduce((a, r) => a + Number(r.estMonthlyCost || 0), 0);
    const remove = async (r) => {
        if (!window.confirm(`Delete "${r.name}"? Rewards already given stay.`)) return;
        try { await deleteRewardRule(r.id); load(); } catch (err) { alert(errorText(err)); }
    };

    return (
        <div>
            <div className="inv-toolbar">
                {canEdit && <button className="btn btn-primary" onClick={() => setModal({ kind: 'edit' })}><FiPlus /> New rule</button>}
                <span className="muted small">Active rules cost about <strong>{fmtMoney(total, 0)}</strong> a month (estimate from the last 30 days).</span>
            </div>
            <div className="rule-list">
                {rules.map(r => (
                    <div key={r.id} className={`rule-card${r.isActive ? '' : ' off'}`}>
                        <div className="rule-main">
                            <strong>{r.name}</strong>
                            <span className="small">When {describe(r)} → <strong>{r.rewardLabel}</strong></span>
                            <span className="muted small">
                                {r.perCustomerLimit > 0 ? `${r.perCustomerLimit}× per customer per ${r.perCustomerPeriod}` : 'no per-customer limit'}
                                {r.monthlyBudget > 0 && ` · budget ${fmtMoney(r.monthlyBudget, 0)}/month`}
                                {` · ~${fmtMoney(r.unitCost)} each · est. ${fmtMoney(r.estMonthlyCost, 0)}/month`}
                                {` · this month ${r.thisMonth.count} (${fmtMoney(r.thisMonth.cost, 0)})`}
                            </span>
                            {r.pausedReason && <span className="pill warn">{r.pausedReason}</span>}
                            {!r.isActive && <span className="pill muted">off</span>}
                        </div>
                        <div className="rule-actions">
                            {canEdit && r.isActive && <button className="btn btn-ghost btn-sm" onClick={() => setModal({ kind: 'give', rule: r })}><FiGift /> Give</button>}
                            {canEdit && <button className="icon-btn" aria-label={`Edit ${r.name}`} onClick={() => setModal({ kind: 'edit', rule: r })}><FiEdit2 /></button>}
                            {hasPerm('rewards.delete') && <button className="icon-btn danger" aria-label={`Delete ${r.name}`} onClick={() => remove(r)}><FiTrash2 /></button>}
                        </div>
                    </div>
                ))}
                {rules.length === 0 && <p className="muted empty">No reward rules yet.</p>}
            </div>
            {modal?.kind === 'edit' && <RuleForm rule={modal.rule} menu={menu} categories={categories} staff={staff}
                onClose={() => setModal(null)} onSaved={() => { setModal(null); load(); }} />}
            {modal?.kind === 'give' && <GiveForm rule={modal.rule} onClose={() => { setModal(null); load(); }} />}
        </div>
    );
};

export default RulesTab;
