import React, { useCallback, useEffect, useState } from 'react';
import { FiSend, FiCheck } from 'react-icons/fi';
import { getRewardTodo, markRewardSent } from '../../utils/api';
import { errorText, fmtDateTime, whatsappLink } from '../inventory/shared';

// Rewards waiting for a WhatsApp message: tap Send → WhatsApp opens with the text → mark sent
const TodoTab = () => {
    const [status, setStatus] = useState('pending');
    const [list, setList] = useState([]);
    const load = useCallback(async () => setList((await getRewardTodo(status)).data), [status]);
    useEffect(() => { load(); }, [load]);
    const mark = async (g, s) => {
        try { await markRewardSent(g.id, s); load(); } catch (err) { alert(errorText(err)); }
    };
    return (
        <div>
            <div className="inv-toolbar">
                <select className="input compact" value={status} onChange={e => setStatus(e.target.value)} aria-label="Show">
                    <option value="pending">To send</option><option value="all">All</option><option value="sent">Sent</option><option value="skipped">Skipped</option>
                </select>
            </div>
            <div className="todo-list">
                {list.map(g => (
                    <div key={g.id} className="todo-card">
                        <div>
                            <strong>{g.customer.name || 'Customer'}</strong> <span className="muted small">{g.customer.phone} · {g.customer.group}</span>
                            <div className="small">{g.title} → <strong>{g.reward}</strong>{g.code && <> · code <code>{g.code}</code></>}{g.used && <span className="pill ok">used</span>}</div>
                            <p className="todo-msg">{g.message}</p>
                            <span className="muted small">{fmtDateTime(g.createdAt)}{g.status === 'sent' && ` · sent by ${g.sentBy} at ${fmtDateTime(g.sentAt)}`}{g.status === 'skipped' && ` · skipped by ${g.sentBy}`}</span>
                        </div>
                        {g.status === 'pending' && (
                            <div className="todo-actions">
                                {g.canSend ? (
                                    <a className="btn btn-primary btn-sm" href={whatsappLink(g.customer.phone, g.message)} target="_blank" rel="noopener noreferrer"
                                        onClick={() => setTimeout(() => mark(g, 'sent'), 800)}><FiSend /> Send on WhatsApp</a>
                                ) : <span className="muted small">Assigned to someone else</span>}
                                {g.canSend && <button className="btn btn-ghost btn-sm" onClick={() => mark(g, 'sent')}><FiCheck /> Mark sent</button>}
                                <button className="btn btn-ghost btn-sm" onClick={() => mark(g, 'skipped')}>Skip</button>
                            </div>
                        )}
                    </div>
                ))}
                {list.length === 0 && <p className="muted empty">{status === 'pending' ? 'Nothing to send. 🎉' : 'Nothing here.'}</p>}
            </div>
        </div>
    );
};

export default TodoTab;
