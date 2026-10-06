import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePortal } from '../../context/PortalContext';
import { useAuth } from '../../context/AuthContext';
import { getMyRewards } from '../../utils/api';
import InfoTip from './InfoTip';
import useCxLang, { T, sayReward } from '../../lib/cxLang';

// English uses the server's own label ("2 more orders", "₹150 more"); Hindi and Hinglish build it from the numbers
const W = {
    almost: T('Just 1 more order to {reward}!', 'बस 1 और ऑर्डर, फिर {reward}!', 'Bas 1 aur order, phir {reward}!'),
    goalOrders: T('{left} to {reward}', 'बस {n} और ऑर्डर, फिर {reward}', 'Bas {n} aur order, phir {reward}'),
    goalSpend: T('{left} to {reward}', 'बस {amt} और, फिर {reward}', 'Bas {amt} aur, phir {reward}'),
    points: T('{n} points · ', '{n} पॉइंट · ', '{n} points · '),
    tap: T('Tap to see your rewards', 'अपने रिवॉर्ड देखने के लिए टैप करें', 'Rewards dekhne ke liye tap karo'),
    how: T('How rewards work', 'रिवॉर्ड कैसे मिलते हैं', 'Rewards kaise milte hain'),
    howText: T('Every paid order counts. Rewards appear here and on the Rewards page, and you can use points at checkout.',
        'हर पेमेंट वाला ऑर्डर गिना जाता है। रिवॉर्ड यहाँ और रिवॉर्ड पेज पर दिखते हैं, और पॉइंट आप पेमेंट के समय इस्तेमाल कर सकते हैं।',
        'Har paid order count hota hai. Rewards yahan aur Rewards page pe dikhte hain, aur points aap payment ke time use kar sakte ho.'),
};

// "2 more orders to a free coffee" with a progress ring; also nudges once when the customer is one step away
const RewardBar = () => {
    const { show, nudge } = usePortal();
    const { isAuthenticated, isAdmin } = useAuth();
    const { lang, t } = useCxLang();
    const [r, setR] = useState(null);
    useEffect(() => {
        if (!isAuthenticated || isAdmin) return;
        getMyRewards().then(res => setR(res.data)).catch(() => {});
    }, [isAuthenticated, isAdmin]);

    const p = (r?.progress || []).slice().sort((a, b) => a.left / a.target - b.left / b.target)[0];
    useEffect(() => {
        if (p && p.unit === 'orders' && p.left === 1 && show('nudgeMilestone')) {
            nudge({ kind: 'almost', icon: '🎁', text: t(W.almost, { reward: sayReward(p.reward, lang) }) });
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
                <strong>{t(p.unit === 'orders' ? W.goalOrders : W.goalSpend, { left: p.leftLabel, n: p.left, amt: `₹${Math.round(Number(p.left) || 0).toLocaleString('en-IN')}`, reward: sayReward(p.reward, lang) })}</strong>
                <small>{r.points != null ? t(W.points, { n: r.points }) : ''}{t(W.tap)}</small>
            </span>
            <span onClick={(e) => e.preventDefault()}>
                <InfoTip label={t(W.how)}>{t(W.howText)}</InfoTip>
            </span>
        </Link>
    );
};

export default RewardBar;
