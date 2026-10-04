import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePortal } from '../../context/PortalContext';
import { useAuth } from '../../context/AuthContext';
import { getMyRewards } from '../../utils/api';
import InfoTip from './InfoTip';

// "2 more orders to a free coffee" with a progress ring; also nudges once when the customer is one step away
const RewardBar = () => {
    const { show, nudge } = usePortal();
    const { isAuthenticated, isAdmin } = useAuth();
    const [r, setR] = useState(null);
    useEffect(() => {
        if (!isAuthenticated || isAdmin) return;
        getMyRewards().then(res => setR(res.data)).catch(() => {});
    }, [isAuthenticated, isAdmin]);

    const p = (r?.progress || []).slice().sort((a, b) => a.left / a.target - b.left / b.target)[0];
    useEffect(() => {
        if (p && p.unit === 'orders' && p.left === 1 && show('nudgeMilestone')) {
            nudge({ kind: 'almost', icon: '🎁', text: `Just 1 more order to ${p.reward}!` });
        }
    }, [p?.left, p?.reward]); // eslint-disable-line react-hooks/exhaustive-deps

    if (!show('rewardBar') || !p) return null;
    const pct = Math.min(1, Math.max(0, p.done / p.target));
    const C = 2 * Math.PI * 18;
    return (
        <Link to="/rewards" className="reward-bar">
            <svg className="reward-ring" viewBox="0 0 44 44" aria-hidden="true">
                <circle cx="22" cy="22" r="18" className="ring-bg" />
                <circle cx="22" cy="22" r="18" className="ring-fg" strokeDasharray={C} strokeDashoffset={C * (1 - pct)} />
                <text x="22" y="26" textAnchor="middle">{p.unit === 'orders' ? `${p.done}/${p.target}` : `${Math.round(pct * 100)}%`}</text>
            </svg>
            <span className="reward-copy">
                <strong>{p.leftLabel} to {p.reward}</strong>
                <small>{r.points != null ? `${r.points} points · ` : ''}Tap to see your rewards</small>
            </span>
            <span onClick={(e) => e.preventDefault()}>
                <InfoTip label="How rewards work">Every paid order counts. Rewards appear here and on the Rewards page, and you can use points at checkout.</InfoTip>
            </span>
        </Link>
    );
};

export default RewardBar;
