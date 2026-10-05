// One shared audio player for alarms and the kitchen beep.
// Browsers keep sound off until the person taps the page once; a player made before that tap stays
// silent, so this one is switched on at the first tap or key press and the app can show "tap for sound".
let ctx = null;
const EVENT = 'soundready';

const make = () => {
    if (!ctx) {
        const A = window.AudioContext || window.webkitAudioContext;
        if (!A) return null;
        ctx = new A();
    }
    return ctx;
};

export const soundReady = () => !!ctx && ctx.state === 'running';

export const unlockSound = () => {
    const c = make();
    if (!c) return;
    if (c.state === 'suspended') c.resume().then(() => window.dispatchEvent(new Event(EVENT))).catch(() => {});
    else window.dispatchEvent(new Event(EVENT));
};

export const onSoundReady = (fn) => {
    window.addEventListener(EVENT, fn);
    return () => window.removeEventListener(EVENT, fn);
};

if (typeof window !== 'undefined') {
    const first = () => {
        unlockSound();
        if (soundReady()) {
            window.removeEventListener('pointerdown', first, true);
            window.removeEventListener('keydown', first, true);
        }
    };
    window.addEventListener('pointerdown', first, true);
    window.addEventListener('keydown', first, true);
}

// Short tones: [[delay seconds, frequency], ...]
export const playTones = (tones, length = 0.16, volume = 0.3) => {
    const c = make();
    if (!c) return false;
    if (c.state === 'suspended') c.resume().catch(() => {});
    if (c.state !== 'running') return false;
    tones.forEach(([t, f]) => {
        const o = c.createOscillator();
        const g = c.createGain();
        o.frequency.value = f;
        g.gain.value = volume;
        o.connect(g);
        g.connect(c.destination);
        o.start(c.currentTime + t);
        o.stop(c.currentTime + t + length);
    });
    return true;
};
