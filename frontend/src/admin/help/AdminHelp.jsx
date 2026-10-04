import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { FiArrowRight, FiPrinter, FiSend, FiCamera, FiX, FiChevronDown, FiSearch } from 'react-icons/fi';
import { useAuth } from '../../context/AuthContext';
import { createSupportTicket, getMySupportTickets, replySupportTicket, markSupportRead, uploadSupportScreenshot } from '../../utils/api';
import { SOP, FAQ, UI } from './sop';
import TicketThread from './TicketThread';
import { STATUS, CATEGORIES, when } from './ticketMeta';
import './Help.css';

const errorText = (err) => err?.response?.data?.message || err?.message || 'Something went wrong';
// The admin menu language (menuLang: en / hi / hinglish) picks the guide language too
const LANGS = [{ key: 'en', label: 'English' }, { key: 'hi', label: 'हिन्दी' }, { key: 'hg', label: 'Hinglish' }];
const readLang = () => {
    try { const l = localStorage.getItem('menuLang'); return l === 'hi' ? 'hi' : l === 'hinglish' ? 'hg' : 'en'; } catch { return 'en'; }
};
const device = () => ({
    ua: navigator.userAgent.slice(0, 250), w: window.innerWidth, h: window.innerHeight,
    app: !!window.Capacitor?.isNativePlatform?.(), online: navigator.onLine,
});

const Btn = ({ label }) => <span className="hp-btn" aria-hidden="true">{label}</span>;

