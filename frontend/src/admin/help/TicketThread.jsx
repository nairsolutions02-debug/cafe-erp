import React, { useEffect, useState } from 'react';
import { FiImage } from 'react-icons/fi';
import { supportScreenshotUrl } from '../../utils/api';

import { when } from './ticketMeta';

// One ticket: the first message, the replies, and a reply box. Used by the cafe Help page and the platform console.
const TicketThread = ({ t, side, busy, onReply, actions }) => {
    const [text, setText] = useState('');
    const [shot, setShot] = useState(null);
    useEffect(() => {
        let live = true;
        if (t.screenshot) supportScreenshotUrl(t.screenshot).then(u => live && setShot(u));
        return () => { live = false; };
    }, [t.screenshot]);
    const send = async (status) => {
        if (await onReply(text, status)) setText('');
    };

    return (
        <div className="tk-thread">
            <div className="tk-msg cafe">
                <div className="tk-meta"><b>{t.author || 'Cafe'}</b>{side === 'platform' && t.authorPhone ? ` · ${t.authorPhone}` : ''} · {when(t.createdAt)}</div>
                <p>{t.message}</p>
                {t.page && <small className="tk-page">Page: {t.page}</small>}
                {shot && <a className="tk-shot" href={shot} target="_blank" rel="noreferrer"><img src={shot} alt="Screenshot sent with the ticket" /><span><FiImage /> Open screenshot</span></a>}
                {side === 'platform' && t.device?.ua && <small className="tk-page">{t.device.app ? 'Phone app' : 'Browser'} · {t.device.w}×{t.device.h} · {t.device.ua}</small>}
            </div>
            {t.messages.map(m => (
                <div key={m.id} className={`tk-msg ${m.fromPlatform ? 'nair' : 'cafe'}`}>
                    <div className="tk-meta"><b>{m.author}</b> · {when(m.at)}</div>
                    <p>{m.body}</p>
                </div>
            ))}
            {t.status !== 'closed' && (
                <div className="tk-reply">
                    <label className="sr-only" htmlFor={`tk-r-${t.id}`}>Reply</label>
                    <textarea id={`tk-r-${t.id}`} rows={3} className="input" value={text} placeholder={side === 'platform' ? 'Reply to the cafe…' : 'Add more details or answer N.A.I.R.…'}
                        onChange={e => setText(e.target.value)} />
                    <div className="tk-reply-row">
                        {actions(send, !text.trim())}
                        <button className="btn btn-primary" disabled={busy || !text.trim()} onClick={() => send(null)}>Send</button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default TicketThread;
