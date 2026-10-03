import React, { useCallback, useEffect, useState } from 'react';
import { FiMapPin } from 'react-icons/fi';
import {
    getAttendanceBoard, getLocationTrail, linkEmployeeLogin, privatePhotoUrl, getSettings, updateSetting, getStaff,
} from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import { getPosition } from '../../lib/geo';
import Modal from '../inventory/Modal';
import '../AdminStaff.css';
import '../AdminCatalogue.css';
import '../inventory/Inventory.css';
import '../pos/POS.css';
import './StaffApp.css';

const errorText = (err) => err?.response?.data?.message || err?.message || 'Something went wrong';
const time = (d) => (d ? new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '');
const TONE = { inside: 'ok', break: 'warn', outside: 'warn', 'stopped reporting': 'warn', 'not tracked': 'muted' };

const Selfie = ({ path }) => {
    const [url, setUrl] = useState(null);
    useEffect(() => { privatePhotoUrl(path).then(setUrl); }, [path]);
    if (!path) return null;
    return url ? <a href={url} target="_blank" rel="noopener noreferrer"><img className="selfie-thumb" src={url} alt="Selfie" /></a> : null;
};

const Trail = ({ row, onClose }) => {
    const [pts, setPts] = useState([]);
    useEffect(() => { getLocationTrail(row.attendanceId).then(r => setPts(r.data)); }, [row.attendanceId]);
    return (
        <Modal title={`${row.name} · location today`} onClose={onClose} wide>
            <div className="modal-body table-scroll">
                <table className="staff-table">
                    <thead><tr><th>Time</th><th>Distance</th><th>Inside</th><th>Accuracy</th><th>Map</th></tr></thead>
                    <tbody>{pts.map((p, i) => (
                        <tr key={i}><td>{time(p.at)}</td><td>{p.distance != null ? `${p.distance} m` : '—'}</td>
                            <td><span className={`pill ${p.inside ? 'ok' : 'warn'}`}>{p.inside ? 'inside' : 'outside'}</span></td>
                            <td>{p.accuracy ? `±${p.accuracy} m` : ''}</td>
                            <td>{p.lat && <a href={`https://maps.google.com/?q=${p.lat},${p.lng}`} target="_blank" rel="noopener noreferrer">open</a>}</td></tr>
                    ))}{pts.length === 0 && <tr><td colSpan={5} className="muted">No location points.</td></tr>}</tbody>
                </table>
                <p className="muted small">Points are kept 30 days. GPS indoors can be off by 20–50 m.</p>
            </div>
        </Modal>
    );
};

