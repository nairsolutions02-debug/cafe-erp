import React, { useCallback, useEffect, useState } from 'react';
import { getDevices, setDeviceActive, getSetupStatus } from '../utils/api';
import { getDevice, forgetDevice } from '../lib/device';
import InfoTip from './help/InfoTip';

// Settings → Devices: every counter, kiosk and kitchen screen that has opened the app.
// Turning one off frees a kiosk slot; that screen asks to be set up again if it is used later.
const KIND = { counter: 'Counter', kiosk: 'Kiosk', kitchen: 'Kitchen screen', phone: 'Phone' };
const seen = (iso) => {
    if (!iso) return 'Not seen yet';
    const days = Math.floor((Date.now() - new Date(iso).getTime()) / 864e5);
    if (days < 1) return 'Used today';
    if (days === 1) return 'Last used yesterday';
    return `Last used ${days} days ago`;
};

const DevicesCard = ({ canEdit }) => {
    const [devices, setDevices] = useState([]);
    const [limits, setLimits] = useState(null);
    const [showOff, setShowOff] = useState(false);
    const [msg, setMsg] = useState('');
    const load = useCallback(() => {
        getDevices().then(r => setDevices(r.data)).catch(() => {});
        getSetupStatus().then(r => setLimits(r.data)).catch(() => {});
    }, []);
    useEffect(() => { load(); }, [load]);

    const mine = Object.keys(KIND).map(k => getDevice(k)?.code).filter(Boolean);
    const toggle = async (d) => {
        try {
            await setDeviceActive(d.id, !d.isActive);
            if (d.isActive && mine.includes(d.code)) forgetDevice(d.kind);
            setMsg(d.isActive ? `${d.code} turned off.` : `${d.code} is back on.`);
            load();
        } catch (err) {
            setMsg(err.response?.data?.message || err.message);
        }
    };
    const list = devices.filter(d => showOff || d.isActive);
    const off = devices.filter(d => !d.isActive).length;

    return (
        <div className="settings-card devices-card">
            <h2>Devices<InfoTip k="devices" /></h2>
            <p className="hint">
                Every counter, kiosk and kitchen screen gets a short code (C1, K1, D1) the first time it is used.
                Turn off old or lost ones to keep this list clean
                {limits?.maxKiosks != null && <> and free kiosk slots: <b>{limits.kiosksActive} of {limits.maxKiosks}</b> kiosk slots in use</>}.
            </p>
            {msg && <p className="devices-msg" role="status">{msg}</p>}
            <ul className="devices-list">
                {list.map(d => (
                    <li key={d.id} className={d.isActive ? '' : 'off'}>
                        <b>{d.code}</b>
                        <span>{KIND[d.kind] || d.kind}{mine.includes(d.code) ? ' · this device' : ''}<small>{seen(d.lastSeenAt || d.createdAt)}{d.registeredBy ? ` · added by ${d.registeredBy}` : ''}</small></span>
                        {canEdit && <button type="button" className="btn btn-ghost btn-sm" onClick={() => toggle(d)}>{d.isActive ? 'Turn off' : 'Turn on'}</button>}
                    </li>
                ))}
                {list.length === 0 && <li className="off">No devices yet.</li>}
            </ul>
            {off > 0 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowOff(v => !v)}>{showOff ? 'Hide turned-off devices' : `Show turned-off devices (${off})`}</button>}
        </div>
    );
};

export default DevicesCard;
