// Current position: the phone's GPS (Android app plugin when available, else the browser)
export async function getPosition({ timeout = 15000 } = {}) {
    const cap = globalThis.Capacitor;
    if (cap?.isNativePlatform?.() && cap.Plugins?.Geolocation) {
        const p = await cap.Plugins.Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout });
        return { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy || 0) };
    }
    if (!navigator.geolocation) throw new Error('This phone has no location access');
    return new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
            p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy || 0) }),
            e => reject(new Error(e.code === 1 ? 'Allow location for this app in the phone settings' : 'Could not get your location. Try near a window.')),
            { enableHighAccuracy: true, timeout, maximumAge: 0 });
    });
}

export const isNativeApp = () => !!globalThis.Capacitor?.isNativePlatform?.();