// Owner / manager: who is in, late, outside or on a break; geofence; linking logins to employees
const AdminAttendance = () => {
    const { hasPerm } = useAuth();
    const [date, setDate] = useState('');
    const [rows, setRows] = useState([]);
    const [staff, setStaff] = useState([]);
    const [geo, setGeo] = useState({ lat: '', lng: '', radius: 75, grace: 10, ping: 10, appCode: '', appUrl: '' });
    const [trail, setTrail] = useState(null);
    const [msg, setMsg] = useState('');
    const canEdit = hasPerm('employees.edit');

    const load = useCallback(async () => setRows((await getAttendanceBoard(date)).data), [date]);
    useEffect(() => {
        load();
        const t = setInterval(load, 60000);
        return () => clearInterval(t);
    }, [load]);
    useEffect(() => {
        if (hasPerm('staff.view')) getStaff().then(r => setStaff(Array.isArray(r.data) ? r.data : (r.data.staff || []))).catch(() => {});
        getSettings().then(r => setGeo({ lat: r.data.geofence_lat ?? '', lng: r.data.geofence_lng ?? '', radius: r.data.geofence_radius_m ?? 75,
            grace: r.data.leave_grace_minutes ?? 10, ping: r.data.ping_minutes ?? 10,
            appCode: r.data.app_version_code ?? '', appUrl: r.data.app_download_url ?? '' })).catch(() => {});
    }, [hasPerm]);

    const here = async () => {
        try {
            const p = await getPosition();
            setGeo(g => ({ ...g, lat: p.lat.toFixed(6), lng: p.lng.toFixed(6) }));
            setMsg(`Got your location (±${p.accuracy} m). Save to use it.`);
        } catch (err) { setMsg(errorText(err)); }
    };
    const saveGeo = async () => {
        try {
            await updateSetting('geofence_lat', geo.lat === '' ? null : Number(geo.lat));
            await updateSetting('geofence_lng', geo.lng === '' ? null : Number(geo.lng));
            await updateSetting('geofence_radius_m', Number(geo.radius) || 75);
            await updateSetting('leave_grace_minutes', Number(geo.grace) || 10);
            await updateSetting('ping_minutes', Math.max(5, Number(geo.ping) || 10));
            await updateSetting('app_version_code', Number(geo.appCode) || 0);
            await updateSetting('app_download_url', geo.appUrl || '');
            setMsg('Saved');
        } catch (err) { setMsg(errorText(err)); }
    };
    const link = async (row, patch) => {
        try {
            const current = staff.find(s => s.id === (patch.staffId ?? row.staffId));
            await linkEmployeeLogin(row.employeeId, patch.staffId !== undefined ? patch.staffId : (current?.id || null), patch.track ?? null, patch.shiftStart ?? null);
            load();
        } catch (err) { alert(errorText(err)); }
    };

    return (
        <div className="attendance-page inv">
            <div className="page-header"><h1>Attendance</h1><p>Check-ins with selfie and location, who is on the premises, breaks and late arrivals.</p></div>
            <div className="inv-toolbar">
                <input className="input compact" type="date" value={date} onChange={e => setDate(e.target.value)} aria-label="Day" />
                <button className="btn btn-ghost btn-sm" onClick={load}>Refresh</button>
            </div>
            <div className="table-scroll">
                <table className="staff-table">
                    <thead><tr><th>Employee</th><th>In</th><th>Out</th><th>Now</th><th>Selfies</th>{canEdit && <th>App login</th>}<th aria-label="Actions" /></tr></thead>
                    <tbody>{rows.map(r => (
                        <tr key={r.employeeId}>
                            <td><strong>{r.name}</strong><div className="muted small">{r.role} · shift {r.shiftStart}{!r.trackLocation && ' · no tracking'}</div></td>
                            <td>{r.checkIn || '—'}{r.late > 0 && <span className="pill warn">{r.late} min late</span>}
                                {r.distanceIn != null && <div className="muted small">{r.distanceIn} m</div>}</td>
                            <td>{r.checkOut || '—'}{r.autoClosed && <span className="pill warn">auto</span>}</td>
                            <td>{r.onPremises ? <span className={`pill ${TONE[r.onPremises] || 'muted'}`}>{r.onPremises}{r.onPremises === 'break' && ` till ${time(r.breakUntil)}`}
                                {r.onPremises === 'outside' && ` since ${time(r.outsideSince)}`}</span> : <span className="muted">{r.status || 'not in'}</span>}
                                {r.breaks.length > 0 && <div className="muted small">{r.breaks.map(b => `${b.minutes} min ${b.reason}`).join(', ')}</div>}</td>
                            <td className="selfies"><Selfie path={r.selfieIn} /><Selfie path={r.selfieOut} /></td>
                            {canEdit && (
                                <td>
                                    <select className="input compact" value={staff.find(s => r.linked && s.name === r.name)?.id || ''} aria-label={`App login for ${r.name}`}
                                        onChange={e => link(r, { staffId: e.target.value || null })}>
                                        <option value="">{r.linked ? 'Linked' : 'Not linked'}</option>
                                        {staff.map(s => <option key={s.id} value={s.id}>{s.name} · {s.phone}</option>)}
                                    </select>
                                    <label className="check small"><input type="checkbox" checked={r.trackLocation} onChange={e => link(r, { track: e.target.checked })} /> Location tracking</label>
                                    <input className="input compact" type="time" value={r.shiftStart} aria-label={`Shift start for ${r.name}`} onChange={e => link(r, { shiftStart: e.target.value })} />
                                </td>
                            )}
                            <td>{r.attendanceId && <button className="icon-btn" aria-label={`Location of ${r.name}`} onClick={() => setTrail(r)}><FiMapPin /></button>}</td>
                        </tr>
                    ))}{rows.length === 0 && <tr><td colSpan={7} className="empty muted">No employees. Add them in Employees, then link each to their app login here.</td></tr>}</tbody>
                </table>
            </div>

            {hasPerm('settings.edit') && (
                <section className="panel" style={{ marginTop: 16 }}>
                    <h2>Cafe location (geofence)</h2>
                    <p className="muted small">Stand inside the cafe with your phone and tap <strong>Use my location</strong>. Staff can check in only within the radius.</p>
                    <div className="form-grid three">
                        <label className="small">Latitude<input className="input" value={geo.lat} onChange={e => setGeo({ ...geo, lat: e.target.value })} /></label>
                        <label className="small">Longitude<input className="input" value={geo.lng} onChange={e => setGeo({ ...geo, lng: e.target.value })} /></label>
                        <label className="small">Radius (m)<input className="input" type="number" value={geo.radius} onChange={e => setGeo({ ...geo, radius: e.target.value })} /></label>
                        <label className="small">Alert after outside (min)<input className="input" type="number" value={geo.grace} onChange={e => setGeo({ ...geo, grace: e.target.value })} /></label>
                        <label className="small">Check location every (min)<input className="input" type="number" min="5" value={geo.ping} onChange={e => setGeo({ ...geo, ping: e.target.value })} /></label>
                    </div>
                    <h3 className="small" style={{ marginTop: 16 }}>Staff Android app</h3>
                    <p className="muted small">After building a new app (GitHub → Actions → Android app), enter its version code and download link; staff phones then show "new version available".</p>
                    <div className="form-grid three">
                        <label className="small">Latest version code<input className="input" type="number" value={geo.appCode} onChange={e => setGeo({ ...geo, appCode: e.target.value })} /></label>
                        <label className="small">Download link<input className="input" value={geo.appUrl} onChange={e => setGeo({ ...geo, appUrl: e.target.value })} /></label>
                    </div>
                    <div className="btn-row" style={{ marginTop: 8 }}>
                        <button className="btn btn-ghost" onClick={here}><FiMapPin /> Use my location</button>
                        <button className="btn btn-primary" onClick={saveGeo}>Save</button>
                        {geo.lat && <a className="btn btn-ghost" target="_blank" rel="noopener noreferrer" href={`https://maps.google.com/?q=${geo.lat},${geo.lng}`}>Check on map</a>}
                    </div>
                    {msg && <p className="muted small">{msg}</p>}
                </section>
            )}
            {trail && <Trail row={trail} onClose={() => setTrail(null)} />}
        </div>
    );
};

export default AdminAttendance;