const Guide = ({ lang }) => {
    const [open, setOpen] = useState(() => new Set(['open']));
    const [q, setQ] = useState('');
    const toggle = (id) => setOpen(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
    const term = q.trim().toLowerCase();
    const list = term
        ? SOP.filter(s => JSON.stringify(s).toLowerCase().includes(term))
        : SOP;

    return (
        <>
            <div className="hp-tools">
                <label className="hp-search"><FiSearch aria-hidden="true" />
                    <span className="sr-only">Search the guide</span>
                    <input value={q} onChange={e => setQ(e.target.value)} placeholder={lang === 'hi' ? 'खोजें: शिफ्ट, खाता, बर्थडे…' : 'Search: shift, khata, birthday…'} />
                </label>
                <button className="btn btn-ghost" onClick={() => { setOpen(new Set(SOP.map(s => s.id))); setTimeout(() => window.print(), 50); }}><FiPrinter /> Print</button>
            </div>
            <ol className="hp-day">
                {list.map((s, si) => {
                    const isOpen = !!term || open.has(s.id);
                    return (
                        <li key={s.id} className={`hp-sec${isOpen ? ' open' : ''}`}>
                            <button className="hp-sec-head" aria-expanded={isOpen} onClick={() => toggle(s.id)}>
                                <span className="hp-ico" aria-hidden="true">{s.icon}</span>
                                <span className="hp-sec-text"><small>{si + 1} · {s.when[lang]}</small><b>{s.title[lang]}</b></span>
                                <FiChevronDown className="hp-chev" aria-hidden="true" />
                            </button>
                            {isOpen && (
                                <div className="hp-sec-body">
                                    <p className="hp-intro">{s.intro[lang]}</p>
                                    <ol className="hp-steps">
                                        {s.steps.map((st, i) => (
                                            <li key={i}>
                                                <span className="hp-n">{i + 1}</span>
                                                <div className="hp-step">
                                                    <p>{st.t[lang]}</p>
                                                    {(st.btn || st.go) && (
                                                        <div className="hp-step-row">
                                                            {st.btn && <><span className="hp-tap">{lang === 'en' ? 'Tap' : lang === 'hi' ? 'दबाएँ' : 'Dabao'}</span><Btn label={st.btn} /></>}
                                                            {st.go && <Link className="hp-open" to={st.go}>{UI.open[lang]} <FiArrowRight /></Link>}
                                                        </div>
                                                    )}
                                                </div>
                                            </li>
                                        ))}
                                    </ol>
                                    {s.example && <div className="hp-example"><b>💡 {UI.example[lang]}</b><p>{s.example[lang]}</p></div>}
                                    {s.tip && <div className="hp-tip"><b>✋ {UI.tip[lang]}</b><p>{s.tip[lang]}</p></div>}
                                </div>
                            )}
                        </li>
                    );
                })}
                {list.length === 0 && <p className="muted">Nothing found. Try another word, or ask us in the last tab.</p>}
            </ol>
        </>
    );
};

const Faq = ({ lang, onAsk }) => (
    <div className="hp-faq">
        {FAQ.map((f, i) => (
            <details key={i} className="hp-q">
                <summary>{f.q[lang]}</summary>
                <p>{f.a[lang]}</p>
                {f.go && <Link className="hp-open" to={f.go}>{UI.open[lang]} <FiArrowRight /></Link>}
            </details>
        ))}
        <div className="hp-ask">
            <p><b>{lang === 'en' ? 'Problem not listed?' : lang === 'hi' ? 'आपकी समस्या यहाँ नहीं है?' : 'Aapki problem yahan nahi hai?'}</b></p>
            <button className="btn btn-primary" onClick={onAsk}><FiSend /> {lang === 'en' ? 'Tell N.A.I.R.' : lang === 'hi' ? 'N.A.I.R. को बताएँ' : 'N.A.I.R. ko batao'}</button>
        </div>
    </div>
);

const blank = (from) => ({ category: 'problem', urgent: false, subject: '', message: '', page: from || '', file: null });

const Tickets = ({ from }) => {
    const { user } = useAuth();
    const [list, setList] = useState(null);
    const [error, setError] = useState('');
    const [form, setForm] = useState(() => (from ? blank(from) : null));
    const [openId, setOpenId] = useState(null);
    const [busy, setBusy] = useState(false);
    const [done, setDone] = useState('');
    const preview = useMemo(() => (form?.file ? URL.createObjectURL(form.file) : null), [form?.file]);
    useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

    const load = useCallback(() => getMySupportTickets().then(r => setList(r.data)).catch(err => setError(errorText(err))), []);
    useEffect(() => { load(); }, [load]);

    const submit = async (e) => {
        e.preventDefault();
        setBusy(true); setError('');
        try {
            const screenshot = form.file ? await uploadSupportScreenshot(form.file, user?.tenant?.id) : '';
            const { data } = await createSupportTicket({
                category: form.category, urgent: form.urgent, subject: form.subject, message: form.message,
                page: form.page, device: device(), screenshot,
            });
            setForm(null); setOpenId(data.id);
            setDone(`Ticket #${data.number} sent. N.A.I.R. will reply here and you will get a 🔔 notification.`);
            await load();
        } catch (err) { setError(errorText(err)); } finally { setBusy(false); }
    };
    const openTicket = (t) => {
        const next = openId === t.id ? null : t.id;
        setOpenId(next);
        if (next && t.unread) markSupportRead(t.id).then(load).catch(() => {});
    };
    const reply = async (t, body, status) => {
        setBusy(true); setError('');
        try { await replySupportTicket(t.id, body, status); await load(); return true; } catch (err) { setError(errorText(err)); return false; } finally { setBusy(false); }
    };

    return (
        <div className="tk">
            <div className="hp-contact">
                <p><b>N.A.I.R. Solutions</b> · Mon–Sat, 10 am – 7 pm. Urgent and the cafe cannot sell? Tick “Urgent”: we look at those first.</p>
            </div>
            {error && <p className="error-message">{error}</p>}
            {done && <p className="tk-done" role="status">{done}</p>}

            {!form ? (
                <button className="btn btn-primary tk-new" onClick={() => { setForm(blank('')); setDone(''); }}><FiSend /> New ticket</button>
            ) : (
                <form className="tk-form" onSubmit={submit}>
                    <div className="tk-form-head"><b>New ticket</b><button type="button" className="icon-btn" aria-label="Close" onClick={() => setForm(null)}><FiX /></button></div>
                    <fieldset className="tk-cats">
                        <legend>What is it about?</legend>
                        {CATEGORIES.map(c => (
                            <label key={c.key} className={form.category === c.key ? 'on' : ''}>
                                <input type="radio" name="tk-cat" value={c.key} checked={form.category === c.key} onChange={() => setForm({ ...form, category: c.key })} />{c.label}
                            </label>
                        ))}
                    </fieldset>
                    <label>Short title
                        <input className="input" required minLength={3} maxLength={120} value={form.subject} placeholder="e.g. Printer not printing KOT"
                            onChange={e => setForm({ ...form, subject: e.target.value })} />
                    </label>
                    <label>What happened? What did you tap? What did you expect?
                        <textarea className="input" required minLength={5} rows={5} value={form.message}
                            placeholder={'e.g. Since 2 pm, when I tap KOT on Counter nothing prints. Bill printing works. Printer light is green.'}
                            onChange={e => setForm({ ...form, message: e.target.value })} />
                    </label>
                    <div className="tk-attach">
                        <label className="btn btn-ghost tk-file"><FiCamera /> {form.file ? 'Change photo' : 'Add screenshot or photo'}
                            <input type="file" accept="image/*" onChange={e => setForm({ ...form, file: e.target.files?.[0] || null })} />
                        </label>
                        {preview && <span className="tk-thumb"><img src={preview} alt="Attached" /><button type="button" aria-label="Remove photo" onClick={() => setForm({ ...form, file: null })}><FiX /></button></span>}
                    </div>
                    <label className="tk-urgent"><input type="checkbox" checked={form.urgent} onChange={e => setForm({ ...form, urgent: e.target.checked })} /> Urgent: the cafe cannot take orders or payments</label>
                    {form.page && <small className="muted">We will also see the page you came from ({form.page}) and your device type.</small>}
                    <button className="btn btn-primary" disabled={busy}>{busy ? 'Sending…' : 'Send to N.A.I.R.'}</button>
                </form>
            )}

            <h3 className="tk-h">Your tickets</h3>
            {!list ? <p className="muted">Loading…</p> : list.length === 0 ? <p className="muted">No tickets yet.</p> : (
                <ul className="tk-list">
                    {list.map(t => (
                        <li key={t.id} className={`tk-item${t.unread ? ' unread' : ''}${openId === t.id ? ' open' : ''}`}>
                            <button className="tk-row" aria-expanded={openId === t.id} onClick={() => openTicket(t)}>
                                <span className="tk-num">#{t.number}</span>
                                <span className="tk-sub"><b>{t.subject}</b><small>{CATEGORIES.find(c => c.key === t.category)?.label} · {when(t.updatedAt)}{t.unread ? ' · new reply' : ''}</small></span>
                                {t.urgent && <span className="tk-urg">Urgent</span>}
                                <span className={`tk-st ${t.status}`}>{STATUS[t.status].label}</span>
                            </button>
                            {openId === t.id && (
                                <TicketThread t={t} side="cafe" busy={busy} onReply={(b, s) => reply(t, b, s)}
                                    actions={(send) => (t.status === 'resolved' || t.status === 'waiting' || t.status === 'open' || t.status === 'working'
                                        ? <button className="btn btn-ghost" disabled={busy} onClick={() => send('closed')}>It is solved, close</button> : null)} />
                            )}
                            {openId === t.id && t.status === 'closed' && (
                                <div className="tk-reopen"><button className="btn btn-ghost" disabled={busy} onClick={() => reply(t, '', 'open')}>Open again</button></div>
                            )}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
};

// Help & support: the daily rulebook (3 languages), common problems, and tickets to N.A.I.R.
const AdminHelp = () => {
    const [params, setParams] = useSearchParams();
    const from = params.get('from') || '';
    const tab = params.get('tab') || (from ? 'tickets' : 'guide');
    const [lang, setLang] = useState(readLang);
    const chooseLang = (k) => {
        setLang(k);
        try { localStorage.setItem('menuLang', k === 'hg' ? 'hinglish' : k); } catch { /* private mode */ }
        window.dispatchEvent(new Event('menulang'));
    };
    // Follow the language switch in the side menu too
    useEffect(() => {
        const sync = () => setLang(readLang());
        window.addEventListener('menulang', sync);
        return () => window.removeEventListener('menulang', sync);
    }, []);
    const go = (t) => setParams(t === 'guide' ? {} : { tab: t }, { replace: true });

    return (
        <div className="hp">
            <div className="hp-head">
                <div>
                    <h1>{UI.title[lang]}</h1>
                    <p className="muted">{UI.sub[lang]}</p>
                </div>
                <div className="hp-lang" role="group" aria-label="Guide language">
                    {LANGS.map(l => <button key={l.key} className={lang === l.key ? 'on' : ''} aria-pressed={lang === l.key} onClick={() => chooseLang(l.key)}>{l.label}</button>)}
                </div>
            </div>
            <div className="hp-tabs" role="tablist">
                {['guide', 'faq', 'tickets'].map(k => (
                    <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => go(k)}>{UI[k][lang]}</button>
                ))}
            </div>
            {tab === 'guide' && <Guide lang={lang} />}
            {tab === 'faq' && <Faq lang={lang} onAsk={() => go('tickets')} />}
            {tab === 'tickets' && <Tickets key={from} from={from} />}
        </div>
    );
};

export default AdminHelp;
