import React, { useCallback, useEffect, useState } from 'react';
import { FiInstagram } from 'react-icons/fi';
import { getInstagramQueue, decideInstagram, customerPhotoUrl, purgeOldSelfies } from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import { errorText, fmtDateTime } from '../inventory/shared';

const Selfie = ({ path }) => {
    const [url, setUrl] = useState(null);
    useEffect(() => { if (path) customerPhotoUrl(path).then(setUrl); }, [path]);
    if (!path) return <div className="ig-selfie gone">Selfie deleted</div>;
    return url ? <a href={url} target="_blank" rel="noopener noreferrer"><img className="ig-selfie" src={url} alt="Customer selfie" /></a> : <div className="ig-selfie" />;
};

// Verifier queue: selfie + handle + profile link → Approve (reward rules for Instagram) or Reject with a reason
const InstagramTab = () => {
    const { hasPerm } = useAuth();
    const [status, setStatus] = useState('pending');
    const [list, setList] = useState([]);
    const [msg, setMsg] = useState('');
    const load = useCallback(async () => setList((await getInstagramQueue(status)).data), [status]);
    useEffect(() => { load(); }, [load]);
    useEffect(() => { if (hasPerm('customers.edit')) purgeOldSelfies().catch(() => {}); }, [hasPerm]);
    const decide = async (c, approve) => {
        const reason = approve ? '' : window.prompt('Why? (the customer sees this)', 'Tag not found on your profile');
        if (!approve && !reason) return;
        try {
            const r = (await decideInstagram(c.id, approve, reason)).data;
            setMsg(approve ? (r.granted ? `Approved — ${r.granted} reward given.` : `Approved. No reward: ${r.note || 'no Instagram rule is on'}.`) : 'Rejected.');
            load();
        } catch (err) { setMsg(errorText(err)); }
    };
    return (
        <div>
            <div className="inv-toolbar">
                <select className="input compact" value={status} onChange={e => setStatus(e.target.value)} aria-label="Show">
                    <option value="pending">Waiting</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="all">All</option>
                </select>
                <span className="muted small">Selfies are deleted automatically after 30 days.</span>
            </div>
            {msg && <p className="small">{msg}</p>}
            <div className="ig-list">
                {list.map(c => (
                    <div key={c.id} className="ig-card">
                        <Selfie path={c.selfiePath} />
                        <div className="ig-info">
                            <a href={`https://instagram.com/${c.handle}`} target="_blank" rel="noopener noreferrer"><FiInstagram /> @{c.handle}</a>
                            <span className="small">{c.customer.name || 'Customer'} · {c.kind === 'follow' ? 'followed' : 'tagged'} · {fmtDateTime(c.createdAt)}</span>
                            {c.earlier > 0 && <span className="muted small">{c.earlier} approved before</span>}
                            {c.status !== 'pending' && <span className={`pill ${c.status === 'approved' ? 'ok' : 'warn'}`}>{c.status}{c.reason && `: ${c.reason}`} · {c.decidedBy}</span>}
                            {c.status === 'pending' && hasPerm('customers.edit') && (
                                <div className="btn-row">
                                    <button className="btn btn-primary btn-sm" onClick={() => decide(c, true)}>Approve</button>
                                    <button className="btn btn-ghost btn-sm" onClick={() => decide(c, false)}>Reject</button>
                                </div>
                            )}
                        </div>
                    </div>
                ))}
                {list.length === 0 && <p className="muted empty">Nothing waiting.</p>}
            </div>
        </div>
    );
};

export default InstagramTab;
