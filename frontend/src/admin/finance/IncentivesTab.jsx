import React, { useCallback, useEffect, useState } from 'react';
import { FiPlus, FiEdit2, FiTrash2 } from 'react-icons/fi';
import { getIncentiveReport, saveIncentiveRule, deleteIncentiveRule, getAllMenuItems, getAllCategories, getStaff, updateSetting } from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import Modal from '../inventory/Modal';
import { inr } from '../pos/money';

const errorText = (err) => err?.response?.data?.message || err?.message || 'Something went wrong';
const KINDS = [
    { value: 'per_item', label: 'Per item sold', help: '₹ for every unit of these items sold by the staff member' },
    { value: 'upsell', label: 'Add-on (upsell)', help: '₹ per add-on sold together with another item' },
    { value: 'target', label: 'Sales target', help: 'Bonus when their sales in the period cross ₹X' },
    { value: 'pool', label: 'Team pool', help: '% of profit above the weekly target, split by hours worked' },
    { value: 'rating', label: 'Ratings', help: 'Bonus when dishes on their orders average X★ or more (min. 5 ratings)' },
];
const iso = (d) => d.toLocaleDateString('en-CA');
const blank = { name: '', kind: 'per_item', itemIds: [], categoryIds: [], staffIds: [], amount: 5, threshold: 0, percent: 2, onlyIfTargetMet: false, isActive: true };

