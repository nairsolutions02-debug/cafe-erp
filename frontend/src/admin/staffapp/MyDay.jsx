import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { FiCamera, FiLogIn, FiLogOut, FiCoffee, FiMapPin, FiBell, FiCheck, FiEdit2 } from 'react-icons/fi';
import { getMyDay, staffCheckIn, staffCheckOut, staffBreak, myLeaveRequest, uploadPrivatePhoto, getMyIncentives,
    getMyDayExtras, tickDailyTask, saveDailyTasks, getCurrentShifts } from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import Skeleton from '../mobile/Skeleton';
import useMenuLang from '../mobile/useMenuLang';
import { D } from './dayText';
import { getPosition } from '../../lib/geo';
import { enablePush, pushStatus } from '../../lib/push';
import { isNativeApp } from '../../lib/geo';
import PhoneSetup from './PhoneSetup';
import './StaffApp.css';

const errorText = (err) => err?.response?.data?.message || err?.message || 'Something went wrong';
const time = (d) => (d ? new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—');
const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
const hm = (ms) => { const m = Math.max(0, Math.floor(ms / 60000)); return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`; };
const BREAKS = [[15, 'tea'], [30, 'lunch'], [60, 'delivery']];

// The cafe daily jobs: anyone ticks them; the owner or a manager edits the list (one task per line)
const Tasks = ({ tasks, canEdit, onChange, t }) => {
    const [edit, setEdit] = useState(null);
    const [error, setError] = useState('');
    const done = tasks.filter(x => x.done).length;
    const tick = async (x) => {
        try { onChange((await tickDailyTask(x.id, !x.done)).data); } catch (err) { setError(errorText(err)); }
    };
    const save = async () => {
        const lines = edit.split('\n').map(l => l.trim()).filter(Boolean);
        const list = lines.map(title => ({ id: tasks.find(x => x.title === title)?.id || '', title }));
        try { onChange((await saveDailyTasks(list)).data); setEdit(null); } catch (err) { setError(errorText(err)); }
    };
    if (!tasks.length && !canEdit) return null;
    return (
        <section className="day-card">
            <div className="day-h">
                <h2>{t(D.tasks)}{tasks.length > 0 && <span className="day-count">{done}/{tasks.length}</span>}</h2>
                {canEdit && edit === null && <button type="button" className="day-link" onClick={() => setEdit(tasks.map(x => x.title).join('\n'))}><FiEdit2 /> {t(D.edit)}</button>}
            </div>
            {edit !== null ? (
                <>
                    <label className="day-small" htmlFor="day-tasks">{t(D.onePerLine)}</label>
                    <textarea id="day-tasks" className="input" rows={6} value={edit} placeholder={'Count milk and curd\nClean the coffee machine\nRefill tissues on tables'}
                        onChange={e => setEdit(e.target.value)} />
                    <div className="day-row"><button type="button" className="btn btn-ghost" onClick={() => setEdit(null)}>{t(D.cancel)}</button>
                        <button type="button" className="btn btn-primary" onClick={save}>{t(D.save)}</button></div>
                </>
            ) : tasks.length === 0 ? (
                <p className="day-small">{t(D.noTasks)}</p>
            ) : (
                <ul className="day-tasks">
                    {tasks.map(x => (
                        <li key={x.id}>
                            <button type="button" className={x.done ? 'on' : ''} aria-pressed={x.done} onClick={() => tick(x)}>
                                <span className="day-ck" aria-hidden="true"><FiCheck /></span>
                                <span className="day-tt"><span className="day-tn">{x.title}</span>{x.done && <small>{x.by} · {time(x.at)}</small>}</span>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
            {error && <p className="error-message">{error}</p>}
        </section>
    );
};

// The staff member's own screen: check in/out at the cafe with a selfie, breaks, leave, alerts
const MyDay = () => {
    const [d, setD] = useState(null);
    const [busy, setBusy] = useState('');
    const [error, setError] = useState('');
    const [selfie, setSelfie] = useState(null);
    const [preview, setPreview] = useState('');
    const [leave, setLeave] = useState({ typeId: '', from: '', to: '', reason: '' });
    const [push, setPush] = useState(pushStatus());
    const [inc, setInc] = useState(null);
    const [extras, setExtras] = useState(null);
    const [drawer, setDrawer] = useState(undefined);
    const [breakPick, setBreakPick] = useState(null);
    const [, tick] = useState(0);
    const { hasPerm } = useAuth();
    const { t: tl } = useMenuLang();
    useEffect(() => {
        getMyIncentives().then(r => setInc(r.data)).catch(() => {});
        getMyDayExtras().then(r => setExtras(r.data)).catch(() => {});
        if (hasPerm('orders.create')) getCurrentShifts().then(r => setDrawer(r.data.open.find(x => x.drawer === 'cash_counter') || null)).catch(() => {});
        const clock = setInterval(() => tick(n => n + 1), 60000);
        return () => clearInterval(clock);
    }, [hasPerm]);
    const fileRef = useRef(null);

    const load = useCallback(async () => {
        try { setD((await getMyDay()).data); } catch (err) { setError(errorText(err)); }
    }, []);
    useEffect(() => {
        load();
        window.addEventListener('myday-changed', load);
        return () => window.removeEventListener('myday-changed', load);
    }, [load]);

    const pick = (e) => {
        const f = e.target.files[0];
        if (!f) return;
        setSelfie(f);
        setPreview(URL.createObjectURL(f));
    };

    const act = async (kind) => {
        setError('');
        if (d.geofence.selfieRequired && !selfie) {
            fileRef.current?.click();
            setError('Take a selfie first');
            return;
        }
        setBusy(kind);
        try {
            let pos = { lat: null, lng: null, accuracy: null };
            if (d.trackLocation) pos = await getPosition();
            const path = selfie
                ? await uploadPrivatePhoto(selfie, `${d.tenantId}/${d.staffId}/${new Date().toISOString().slice(0, 10)}-${kind}-${Date.now()}.webp`)
                : '';
            const fn = kind === 'in' ? staffCheckIn : staffCheckOut;
            setD((await fn(pos.lat, pos.lng, pos.accuracy, path)).data);
            setSelfie(null);
            setPreview('');
        } catch (err) {
            setError(errorText(err));
        } finally {
            setBusy('');
        }
    };

    const takeBreak = async (minutes, reason) => {
        setBreakPick(null);
        try { setD((await staffBreak(minutes, reason)).data); } catch (err) { setError(errorText(err)); }
    };

    const sendLeave = async (e) => {
        e.preventDefault();
        try {
            await myLeaveRequest(leave.typeId, leave.from, leave.to, leave.reason);
            setLeave({ typeId: '', from: '', to: '', reason: '' });
            load();
        } catch (err) { setError(errorText(err)); }
    };

    if (!d) return error ? <div className="myday">{error}</div> : <Skeleton rows={3} />;
    // Phone alerts are for everyone, linked to an employee record or not (e.g. the owner's email login)
    const alertsCard = isNativeApp() ? <PhoneSetup /> : (
        <section className="day-card">
            <h2><FiBell /> Phone alerts</h2>
            <p className="muted small">{push.message}</p>
            {push.canEnable && <button className="btn btn-secondary" onClick={async () => setPush(await enablePush())}>Turn on alerts on this phone</button>}
        </section>
    );
    if (!d.linked) {
        return (
            <div className="myday">
                <h1>My day</h1>
                <p className="muted">Attendance needs your login linked to an employee record (owner: <strong>Attendance → App login</strong>).</p>
                {drawer !== undefined && (
                    <section className="day-card">
                        <h2>{tl(D.today)}</h2>
                        {drawer?.canSee && <div className="month-row"><span><strong>{inr(drawer.expectedCash)}</strong> {tl(D.inDrawer)}</span></div>}
                        {drawer && !drawer.canClose && <p className="muted small">{tl(D.shiftBy)} {drawer.openedBy}</p>}
                        {(!drawer || drawer.canClose) && <Link to="/admin/shifts" className={`btn ${drawer ? 'btn-ghost' : 'btn-primary'} day-shift`}>{drawer ? tl(D.closeShift) : tl(D.openShift)}</Link>}
                    </section>
                )}
                {extras && <Tasks tasks={extras.tasks} canEdit={extras.canEditTasks} t={tl} onChange={(list) => setExtras({ ...extras, tasks: list })} />}
                {alertsCard}
            </div>
        );
    }
    const t = d.today;
    const checkedIn = t?.checkInAt && !t?.checkOutAt;
    const onBreak = t?.breakUntil && new Date(t.breakUntil) > new Date();
    const worked = t?.checkInAt ? (t.checkOutAt ? new Date(t.checkOutAt) : new Date()) - new Date(t.checkInAt) : 0;
    const pct = Math.min(100, Math.round((worked / ((Number(d.shiftHours) || 9) * 3600000)) * 100));

    return (
        <div className="myday">
            <div className="day-hello">
                <h1 className="keep-h1">{tl(D.hi)} {d.name.split(' ')[0]}</h1>
                <p className="muted">{new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })} · {tl(D.shift)} {d.shiftStart} · {d.shiftHours} h{!d.geofence.lat && d.trackLocation ? ' · cafe location not set yet' : ''}</p>
            </div>

            <section className={`day-card ${checkedIn ? 'in' : t?.checkOutAt ? 'done' : ''}`}>
                <div className="day-clock">
                    <span className="day-ring" style={{ '--p': `${pct}%` }} aria-hidden="true"><i>{t?.checkInAt ? hm(worked) : '—'}</i></span>
                    <div className="day-status">
                        {checkedIn ? <><span>{tl(D.checkedInAt)} <strong>{time(t.checkInAt)}</strong></span>{t.lateMinutes > 0 && <span className="pill warn">{t.lateMinutes} min late</span>}</>
                            : t?.checkOutAt ? <span>{tl(D.doneToday)}: {time(t.checkInAt)} – {time(t.checkOutAt)}</span>
                                : <span>{tl(D.notIn)}</span>}
                    </div>
                </div>
                {onBreak && <p className="pill warn">On break until {time(t.breakUntil)}</p>}
                {!t?.checkOutAt && (
                    <>
                        <input ref={fileRef} type="file" accept="image/*" capture="user" hidden onChange={pick} />
                        <button className="selfie-btn" onClick={() => fileRef.current?.click()} aria-label="Take selfie">
                            {preview ? <img src={preview} alt="Selfie" /> : <><FiCamera size={28} /><span>Selfie</span></>}
                        </button>
                        {checkedIn ? (
                            <button className="big-act out" disabled={!!busy} onClick={() => act('out')}><FiLogOut /> {busy ? 'Checking out…' : tl(D.checkOut)}</button>
                        ) : (
                            <button className="big-act in" disabled={!!busy} onClick={() => act('in')}><FiLogIn /> {busy ? 'Checking in…' : tl(D.checkIn)}</button>
                        )}
                        {d.trackLocation && <p className="muted small"><FiMapPin /> Works only inside the cafe ({d.geofence.radius} m). Your location is checked every {d.geofence.pingMinutes} min while you're checked in and the app is open.</p>}
                    </>
                )}
                {checkedIn && !onBreak && (
                    breakPick === null ? (
                        <div className="break-row">
                            {BREAKS.map(([m, k]) => <button key={m} type="button" className="btn btn-ghost" onClick={() => setBreakPick(m)}>{m === 15 && <FiCoffee />} {tl(D[k])} · {m} min</button>)}
                        </div>
                    ) : (
                        <div className="break-pick" role="group" aria-label={tl(D.why)}>
                            <span className="day-small">{tl(D.why)} ({breakPick} min)</span>
                            <div className="break-row">
                                {['tea', 'lunch', 'delivery', 'personal'].map(k => <button key={k} type="button" className="btn btn-secondary" onClick={() => takeBreak(breakPick, D[k].en)}>{tl(D[k])}</button>)}
                                <button type="button" className="btn btn-ghost" onClick={() => setBreakPick(null)}>{tl(D.cancel)}</button>
                            </div>
                        </div>
                    )
                )}
                {error && <p className="error-message">{error}</p>}
            </section>

            {(extras?.today || drawer !== undefined) && (
                <section className="day-card">
                    <h2>{tl(D.today)}</h2>
                    <div className="month-row">
                        {extras?.today && <><span><strong>{extras.today.orders}</strong> {tl(D.myOrders)}</span><span><strong>{inr(extras.today.sales)}</strong> {tl(D.mySales)}</span></>}
                        {drawer?.canSee && <span><strong>{inr(drawer.expectedCash)}</strong> {tl(D.inDrawer)}</span>}
                    </div>
                    {drawer && !drawer.canClose && <p className="muted small">{tl(D.shiftBy)} {drawer.openedBy}</p>}
                    {drawer !== undefined && (!drawer || drawer.canClose) && (
                        <Link to="/admin/shifts" className={`btn ${drawer ? 'btn-ghost' : 'btn-primary'} day-shift`}>{drawer ? tl(D.closeShift) : tl(D.openShift)}</Link>
                    )}
                </section>
            )}

            {extras && <Tasks tasks={extras.tasks} canEdit={extras.canEditTasks} t={tl} onChange={(list) => setExtras({ ...extras, tasks: list })} />}

            <section className="day-card">
                <h2>{tl(D.month)}</h2>
                <div className="month-row">
                    <span><strong>{d.month.present}</strong> present</span><span><strong>{d.month.halfDays}</strong> half</span>
                    <span><strong>{d.month.leave}</strong> leave</span><span><strong>{d.month.late}</strong> late</span>
                </div>
            </section>

            {inc && (Number(inc.month) > 0 || inc.hints.length > 0) && (
                <section className="day-card">
                    <h2>My incentives</h2>
                    <div className="month-row">
                        <span><strong>₹{Number(inc.week).toLocaleString('en-IN')}</strong> this week</span>
                        <span><strong>₹{Number(inc.month).toLocaleString('en-IN')}</strong> this month</span>
                    </div>
                    {inc.hints.map(h => <p key={h} className="small">💡 {h}</p>)}
                </section>
            )}

            <section className="day-card">
                <h2>Ask for leave</h2>
                <form className="leave-form" onSubmit={sendLeave}>
                    <select className="input" required value={leave.typeId} onChange={e => setLeave({ ...leave, typeId: e.target.value })} aria-label="Leave type">
                        <option value="">Type…</option>{d.leaveTypes.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                    </select>
                    <input className="input" type="date" required value={leave.from} onChange={e => setLeave({ ...leave, from: e.target.value })} aria-label="From" />
                    <input className="input" type="date" value={leave.to} onChange={e => setLeave({ ...leave, to: e.target.value })} aria-label="To" />
                    <input className="input" placeholder="Reason" value={leave.reason} onChange={e => setLeave({ ...leave, reason: e.target.value })} />
                    <button className="btn btn-primary" type="submit">Send</button>
                </form>
                {d.requests.map((r, i) => <p key={i} className="small">{r.type} {r.from}{r.to !== r.from ? ` → ${r.to}` : ''} · <span className={`pill ${r.status === 'approved' ? 'ok' : r.status === 'pending' ? 'warn' : 'muted'}`}>{r.status}</span></p>)}
            </section>

            {alertsCard}
        </div>
    );
};

export default MyDay;
