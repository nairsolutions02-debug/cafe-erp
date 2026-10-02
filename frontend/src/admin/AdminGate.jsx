import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { acceptTerms } from '../utils/api';
import './AdminGate.css';

// Before the admin panel: unaccepted terms must be accepted, and a locked cafe sees why.
const AdminGate = ({ children }) => {
    const { user, refreshUser, logout } = useAuth();
    const [agreeing, setAgreeing] = useState(false);
    const [checked, setChecked] = useState(false);
    const [error, setError] = useState('');

    if (user?.tenant?.status === 'locked') {
        return (
            <div className="gate-page">
                <div className="gate-card">
                    <h1>Account locked</h1>
                    <p>This cafe's subscription is unpaid, so the system is locked. Your data is safe.</p>
                    <p>Please contact N.A.I.R. Solutions to renew. Access comes back as soon as the payment is recorded.</p>
                    <button className="btn btn-ghost" onClick={logout}>Log out</button>
                </div>
            </div>
        );
    }

    const terms = user?.pendingTerms;
    if (terms) {
        const agree = async () => {
            setAgreeing(true);
            setError('');
            try {
                await acceptTerms(terms.kind, terms.version);
                await refreshUser();
            } catch (err) {
                setError(err.response?.data?.message || 'Could not save. Try again.');
            } finally {
                setAgreeing(false);
            }
        };
        return (
            <div className="gate-page">
                <div className="gate-card terms">
                    <h1>{terms.title}</h1>
                    <p className="gate-sub">Version {terms.version} · please read and accept to continue</p>
                    <div className="terms-body">{terms.body}</div>
                    <label className="terms-check">
                        <input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} />
                        I, {user.name}, have read and agree to these terms.
                    </label>
                    {error && <p className="error-message">{error}</p>}
                    <div className="gate-actions">
                        <button className="btn btn-ghost" onClick={logout}>Log out</button>
                        <button className="btn btn-primary" disabled={!checked || agreeing} onClick={agree}>
                            {agreeing ? 'Saving…' : 'I agree'}
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return children;
};

export default AdminGate;
