import React, { useEffect, useState, useCallback } from 'react';
import { FiPlus, FiKey, FiSliders, FiFileText, FiTrash2, FiLock } from 'react-icons/fi';
import {
    getStaff, createStaff, setStaffPin, updateStaff, setStaffOverride,
    getRoles, createRole, updateRole, deleteRole, setRolePermission, getTermsText,
} from '../utils/api';
import { useAuth } from '../context/AuthContext';
import { MODULES, ACTIONS, MODULE_ACTIONS, SENSITIVE } from '../lib/permissions';
import './AdminStaff.css';

const randomPin = () => String(Math.floor(1000 + Math.random() * 9000));
const errorText = (err, fallback) => err.response?.data?.message || fallback;
const fmt = (d) => (d ? new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

const allPerms = () => [
    ...MODULES.flatMap(m => (MODULE_ACTIONS[m.key] || ACTIONS.map(a => a.key)).map(a => ({
        key: `${m.key}.${a}`, label: `${m.label}: ${ACTIONS.find(x => x.key === a).label}` }))),
    ...SENSITIVE,
];

// ---------------------------------------------------------------------------
// Roles & permission grid
// ---------------------------------------------------------------------------
const RolesPanel = ({ roles, reload, canEdit }) => {
    const [selectedId, setSelectedId] = useState(null);
    const [newRole, setNewRole] = useState('');
    const role = roles.find(r => r._id === selectedId) || roles[0];

    const toggle = async (perm, on) => {
        try {
            await setRolePermission(role._id, perm, on);
            await reload();
        } catch (err) {
            alert(errorText(err, 'Could not update permission'));
        }
    };

    const addRole = async (e) => {
        e.preventDefault();
        if (!newRole.trim()) return;
        try {
            const res = await createRole({ name: newRole.trim() });
            setNewRole('');
            await reload();
            setSelectedId(res.data._id);
        } catch (err) {
            alert(errorText(err, 'Could not add role'));
        }
    };

    const rename = async () => {
        const name = window.prompt('Role name', role.name);
        if (!name || name === role.name) return;
        try {
            await updateRole(role._id, { name, description: role.description });
            await reload();
        } catch (err) {
            alert(errorText(err, 'Could not rename'));
        }
    };

    const remove = async () => {
        if (!window.confirm(`Delete the role "${role.name}"? Staff must be moved to another role first.`)) return;
        try {
            await deleteRole(role._id);
            setSelectedId(null);
            await reload();
        } catch (err) {
            alert(errorText(err, 'Could not delete. Move its staff to another role first.'));
        }
    };

    if (!role) return null;
    const has = (perm) => role.isOwner || role.permissions.includes(perm);
    const locked = role.isOwner || !canEdit;

    return (
        <div className="roles-panel">
            <aside className="roles-list">
                {roles.map(r => (
                    <button key={r._id} className={r._id === role._id ? 'active' : ''} onClick={() => setSelectedId(r._id)}>
                        <span>{r.name}</span>
                        <small>{r.isOwner ? 'everything' : `${r.permissions.length} permissions`}</small>
                    </button>
                ))}
                {canEdit && (
                    <form onSubmit={addRole} className="add-role">
                        <input className="input" value={newRole} onChange={e => setNewRole(e.target.value)} placeholder="New role name" />
                        <button className="btn btn-primary" type="submit"><FiPlus /></button>
                    </form>
                )}
            </aside>

            <section className="perm-grid-wrap">
                <div className="perm-grid-head">
                    <div>
                        <h3>{role.name}</h3>
                        {role.isOwner
                            ? <p className="muted"><FiLock /> The Owner role always has every permission and can't be changed.</p>
                            : <p className="muted">Tick what this role can do. Changes apply on the staff member's next screen load.</p>}
                    </div>
                    {canEdit && !role.isOwner && (
                        <div className="row-actions">
                            <button className="btn btn-ghost" onClick={rename}>Rename</button>
                            <button className="btn btn-ghost danger" onClick={remove}><FiTrash2 /> Delete</button>
                        </div>
                    )}
                </div>

                <div className="table-scroll">
                    <table className="perm-grid">
                        <thead>
                            <tr>
                                <th>Section</th>
                                {ACTIONS.map(a => <th key={a.key}>{a.label}</th>)}
                            </tr>
                        </thead>
                        <tbody>
                            {MODULES.map(m => {
                                const allowed = MODULE_ACTIONS[m.key] || ACTIONS.map(a => a.key);
                                return (
                                    <tr key={m.key}>
                                        <td>{m.label}</td>
                                        {ACTIONS.map(a => (
                                            <td key={a.key}>
                                                {allowed.includes(a.key) ? (
                                                    <input type="checkbox" aria-label={`${m.label} ${a.label}`}
                                                        checked={has(`${m.key}.${a.key}`)} disabled={locked}
                                                        onChange={e => toggle(`${m.key}.${a.key}`, e.target.checked)} />
                                                ) : <span className="na">—</span>}
                                            </td>
                                        ))}
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                <h4>Sensitive data and actions</h4>
                <div className="sensitive-list">
                    {SENSITIVE.map(s => (
                        <label key={s.key}>
                            <input type="checkbox" checked={has(s.key)} disabled={locked}
                                onChange={e => toggle(s.key, e.target.checked)} />
                            {s.label}
                        </label>
                    ))}
                </div>
            </section>
        </div>
    );
};

// ---------------------------------------------------------------------------
// Per-person overrides
// ---------------------------------------------------------------------------
const OverridesModal = ({ person, role, onClose, reload }) => {
    const [overrides, setOverrides] = useState(person.overrides || {});
    const set = async (perm, value) => {
        try {
            await setStaffOverride(person._id, perm, value);
            const next = { ...overrides };
            if (value === null) delete next[perm]; else next[perm] = value;
            setOverrides(next);
            reload();
        } catch (err) {
            alert(errorText(err, 'Could not save'));
        }
    };
    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal wide" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Exceptions for {person.name}</h2>
                    <button className="modal-close" onClick={onClose}>×</button>
                </div>
                <div className="modal-body">
                    <p className="muted">Normally {person.name} gets exactly what the <strong>{person.roleName}</strong> role allows.
                        Set an exception only where this one person should differ.</p>
                    <div className="override-list">
                        {allPerms().map(p => {
                            const fromRole = role?.isOwner || role?.permissions.includes(p.key);
                            const value = overrides[p.key];
                            return (
                                <div key={p.key} className={`override-row ${value !== undefined ? 'changed' : ''}`}>
                                    <span>{p.label}</span>
                                    <select className="input" value={value === undefined ? 'role' : value ? 'allow' : 'deny'}
                                        onChange={e => set(p.key, e.target.value === 'role' ? null : e.target.value === 'allow')}>
                                        <option value="role">As role ({fromRole ? 'allowed' : 'not allowed'})</option>
                                        <option value="allow">Allow</option>
                                        <option value="deny">Deny</option>
                                    </select>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
};

// ---------------------------------------------------------------------------
// Printable consent record
// ---------------------------------------------------------------------------
const ConsentModal = ({ person, onClose }) => {
    const [terms, setTerms] = useState(null);
    useEffect(() => {
        getTermsText('staff', person.acceptedTerms.version).then(r => setTerms(r.data)).catch(() => setTerms(null));
    }, [person]);
    return (
        <div className="modal-overlay consent-print" onClick={onClose}>
            <div className="modal wide" onClick={e => e.stopPropagation()}>
                <div className="modal-header no-print">
                    <h2>Consent record</h2>
                    <button className="modal-close" onClick={onClose}>×</button>
                </div>
                <div className="modal-body consent-doc">
                    <h2>{terms?.title || 'Staff terms and consent'}</h2>
                    <p className="muted">Version {person.acceptedTerms.version}</p>
                    <div className="terms-text">{terms?.body || 'Loading…'}</div>
                    <table className="consent-meta">
                        <tbody>
                            <tr><th>Accepted by</th><td>{person.name}</td></tr>
                            <tr><th>Mobile</th><td>{person.phone}</td></tr>
                            <tr><th>Accepted at</th><td>{fmt(person.acceptedTerms.at)}</td></tr>
                            <tr><th>Method</th><td>In-app "I agree" after PIN login</td></tr>
                        </tbody>
                    </table>
                </div>
                <div className="modal-footer no-print">
                    <button className="btn btn-primary" onClick={() => window.print()}>Print / Save as PDF</button>
                </div>
            </div>
        </div>
    );
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
const AdminStaff = () => {
    const { hasPerm, user } = useAuth();
    const [tab, setTab] = useState('staff');
    const [data, setData] = useState({ staff: [], usage: null });
    const [roles, setRoles] = useState([]);
    const [loading, setLoading] = useState(true);
    const [form, setForm] = useState({ name: '', phone: '', roleId: '', pin: randomPin() });
    const [showAdd, setShowAdd] = useState(false);
    const [overridesFor, setOverridesFor] = useState(null);
    const [consentFor, setConsentFor] = useState(null);
    const [error, setError] = useState('');

    const reload = useCallback(async () => {
        const [s, r] = await Promise.all([getStaff(), getRoles()]);
        setData(s.data);
        setRoles(r.data);
    }, []);

    useEffect(() => {
        reload().catch(err => setError(errorText(err, 'Could not load staff'))).finally(() => setLoading(false));
    }, [reload]);

    const canEdit = hasPerm('staff.edit');
    const usage = data.usage;
    const full = usage && usage.active >= usage.max;

    const add = async (e) => {
        e.preventDefault();
        setError('');
        try {
            await createStaff(form);
            alert(`Added ${form.name}. Their login: mobile ${form.phone}, PIN ${form.pin}. Share the PIN privately.\n\nThey are also listed under Team → Employees (for attendance and pay): add their salary there.`);
            setForm({ name: '', phone: '', roleId: '', pin: randomPin() });
            setShowAdd(false);
            await reload();
        } catch (err) {
            setError(errorText(err, 'Could not add staff member'));
        }
    };

    const resetPin = async (person) => {
        const pin = window.prompt(`New 4–6 digit PIN for ${person.name}`, randomPin());
        if (!pin) return;
        try {
            await setStaffPin(person._id, pin);
            alert(`PIN updated. ${person.name} has been signed out of all devices.`);
            await reload();
        } catch (err) {
            alert(errorText(err, 'Could not reset PIN'));
        }
    };

    const patch = async (person, change) => {
        try {
            await updateStaff(person._id, change);
            await reload();
        } catch (err) {
            alert(errorText(err, 'Could not update'));
        }
    };

    if (loading) return <div className="admin-loading"><div className="spinner"></div></div>;

    return (
        <div className="admin-staff">
            <div className="page-header">
                <div>
                    <h1>Staff &amp; Roles</h1>
                    {usage && (
                        <p className={`usage ${full ? 'full' : ''}`}>
                            {usage.active} of {usage.max} staff users on the {usage.plan} plan
                            {full && ' · limit reached, ask N.A.I.R. Solutions to upgrade'}
                        </p>
                    )}
                </div>
                {tab === 'staff' && hasPerm('staff.create') && (
                    <button className="btn btn-primary" disabled={full} onClick={() => setShowAdd(true)}>
                        <FiPlus /> Add staff
                    </button>
                )}
            </div>

            <div className="tabs">
                <button className={tab === 'staff' ? 'active' : ''} onClick={() => setTab('staff')}>Staff</button>
                <button className={tab === 'roles' ? 'active' : ''} onClick={() => setTab('roles')}>Roles &amp; permissions</button>
            </div>

            {error && <p className="error-message">{error}</p>}

            {tab === 'staff' ? (
                <div className="table-scroll">
                    <table className="staff-table staff-cards">
                        <thead>
                            <tr>
                                <th>Name</th><th>Mobile</th><th>Role</th><th>Status</th><th>Last login</th><th>Consent</th><th></th>
                            </tr>
                        </thead>
                        <tbody>
                            {data.staff.map(p => {
                                const self = p._id === user?.staffId;
                                return (
                                    <tr key={p._id} className={p.isActive ? '' : 'inactive'}>
                                        <td data-label="Name">
                                            <strong>{p.name}</strong>
                                            {Object.keys(p.overrides || {}).length > 0 && <span className="pill">exceptions</span>}
                                        </td>
                                        <td data-label="Mobile">{p.phone}</td>
                                        <td data-label="Role">
                                            {canEdit && !self ? (
                                                <select className="input compact" value={p.roleId} onChange={e => patch(p, { roleId: e.target.value })}>
                                                    {roles.map(r => <option key={r._id} value={r._id}>{r.name}</option>)}
                                                </select>
                                            ) : p.roleName}
                                        </td>
                                        <td data-label="Status">
                                            {canEdit && !self ? (
                                                <button className={`status-chip ${p.isActive ? 'on' : 'off'}`}
                                                    onClick={() => patch(p, { isActive: !p.isActive })}>
                                                    {p.isActive ? 'Active' : 'Disabled'}
                                                </button>
                                            ) : (p.isActive ? 'Active' : 'Disabled')}
                                            {p.lockedUntil && new Date(p.lockedUntil) > new Date() && <span className="pill warn">PIN locked</span>}
                                        </td>
                                        <td data-label="Last login">{fmt(p.lastLoginAt)}</td>
                                        <td data-label="Consent">
                                            {p.acceptedTerms
                                                ? <button className="link-btn" onClick={() => setConsentFor(p)}><FiFileText /> v{p.acceptedTerms.version}</button>
                                                : <span className="muted">Not yet</span>}
                                        </td>
                                        <td className="row-actions">
                                            {canEdit && (
                                                <>
                                                    <button className="icon-btn" title="Reset PIN" aria-label="Reset PIN" onClick={() => resetPin(p)}><FiKey /></button>
                                                    {!self && <button className="icon-btn" title="Exceptions" aria-label="Exceptions" onClick={() => setOverridesFor(p)}><FiSliders /></button>}
                                                </>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                    {data.staff.length === 0 && <p className="muted empty">No staff yet. Add your first team member.</p>}
                </div>
            ) : (
                <RolesPanel roles={roles} reload={reload} canEdit={canEdit} />
            )}

            {showAdd && (
                <div className="modal-overlay" onClick={() => setShowAdd(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Add staff</h2>
                            <button className="modal-close" onClick={() => setShowAdd(false)}>×</button>
                        </div>
                        <form onSubmit={add}>
                            <div className="modal-body">
                                <div className="input-group">
                                    <label>Name *</label>
                                    <input className="input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required />
                                </div>
                                <div className="input-group">
                                    <label>Mobile (their login) *</label>
                                    <input className="input" inputMode="numeric" value={form.phone}
                                        onChange={e => setForm({ ...form, phone: e.target.value.replace(/\D/g, '').slice(0, 10) })} required />
                                </div>
                                <div className="input-group">
                                    <label>Role *</label>
                                    <select className="input" value={form.roleId} onChange={e => setForm({ ...form, roleId: e.target.value })} required>
                                        <option value="">Choose a role</option>
                                        {roles.filter(r => !r.isOwner || user?.isOwner).map(r => <option key={r._id} value={r._id}>{r.name}</option>)}
                                    </select>
                                </div>
                                <div className="input-group">
                                    <label>PIN (4–6 digits) *</label>
                                    <div className="pin-row">
                                        <input className="input" inputMode="numeric" value={form.pin}
                                            onChange={e => setForm({ ...form, pin: e.target.value.replace(/\D/g, '').slice(0, 6) })} required />
                                        <button type="button" className="btn btn-ghost" onClick={() => setForm({ ...form, pin: randomPin() })}>New PIN</button>
                                    </div>
                                </div>
                                {error && <p className="error-message">{error}</p>}
                            </div>
                            <div className="modal-footer">
                                <button type="button" className="btn btn-ghost" onClick={() => setShowAdd(false)}>Cancel</button>
                                <button type="submit" className="btn btn-primary">Add</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {overridesFor && (
                <OverridesModal person={overridesFor} role={roles.find(r => r._id === overridesFor.roleId)}
                    onClose={() => setOverridesFor(null)} reload={reload} />
            )}
            {consentFor && <ConsentModal person={consentFor} onClose={() => setConsentFor(null)} />}
        </div>
    );
};

export default AdminStaff;
