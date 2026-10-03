// Phone alerts: Web Push on Android Chrome / iPhone home-screen app, FCM inside the Android APK.
// Needs VITE_VAPID_PUBLIC_KEY (web) or the Firebase setup (APK) — see RELEASES.md, Phase 5.
import { savePushSubscription } from '../utils/api';

const VAPID = import.meta.env.VITE_VAPID_PUBLIC_KEY || '';
const native = () => globalThis.Capacitor?.isNativePlatform?.();

const urlB64 = (b64) => {
    const pad = '='.repeat((4 - (b64.length % 4)) % 4);
    const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
};

export function pushStatus() {
    if (native()) return { canEnable: true, message: 'Alerts come through the app (full-screen alarms need the setup steps in the app).' };
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        return { canEnable: false, message: 'This browser can\'t receive alerts when closed. On iPhone: Share → Add to Home Screen, then open it from there.' };
    }
    if (!VAPID) return { canEnable: false, message: 'Phone alerts are not set up for this cafe yet (needs the push key). Alerts still ring while the app is open.' };
    if (Notification.permission === 'granted') return { canEnable: true, message: 'Alerts are on for this phone. Tap again to refresh.' };
    if (Notification.permission === 'denied') return { canEnable: false, message: 'Notifications are blocked for this site. Allow them in the phone settings.' };
    return { canEnable: true, message: 'Get orders, payment requests and other alerts even when the app is closed.' };
}

export async function enablePush() {
    try {
        if (native()) {
            const { PushNotifications } = globalThis.Capacitor.Plugins;
            const perm = await PushNotifications.requestPermissions();
            if (perm.receive !== 'granted') return { canEnable: true, message: 'Allow notifications for the app, then try again.' };
            await new Promise((resolve, reject) => {
                PushNotifications.addListener('registration', async (t) => {
                    await savePushSubscription(t.value, {}, 'android');
                    resolve();
                });
                PushNotifications.addListener('registrationError', (e) => reject(new Error(e.error || 'Registration failed')));
                PushNotifications.register();
            });
            return { canEnable: true, message: 'Alerts are on for this phone.' };
        }
        const reg = await navigator.serviceWorker.ready;
        const perm = await Notification.requestPermission();
        if (perm !== 'granted') return pushStatus();
        const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64(VAPID) });
        const json = sub.toJSON();
        await savePushSubscription(json.endpoint, json.keys, 'web');
        return { canEnable: true, message: 'Alerts are on for this phone.' };
    } catch (err) {
        return { canEnable: true, message: `Could not turn on alerts: ${err.message}` };
    }
}
