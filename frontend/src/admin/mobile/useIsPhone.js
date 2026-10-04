import { useSyncExternalStore } from 'react';

const QUERY = '(max-width: 768px)';
const subscribe = (cb) => {
    const m = window.matchMedia(QUERY);
    m.addEventListener('change', cb);
    return () => m.removeEventListener('change', cb);
};

// True on phone-width screens (the width where the bottom bar shows)
export default function useIsPhone() {
    return useSyncExternalStore(subscribe, () => window.matchMedia(QUERY).matches, () => false);
}
