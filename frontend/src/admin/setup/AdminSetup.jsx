import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FiCheckCircle, FiCircle, FiArrowRight } from 'react-icons/fi';
import { getSettings, getSetupStatus, linkAllStaffEmployees } from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import Skeleton from '../mobile/Skeleton';
import { setupItems } from './setupItems';
import './Setup.css';

// Settings → Setup checklist: everything a new cafe needs, with a tick when done and a link to fix it
const AdminSetup = () => {
    const [settings, setSettings] = useState(null);
    const [status, setStatus] = useState(null);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const { hasPerm } = useAuth();
    const load = () => Promise.all([getSettings(), getSetupStatus()])
        .then(([a, b]) => { setSettings(a.data); setStatus(b.data); })
        .catch(err => setError(err.response?.data?.message || err.message));
    useEffect(() => { load(); }, []);
    // One tap: each unlinked login gets the employee with the same phone, or a new employee record
    const linkAll = async () => {
        setBusy(true);
        try { await linkAllStaffEmployees(); await load(); } catch (err) { alert(err.response?.data?.message || err.message); } finally { setBusy(false); }
    };

    if (error) return <div className="admin-setup"><p className="error-message">{error}</p></div>;
    if (!settings || !status) return <div className="admin-setup"><Skeleton rows={6} /></div>;
    const items = setupItems(settings, status);
    const needed = items.filter(i => !i.optional);
    const done = needed.filter(i => i.done).length;

    return (
        <div className="admin-setup">
            <div className="page-header">
                <h1>Setup checklist</h1>
                <p>{done === needed.length ? 'All the main steps are done.' : `${done} of ${needed.length} main steps done.`} Tap a step to fix it.</p>
            </div>
            <div className="setup-bar" role="progressbar" aria-valuemin={0} aria-valuemax={needed.length} aria-valuenow={done}>
                <i style={{ width: `${Math.round((done / needed.length) * 100)}%` }} />
            </div>
            <ol className="setup-list">
                {items.map(i => (
                    <li key={i.key} className={i.done ? 'done' : ''}>
                        {i.done ? <FiCheckCircle className="setup-ic ok" aria-label="Done" /> : <FiCircle className="setup-ic" aria-label="Not done" />}
                        <div>
                            <b>{i.title}{i.optional && <small> · optional</small>}</b>
                            <p>{i.why}</p>
                        </div>
                        {!i.done && (i.key === 'linked' && (status.staffUnlinked || []).length > 0 && hasPerm('employees.create')
                            ? <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={linkAll}>{busy ? 'Linking…' : 'Link them now'}</button>
                            : <Link className="btn btn-secondary btn-sm" to={i.go}>{i.action} <FiArrowRight /></Link>)}
                    </li>
                ))}
            </ol>
        </div>
    );
};

export default AdminSetup;
