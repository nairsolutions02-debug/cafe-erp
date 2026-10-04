import Skeleton from '../mobile/Skeleton';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FiCamera, FiLogIn, FiLogOut, FiCoffee, FiMapPin, FiBell } from 'react-icons/fi';
import { getMyDay, staffCheckIn, staffCheckOut, staffBreak, myLeaveRequest, uploadPrivatePhoto, getMyIncentives } from '../../utils/api';
import { getPosition } from '../../lib/geo';
import { enablePush, pushStatus } from '../../lib/push';
import { isNativeApp } from '../../lib/geo';
import PhoneSetup from './PhoneSetup';
import './StaffApp.css';

const errorText = (err) => err?.response?.data?.message || err?.message || 'Something went wrong';
const time = (d) => (d ? new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—');

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
    useEffect(() => { getMyIncentives().then(r => setInc(r.data)).catch(() => {}); }, []);
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

    const takeBreak = async (minutes) => {
        const reason = window.prompt('Reason (delivery, lunch…)', minutes >= 30 ? 'Lunch' : 'Delivery');
        if (reason === null) return;
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
                {alertsCard}
            </div>
        );
    }
    const t = d.today;
    const checkedIn = t?.checkInAt && !t?.checkOutAt;
    const onBreak = t?.breakUntil && new Date(t.breakUntil) > new Date();

    return (
        <div className="myday">
            <h1 className="keep-h1">Hi {d.name.split(' ')[0]}</h1>
            <p className="muted">Shift starts {d.shiftStart} · {d.shiftHours} h{!d.geofence.lat && d.trackLocation ? ' · cafe location not set yet' : ''}</p>

            <section className={`day-card ${checkedIn ? 'in' : t?.checkOutAt ? 'done' : ''}`}>
                <div className="day-status">
                    {checkedIn ? <>Checked in at <strong>{time(t.checkInAt)}</strong>{t.lateMinutes > 0 && <span className="pill warn">{t.lateMinutes} min late</span>}</>
                        : t?.checkOutAt ? <>Done for today: {time(t.checkInAt)} – {time(t.checkOutAt)}</>
                            : 'Not checked in'}
                </div>
                {onBreak && <p className="pill warn">On break until {time(t.breakUntil)}</p>}
                {!t?.checkOutAt && (
                    <>
                        <input ref={fileRef} type="file" accept="image/*" capture="user" hidden onChange={pick} />
                        <button className="selfie-btn" onClick={() => fileRef.current?.click()} aria-label="Take selfie">
                            {preview ? <img src={preview} alt="Selfie" /> : <><FiCamera size={28} /><span>Selfie</span></>}
                        </button>
                        {checkedIn ? (
                            <button className="big-act out" disabled={!!busy} onClick={() => act('out')}><FiLogOut /> {busy ? 'Checking out…' : 'Check out'}</button>
                        ) : (
                            <button className="big-act in" disabled={!!busy} onClick={() => act('in')}><FiLogIn /> {busy ? 'Checking in…' : 'Check in'}</button>
                        )}
                        {d.trackLocation && <p className="muted small"><FiMapPin /> Works only inside the cafe ({d.geofence.radius} m). Your location is checked every {d.geofence.pingMinutes} min while you're checked in and the app is open.</p>}
                    </>
                )}
                {checkedIn && (
                    <div className="break-row">
                        <button className="btn btn-ghost" onClick={() => takeBreak(15)}><FiCoffee /> Break 15 min</button>
                        <button className="btn btn-ghost" onClick={() => takeBreak(30)}>30 min</button>
                        <button className="btn btn-ghost" onClick={() => takeBreak(60)}>Delivery 60 min</button>
                    </div>
                )}
                {error && <p className="error-message">{error}</p>}
            </section>

            <section className="day-card">
                <h2>This month</h2>
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