const RuleForm = ({ rule, menu, categories, staff, onClose, onSaved }) => {
    const [f, setF] = useState(rule ? { ...blank, ...rule } : blank);
    const [error, setError] = useState('');
    const set = (k, v) => setF(x => ({ ...x, [k]: v }));
    const submit = async (e) => {
        e.preventDefault();
        try { await saveIncentiveRule(f); onSaved(); } catch (err) { setError(errorText(err)); }
    };
    const multi = (k) => (e) => set(k, [...e.target.selectedOptions].map(o => o.value));
    return (
        <Modal title={rule ? `Edit ${rule.name}` : 'New incentive'} onClose={onClose} wide>
            <form onSubmit={submit}>
                <div className="modal-body form-grid">
                    <div className="input-group"><label>Name *</label><input className="input" required value={f.name} onChange={e => set('name', e.target.value)} placeholder="dessert sold" /></div>
                    <div className="input-group"><label>Type</label>
                        <select className="input" value={f.kind} onChange={e => set('kind', e.target.value)}>{KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}</select></div>
                    <p className="muted small span-2">{KINDS.find(k => k.value === f.kind)?.help}</p>
                    {['per_item', 'upsell'].includes(f.kind) && <>
                        <div className="input-group"><label>Categories</label><select className="input" multiple size={5} value={f.categoryIds} onChange={multi('categoryIds')} aria-label="Categories">
                            {categories.map(c => <option key={c._id} value={c._id}>{c.name}</option>)}</select></div>
                        <div className="input-group"><label>…or items</label><select className="input" multiple size={5} value={f.itemIds} onChange={multi('itemIds')} aria-label="Items">
                            {menu.filter(m => !m.isRestricted).map(m => <option key={m._id} value={m._id}>{m.name}</option>)}</select></div>
                    </>}
                    {f.kind !== 'pool' && <div className="input-group"><label>{['per_item', 'upsell'].includes(f.kind) ? '₹ per unit' : 'Bonus ₹'}</label>
                        <input className="input" type="number" min="0" step="0.5" value={f.amount} onChange={e => set('amount', e.target.value)} /></div>}
                    {f.kind === 'target' && <div className="input-group"><label>Sales of at least ₹</label>
                        <input className="input" type="number" min="0" value={f.threshold} onChange={e => set('threshold', e.target.value)} /></div>}
                    {f.kind === 'rating' && <div className="input-group"><label>Average rating at least</label>
                        <input className="input" type="number" min="1" max="5" step="0.1" value={f.threshold} onChange={e => set('threshold', e.target.value)} /></div>}
                    {f.kind === 'pool' && <div className="input-group"><label>% of profit above the weekly target</label>
                        <input className="input" type="number" min="0" max="50" step="0.5" value={f.percent} onChange={e => set('percent', e.target.value)} /></div>}
                    <div className="input-group"><label>Who (none = everyone)</label><select className="input" multiple size={4} value={f.staffIds} onChange={multi('staffIds')} aria-label="Staff">
                        {staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
                    <label className="check span-2"><input type="checkbox" checked={f.onlyIfTargetMet} onChange={e => set('onlyIfTargetMet', e.target.checked)} /> Pay only in weeks that made the profit target</label>
                    <label className="check span-2"><input type="checkbox" checked={f.isActive} onChange={e => set('isActive', e.target.checked)} /> On</label>
                    <p className="muted small span-2">Restricted items never count. Sales count for the person who rang up the order.</p>
                    {error && <p className="error-message span-2">{error}</p>}
                </div>
                <div className="modal-footer">
                    <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
                    <button type="submit" className="btn btn-primary">Save</button>
                </div>
            </form>
        </Modal>
    );
};

// Incentive rules and what each staff member has earned in a period (paid with salary)
const IncentivesTab = () => {
    const { hasPerm } = useAuth();
    const now = new Date();
    const [range, setRange] = useState({ from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(now) });
    const [data, setData] = useState({ rules: [], staff: [], capPct: 0 });
    const [refs, setRefs] = useState({ menu: [], categories: [], staff: [] });
    const [modal, setModal] = useState(null);
    const [cap, setCap] = useState('');
    const canEdit = hasPerm('employees.edit');
    const load = useCallback(async () => {
        const d = (await getIncentiveReport(range.from, range.to)).data;
        setData(d);
        setCap(d.capPct || '');
    }, [range]);
    useEffect(() => { load(); }, [load]);
    useEffect(() => {
        Promise.all([getAllMenuItems(), getAllCategories(), hasPerm('staff.view') ? getStaff() : Promise.resolve({ data: { staff: [] } })])
            .then(([m, c, s]) => setRefs({ menu: m.data, categories: c.data, staff: s.data.staff || [] })).catch(() => {});
    }, [hasPerm]);
    const remove = async (r) => {
        if (!window.confirm(`Delete "${r.name}"?`)) return;
        try { await deleteIncentiveRule(r.id); load(); } catch (err) { alert(errorText(err)); }
    };
    const saveCap = async () => { try { await updateSetting('incentive_cap_pct', Number(cap) || 0); load(); } catch (err) { alert(errorText(err)); } };
    const describe = (r) => ({
        per_item: `${inr(r.amount)} per unit`, upsell: `${inr(r.amount)} per add-on`, target: `${inr(r.amount)} at ${inr(r.threshold)} sales`,
        pool: `${r.percent}% of profit above target`, rating: `${inr(r.amount)} at ${r.threshold}★`,
    }[r.kind]);

    return (
        <div>
            <div className="inv-toolbar">
                {canEdit && <button className="btn btn-primary" onClick={() => setModal({})}><FiPlus /> New incentive</button>}
                <input className="input compact" type="date" value={range.from} onChange={e => setRange({ ...range, from: e.target.value })} aria-label="From" />
                <input className="input compact" type="date" value={range.to} onChange={e => setRange({ ...range, to: e.target.value })} aria-label="To" />
            </div>
            <div className="rule-list">
                {data.rules.map(r => (
                    <div key={r.id} className={`rule-card${r.isActive ? '' : ' off'}`}>
                        <div className="rule-main"><strong>{r.name}</strong><span className="small">{KINDS.find(k => k.value === r.kind)?.label} · {describe(r)}{r.onlyIfTargetMet && ' · only if target met'}</span></div>
                        {canEdit && <div className="rule-actions">
                            <button className="icon-btn" aria-label={`Edit ${r.name}`} onClick={() => setModal({ rule: r })}><FiEdit2 /></button>
                            <button className="icon-btn danger" aria-label={`Delete ${r.name}`} onClick={() => remove(r)}><FiTrash2 /></button></div>}
                    </div>
                ))}
                {data.rules.length === 0 && <p className="muted empty">No incentives yet. Example: ₹5 per dessert sold, ₹500 when monthly sales cross ₹1.5 lakh.</p>}
            </div>
            <h3 className="section-title">Earned {range.from} → {range.to}</h3>
            <div className="table-scroll">
                <table className="staff-table">
                    <thead><tr><th>Staff</th><th>Total</th><th>How</th></tr></thead>
                    <tbody>{data.staff.map(s => (
                        <tr key={s.staffId}><td><strong>{s.name}</strong>{s.capped && <span className="pill warn">capped</span>}</td><td><strong>{inr(s.total)}</strong></td>
                            <td className="small">{s.lines.map((l, i) => <div key={i}>{l.rule}: {l.detail} = {inr(l.amount)}</div>)}</td></tr>))}
                        {data.staff.length === 0 && <tr><td colSpan={3} className="muted">Nothing earned in this period.</td></tr>}</tbody>
                </table>
            </div>
            {canEdit && (
                <div className="inv-toolbar" style={{ marginTop: 12 }}>
                    <label className="small">Cap all incentives at <input className="input compact" type="number" min="0" max="100" value={cap} onChange={e => setCap(e.target.value)} style={{ width: 70 }} /> % of gross profit (0 = no cap)</label>
                    <button className="btn btn-ghost btn-sm" onClick={saveCap}>Save cap</button>
                </div>
            )}
            <p className="muted small">Incentives are added to the payslip when you run payroll (for employees linked to an app login in Attendance).</p>
            {modal && <RuleForm rule={modal.rule} {...refs} onClose={() => setModal(null)} onSaved={() => { setModal(null); load(); }} />}
        </div>
    );
};

export default IncentivesTab;
