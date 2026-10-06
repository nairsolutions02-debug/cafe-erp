import React, { useEffect, useState } from 'react';
import { FiStar } from 'react-icons/fi';
import { getFeedbackForm, submitDishFeedback, getPortalConfig } from '../utils/api';
import './DishFeedback.css';
import useCxLang, { T } from '../lib/cxLang';

// Owner-editable texts (portal config): the English defaults the server sends. An untouched default follows the
// customer's language; a text the owner changed is shown as typed. Same rule as the Rewards page.
const DEFAULTS = {
    feedbackAsk: T('How was it? Rate each dish', 'कैसा लगा? हर डिश को रेटिंग दें', 'Kaisa laga? Har dish ko rating do'),
    feedbackThanks: T('Thank you! The kitchen reads every rating.', 'धन्यवाद! किचन हर रेटिंग पढ़ता है।', 'Thank you! Kitchen har rating padhta hai.'),
    review: T('Loved it? Tell others on Google', 'पसंद आया? Google पर बताइए', 'Pasand aaya? Google pe batao'),
};
const W = {
    tapStars: T('Tap the stars for at least one dish', 'कम से कम एक डिश के स्टार दबाएँ', 'Kam se kam ek dish ke stars dabao'),
    ratingFor: T('Rating for {name}', '{name} की रेटिंग', '{name} ki rating'),
    stars: T('{n} stars for {name}', '{name} के लिए {n} स्टार', '{name} ke liye {n} stars'),
    star: T('1 star for {name}', '{name} के लिए 1 स्टार', '{name} ke liye 1 star'),
    comment: T('Anything to tell the kitchen? (optional)', 'किचन को कुछ कहना है? (वैकल्पिक)', 'Kitchen ko kuch kehna hai? (optional)'),
    cafe: T('Cafe: {reply}', 'कैफ़े: {reply}', 'Cafe: {reply}'),
    send: T('Send ratings', 'रेटिंग भेजें', 'Rating bhejo'),
};

// After paying: rate each dish (kept inside the cafe) and the Google review link, shown to everyone
// (Google doesn't allow showing it only to happy customers).
const DishFeedback = ({ orderId }) => {
    const { lang, t } = useCxLang();
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
    const tx = (k) => {
        const own = cfg.texts?.[k];
        if (own == null || (lang !== 'en' && own === DEFAULTS[k].en)) return t(DEFAULTS[k]);
        return own;
    };
    const send = async () => {
        setError('');
        const list = Object.entries(ratings).filter(([, v]) => v.rating > 0).map(([menuItemId, v]) => ({ menuItemId, ...v }));
        if (!list.length) { setError(t(W.tapStars)); return; }
        try { await submitDishFeedback(orderId, list); setSent(true); } catch (err) { setError(err?.response?.data?.message || err.message); }
    };

    return (
        <div className="dish-feedback">
            {show.feedback && form.canRate && form.items.length > 0 && (
                <section>
                    <h3>{sent ? tx('feedbackThanks') : tx('feedbackAsk')}</h3>
                    {form.items.map(i => (
                        <div key={i.menuItemId} className="df-row">
                            <span>{i.name}</span>
                            <div className="df-stars" role="radiogroup" aria-label={t(W.ratingFor, { name: i.name })}>
                                {[1, 2, 3, 4, 5].map(n => (
                                    <button key={n} type="button" role="radio" aria-checked={ratings[i.menuItemId]?.rating === n}
                                        aria-label={t(n > 1 ? W.stars : W.star, { n, name: i.name })} disabled={sent}
                                        className={n <= (ratings[i.menuItemId]?.rating || 0) ? 'on' : ''}
                                        onClick={() => setRatings(r => ({ ...r, [i.menuItemId]: { ...r[i.menuItemId], rating: n } }))}>
                                        <FiStar />
                                    </button>
                                ))}
                            </div>
                            {!sent && ratings[i.menuItemId]?.rating > 0 && (
                                <input className="input" placeholder={t(W.comment)} value={ratings[i.menuItemId].comment}
                                    onChange={e => setRatings(r => ({ ...r, [i.menuItemId]: { ...r[i.menuItemId], comment: e.target.value } }))} />
                            )}
                            {i.reply && <p className="df-reply">{t(W.cafe, { reply: i.reply })}</p>}
                        </div>
                    ))}
                    {!sent && <button className="btn btn-primary btn-full" onClick={send}>{t(W.send)}</button>}
                    {error && <p className="error-message">{error}</p>}
                </section>
            )}
            {show.review && cfg.googleReviewUrl && (
                <a className="btn btn-secondary btn-full" href={cfg.googleReviewUrl} target="_blank" rel="noopener noreferrer">⭐ {tx('review')}</a>
            )}
        </div>
    );
};

export default DishFeedback;
