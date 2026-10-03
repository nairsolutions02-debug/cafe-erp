import React, { useCallback, useEffect, useState } from 'react';
import { FiCheckCircle, FiAlertCircle, FiSmartphone } from 'react-icons/fi';
import { getSettings } from '../../utils/api';
import { isNativeApp } from '../../lib/geo';
import { enablePush } from '../../lib/push';

const appInfo = () => globalThis.Capacitor?.Plugins?.AppInfo;

// Inside the Android app: walks the person through the phone settings alarms need, and tells
// them when a newer app version is available.
const PhoneSetup = () => {
    const [info, setInfo] = useState(null);
    const [latest, setLatest] = useState(null);
    const [msg, setMsg] = useState('');

    const check = useCallback(async () => {
        try { setInfo(await appInfo().get()); } catch { setInfo(null); }
    }, []);
    useEffect(() => {
        if (!isNativeApp() || !appInfo()) return undefined;
        check();
        getSettings().then(r => setLatest({ code: Number(r.data.app_version_code) || 0, url: r.data.app_download_url || '' })).catch(() => {});
        const onVisible = () => document.visibilityState === 'visible' && check();
        document.addEventListener('visibilitychange', onVisible);
        return () => document.removeEventListener('visibilitychange', onVisible);
    }, [check]);

    if (!info) return null;
    const open = (what) => appInfo().openSettings({ what });
    const steps = [
        { ok: info.fcm, label: 'Alerts service', fix: null, help: 'This app was built without the Firebase file. Ask the owner for the latest app.' },
        { ok: info.notifications, label: 'Notifications allowed', fix: () => open('notifications') },
        { ok: info.fullScreen, label: 'Full-screen alarms allowed', fix: () => open('fullScreen') },
        { ok: info.batteryUnrestricted, label: 'Battery: no restrictions', fix: () => open('battery'),
            help: /xiaomi|redmi|poco|oppo|vivo|realme|oneplus/i.test(info.maker) ? `On ${info.maker} phones also turn on Autostart for this app.` : '' },
    ];
    const allOk = steps.every(s => s.ok);
    const outdated = latest?.code > info.versionCode;

    return (
        <section className="day-card">
            <h2><FiSmartphone /> Phone setup {allOk && <span className="pill ok">ready</span>}</h2>
            {outdated && (
                <p className="pill warn">A new app version is available.{' '}
                    {latest.url && <a href={latest.url} target="_blank" rel="noopener noreferrer">Download</a>}</p>
            )}
            <ul className="setup-steps">
                {steps.map(s => (
                    <li key={s.label} className={s.ok ? 'ok' : 'todo'}>
                        {s.ok ? <FiCheckCircle /> : <FiAlertCircle />}
                        <span>{s.label}{!s.ok && s.help && <small className="muted"> {s.help}</small>}</span>
                        {!s.ok && s.fix && <button className="btn btn-ghost btn-sm" onClick={s.fix}>Fix</button>}
                    </li>
                ))}
            </ul>
            <div className="break-row">
                {info.fcm && <button className="btn btn-secondary" onClick={async () => setMsg((await enablePush()).message)}>Connect alerts</button>}
                <button className="btn btn-ghost" onClick={() => appInfo().testAlarm()}>Test alarm</button>
            </div>
            {msg && <p className="muted small">{msg}</p>}
            <p className="muted small">App version {info.versionName}</p>
        </section>
    );
};

export default PhoneSetup;
