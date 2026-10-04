import React, { useCallback, useEffect, useState } from 'react';
import { saGetSupportTickets, replySupportTicket, markSupportRead } from '../utils/api';
import TicketThread from '../admin/help/TicketThread';
import { STATUS, CATEGORIES, when } from '../admin/help/ticketMeta';
import '../admin/help/Help.css';

const errorText = (err) => err?.response?.data?.message || err?.message || 'Something went wrong';
const FILTERS = [['active', 'Open'], ['resolved', 'Solved'], ['closed', 'Closed'], ['all', 'All']];

// Platform console: tickets from every cafe, reply and set the status
const SupportPanel = () => {
    const [filter, setFilter] = useState('active');
    const [list, setList] = useState(null);
    const [openId, setOpenId] = useState(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const load = useCallback(() => saGetSupportTickets(filter).then(r => setList(r.data)).catch(err => setError(errorText(err))), [filter]);
    useEffect(() => { load(); }, [load]);

    const reply = async (t, body, status) => {
        setBusy(true); setError('');
        try { await replySupportTicket(t.id, body, status); await load(); return true; } catch (err) { setError(errorText(err)); return false; } finally { setBusy(false); }
    };
    const openTicket = (t) => {
        const next = openId === t.id ? null : t.id;
        setOpenId(next);
        if (next && t.unread) markSupportRead(t.id).then(load).catch(() => {});
    };
    const unread = (list || []).filter(t => t.unread).length;

    return (
        <section className="sa-plans sa-support">
            <div className="sa-plans-head">
                <h2>Support tickets{unread ? ` · ${unread} new` : ''}</h2>
                <div className="hp-tabs">
                    {FILTERS.map(([k, l]) => <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{l}</button>)}
                </div>
            </div>
            {error && <p className="error-message">{error}</p>}
            {!list ? <p className="muted">Loading…</p> : list.length === 0 ? <p className="muted">No tickets here.</p> : (
                <ul className="tk-list">
                    {list.map(t => (
                        <li key={t.id} className={`tk-item${t.unread ? ' unread' : ''}`}>
                            <button className="tk-row" aria-expanded={openId === t.id} onClick={() => openTicket(t)}>
                                <span className="tk-num">#{t.number}</span>
                                <span className="tk-sub"><b>{t.subject}</b><small>{t.cafe?.name} · {t.author} · {CATEGORIES.find(c => c.key === t.category)?.label} · {when(t.updatedAt)}</small></span>
                                {t.urgent && <span className="tk-urg">Urgent</span>}
                                <span className={`tk-st ${t.status}`}>{STATUS[t.status].label}</span>
                            </button>
                            {openId === t.id && (
                                <TicketThread t={t} side="platform" busy={busy} onReply={(b, s) => reply(t, b, s)}
                                    actions={(send, empty) => (
                                        <>
                                            <button className="btn btn-ghost" disabled={busy || empty} onClick={() => send('waiting')}>Send · ask the cafe</button>
                                            <button className="btn btn-ghost" disabled={busy} onClick={() => send('resolved')}>{empty ? 'Mark solved' : 'Send · solved'}</button>
                                        </>
                                    )} />
                            )}
                            {openId === t.id && t.status === 'closed' && (
                                <div className="tk-reopen"><button className="btn btn-ghost" disabled={busy} onClick={() => reply(t, '', 'open')}>Open again</button></div>
                            )}
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
};

export default SupportPanel;
