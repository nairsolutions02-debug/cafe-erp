import React, { useCallback, useEffect, useState } from 'react';
import { FiEyeOff, FiEye } from 'react-icons/fi';
import { getFeedbackOverview, moderateFeedback } from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import { errorText, fmtDateTime } from '../inventory/shared';

const iso = (d) => d.toLocaleDateString('en-CA');
const stars = (n) => '★'.repeat(Math.round(n)) + '☆'.repeat(5 - Math.round(n));

// Ratings per dish (lowest first) and comments to reply to or hide. Feedback stays inside the cafe.
const FeedbackTab = () => {
    const { hasPerm } = useAuth();
    const [range, setRange] = useState({ from: iso(new Date(Date.now() - 29 * 864e5)), to: iso(new Date()) });
    const [data, setData] = useState({ dishes: [], comments: [] });
    const load = useCallback(async () => setData((await getFeedbackOverview(range.from, range.to)).data), [range]);
    useEffect(() => { load(); }, [load]);
    const reply = async (c) => {
        const text = window.prompt(`Reply to ${c.customer} (shown on their order)`, c.reply || '');
        if (text === null) return;
        try { await moderateFeedback(c.id, text, null); load(); } catch (err) { alert(errorText(err)); }
    };
    const hide = async (c) => { try { await moderateFeedback(c.id, null, !c.hidden); load(); } catch (err) { alert(errorText(err)); } };
    return (
        <div>
            <div className="inv-toolbar">
                <input className="input compact" type="date" value={range.from} onChange={e => setRange({ ...range, from: e.target.value })} aria-label="From" />
                <input className="input compact" type="date" value={range.to} onChange={e => setRange({ ...range, to: e.target.value })} aria-label="To" />
            </div>
            <div className="table-scroll">
                <table className="staff-table">
                    <thead><tr><th>Dish</th><th>Average</th><th>Ratings</th><th>1–2★</th></tr></thead>
                    <tbody>{data.dishes.map(d => (
                        <tr key={d.menuItemId} className={Number(d.avg) < 3.5 ? 'row-warn' : ''}>
                            <td><strong>{d.name}</strong></td><td><span className="stars">{stars(d.avg)}</span> {Number(d.avg).toFixed(1)}</td><td>{d.ratings}</td><td>{d.low}</td>
                        </tr>))}
                        {data.dishes.length === 0 && <tr><td colSpan={4} className="muted">No ratings in this period.</td></tr>}</tbody>
                </table>
            </div>
            <h3 className="section-title">Comments and low ratings</h3>
            <div className="todo-list">
                {data.comments.map(c => (
                    <div key={c.id} className={`todo-card${c.hidden ? ' off' : ''}`}>
                        <div>
                            <strong>{c.dish}</strong> <span className="stars">{stars(c.rating)}</span> <span className="muted small">{c.customer} · {c.orderNumber} · {fmtDateTime(c.createdAt)}</span>
                            {c.comment && <p className="todo-msg">“{c.comment}”</p>}
                            {c.reply && <p className="small">↳ {c.reply} <span className="muted">— {c.repliedBy}</span></p>}
                        </div>
                        {hasPerm('customers.edit') && (
                            <div className="todo-actions">
                                <button className="btn btn-ghost btn-sm" onClick={() => reply(c)}>Reply</button>
                                <button className="icon-btn" aria-label={c.hidden ? 'Show' : 'Hide'} onClick={() => hide(c)}>{c.hidden ? <FiEye /> : <FiEyeOff />}</button>
                            </div>
                        )}
                    </div>
                ))}
                {data.comments.length === 0 && <p className="muted empty">No comments.</p>}
            </div>
        </div>
    );
};

export default FeedbackTab;
