import React, { useEffect, useRef, useState } from 'react';
import { getMyDay, staffPing, staffBreak, checkPresence } from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import { getPosition } from '../../lib/geo';
import './StaffApp.css';

// Runs inside the admin app: while this person is checked in, report location every few minutes;
// owners/managers' screens run the presence checks (stopped reporting, escalations, auto check-out).
const Presence = () => {
    const { user, hasPerm } = useAuth();
    const [warning, setWarning] = useState(null);
    const timer = useRef(null);

    useEffect(() => {
        if (!user) return undefined;
        let stopped = false;
        const tick = async () => {
            try {
                const day = (await getMyDay()).data;
                if (stopped || !day.linked || !day.trackLocation || !day.today?.checkInAt || day.today.checkOutAt) return;
                const pos = await getPosition({ timeout: 20000 }).catch(() => ({ lat: null, lng: null, accuracy: null }));
                const r = (await staffPing(pos.lat, pos.lng, pos.accuracy)).data;
                if (!stopped) setWarning(r.tracking && r.inside === false && !r.onBreak ? r : null);
            } catch { /* offline or no permission: the owner sees "stopped reporting" */ }
        };
        const start = async () => {
            const day = await getMyDay().then(r => r.data).catch(() => null);
            const minutes = day?.geofence?.pingMinutes || 10;
            tick();
            timer.current = setInterval(tick, minutes * 60000);
        };
        start();
        const onVisible = () => { if (document.visibilityState === 'visible') tick(); };
        document.addEventListener('visibilitychange', onVisible);
        return () => { stopped = true; clearInterval(timer.current); document.removeEventListener('visibilitychange', onVisible); };
    }, [user?.id]);

    useEffect(() => {
        if (!hasPerm('employees.view')) return undefined;
        checkPresence().catch(() => {});
        const t = setInterval(() => checkPresence().catch(() => {}), 120000);
        return () => clearInterval(t);
    }, [hasPerm]);

    if (!warning) return null;
    return (
        <div className="outside-banner" role="alert">
            You are outside the cafe{warning.distance ? ` (${warning.distance} m)` : ''}. Back in 5 min?
            {warning.outsideMinutes < warning.graceMinutes && ` The owner is told after ${warning.graceMinutes} min.`}
            <button onClick={async () => { await staffBreak(15, 'Stepped out'); setWarning(null); window.dispatchEvent(new Event('myday-changed')); }}>Going for a break</button>
        </div>
    );
};

export default Presence;
