import React, { useCallback, useEffect, useState } from 'react';
import { getNotificationMatrix, setNotificationPref, setQuietHours } from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import '../AdminStaff.css';
import '../inventory/Inventory.css';
import './StaffApp.css';
import InfoTip from '../help/InfoTip';

const STYLES = [
    { value: 'alarm', label: 'Alarm (full screen)' },
    { value: 'loud', label: 'Loud' },
    { value: 'normal', label: 'Normal' },
    { value: 'off', label: 'Off' },
];
const errorText = (err) => err?.response?.data?.message || err?.message || 'Something went wrong';

// Who gets which alert, and how loudly; quiet hours per person
const AdminAlerts = () => {
    const { hasPerm } = useAuth();
    const [m, setM] = useState(null);
    const [msg, setMsg] = useState('');
    const canEdit = hasPerm('staff.edit');

    const load = useCallback(async () => {
        try { setM((await getNotificationMatrix()).data); } catch (err) { setMsg(errorText(err)); }
    }, []);
    useEffect(() => { load(); }, [load]);

    const setPref = async (person, kind, style) => {
        try {
            await setNotificationPref(person, kind, style);
            setM(cur => ({ ...cur, prefs: { ...cur.prefs, [`${person}|${kind}`]: style } }));
        } catch (err) { setMsg(errorText(err)); }
    };
    const setQuiet = async (person, from, to) => {
        try {
            await setQuietHours(person, from, to);
            setM(cur => ({ ...cur, quiet: { ...cur.quiet, [person]: { from, to } } }));
        } catch (err) { setMsg(errorText(err)); }
    };

    if (!m) return <div className="inv">{msg || 'Loading…'}</div>;
    return (
        <div className="inv alerts-page">
            <div className="page-header">
                <h1>Alerts</h1>
                <p>Choose who hears which alert and how. <strong>Alarm</strong> takes over the screen and rings until someone acknowledges.
                    During quiet hours only order and payment alarms ring.</p>
            </div>
            {msg && <p className="error-message">{msg}</p>}
            <div className="table-scroll">
                <table className="staff-table alerts-matrix">
                    <thead>
                        <tr><th>Alert<InfoTip k="alert_style" /></th>{m.people.map(p => <th key={p.person}>{p.name}<div className="muted small">{p.role}</div></th>)}</tr>
                    </thead>
                    <tbody>
                        {m.kinds.map(k => (
                            <tr key={k.kind}>
                                <td><strong>{k.label}</strong><div className="muted small">default: {k.default}</div></td>
                                {m.people.map(p => (
                                    <td key={p.person}>
                                        <select className="input compact" disabled={!canEdit} aria-label={`${k.label} for ${p.name}`}
                                            value={m.prefs[`${p.person}|${k.kind}`] || ''} onChange={e => setPref(p.person, k.kind, e.target.value)}>
                                            <option value="">Default</option>
                                            {STYLES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                                        </select>
                                    </td>
                                ))}
                            </tr>
                        ))}
                        <tr>
                            <td><strong>Quiet hours</strong><InfoTip k="quiet_hours" /></td>
                            {m.people.map(p => {
                                const q = m.quiet[p.person] || {};
                                return (
                                    <td key={p.person} className="quiet-cell">
                                        <input className="input compact" type="time" disabled={!canEdit} value={q.from || ''} aria-label={`Quiet from for ${p.name}`}
                                            onChange={e => setQuiet(p.person, e.target.value, q.to)} />
                                        <input className="input compact" type="time" disabled={!canEdit} value={q.to || ''} aria-label={`Quiet to for ${p.name}`}
                                            onChange={e => setQuiet(p.person, q.from, e.target.value)} />
                                    </td>
                                );
                            })}
                        </tr>
                    </tbody>
                </table>
            </div>
            <p className="muted small">People only get alerts their role can see (a cashier never gets payroll alerts). Phone alerts while the app is closed need
                each person to tap <strong>My day → Turn on alerts</strong> once.</p>
        </div>
    );
};

export default AdminAlerts;
