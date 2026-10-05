import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getSettings, getSetupStatus } from '../../utils/api';
import { setupItems } from './setupItems';

// Dashboard strip for people who can change settings, until the main setup steps are done
const SetupNudge = () => {
    const [left, setLeft] = useState(null);
    useEffect(() => {
        Promise.all([getSettings(), getSetupStatus()])
            .then(([a, b]) => setLeft(setupItems(a.data, b.data).filter(i => !i.optional && !i.done)))
            .catch(() => {});
    }, []);
    if (!left || left.length === 0) return null;
    return (
        <Link to="/admin/setup" className="setup-warn setup-nudge">
            <b>Setup: {left.length} step{left.length === 1 ? '' : 's'} left</b> · {left.slice(0, 2).map(i => i.title).join(', ')}{left.length > 2 ? '…' : ''} → Open the checklist
        </Link>
    );
};

export default SetupNudge;
