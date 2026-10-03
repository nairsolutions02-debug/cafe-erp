import React, { useEffect, useState } from 'react';
import { FiStar } from 'react-icons/fi';
import { getFeedbackForm, submitDishFeedback, getPortalConfig } from '../utils/api';
import './DishFeedback.css';

// After paying: rate each dish (kept inside the cafe) and the Google review link, shown to everyone
// (Google doesn't allow showing it only to happy customers).
const DishFeedback = ({ orderId }) => {
    const [form, setForm] = useState(null);
    const [cfg, setCfg] = useState(null);
    const [ratings, setRatings] = useState({});
    const [sent, setSent] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        getPortalConfig().then(r => setCfg(r.data)).catch(() => {});
        getFeedbackForm(orderId).then(r => {
            setForm(r.data);
            setRatings(Object.fromEntries(r.data.items.map(i => [i.menuItemId, { rating: i.rating || 0, comment: i.comment || '' }])));
            setSent(r.data.items.some(i => i.rating));
        }).catch(() => {});
    }, [orderId]);

    if (!form || !cfg) return null;
    const show = cfg.show;
    const send = async () => {
        setError('');
        const list = Object.entries(ratings).filter(([, v]) => v.rating > 0).map(([menuItemId, v]) => ({ menuItemId, ...v }));
        if (!list.length) { setError('Tap the stars for at least one dish'); return; }
        try { await submitDishFeedback(orderId, list); setSent(true); } catch (err) { setError(err?.response?.data?.message || err.message); }
    };

    return (
        <div className="dish-feedback">
            {show.feedback && form.canRate && form.items.length > 0 && (
                <section>
                    <h3>{sent ? cfg.texts.feedbackThanks : cfg.texts.feedbackAsk}</h3>
                    {form.items.map(i => (
                        <div key={i.menuItemId} className="df-row">
                            <span>{i.name}</span>
                            <div className="df-stars" role="radiogroup" aria-label={`Rating for ${i.name}`}>
                                {[1, 2, 3, 4, 5].map(n => (
                                    <button key={n} type="button" role="radio" aria-checked={ratings[i.menuItemId]?.rating === n}
                                        aria-label={`${n} star${n > 1 ? 's' : ''} for ${i.name}`} disabled={sent}
                                        className={n <= (ratings[i.menuItemId]?.rating || 0) ? 'on' : ''}
                                        onClick={() => setRatings(r => ({ ...r, [i.menuItemId]: { ...r[i.menuItemId], rating: n } }))}>
                                        <FiStar />
                                    </button>
                                ))}
                            </div>
                            {!sent && ratings[i.menuItemId]?.rating > 0 && (
                                <input className="input" placeholder="Anything to tell the kitchen? (optional)" value={ratings[i.menuItemId].comment}
                                    onChange={e => setRatings(r => ({ ...r, [i.menuItemId]: { ...r[i.menuItemId], comment: e.target.value } }))} />
                            )}
                            {i.reply && <p className="df-reply">Cafe: {i.reply}</p>}
                        </div>
                    ))}
                    {!sent && <button className="btn btn-primary btn-full" onClick={send}>Send ratings</button>}
                    {error && <p className="error-message">{error}</p>}
                </section>
            )}
            {show.review && cfg.googleReviewUrl && (
                <a className="btn btn-secondary btn-full" href={cfg.googleReviewUrl} target="_blank" rel="noopener noreferrer">⭐ {cfg.texts.review}</a>
            )}
        </div>
    );
};

export default DishFeedback;
