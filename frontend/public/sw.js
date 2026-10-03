// Service worker: keeps the app shell available offline and shows phone alerts while the app is closed.
const CACHE = 'cafe-shell-v1';

self.addEventListener('install', (e) => {
    e.waitUntil(caches.open(CACHE).then(c => c.addAll(['/', '/icon-192.png'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
    e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
        .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
    const req = e.request;
    const url = new URL(req.url);
    if (req.method !== 'GET' || url.origin !== self.location.origin) return;
    // Pages: network first, fall back to the cached app shell when offline
    if (req.mode === 'navigate') {
        e.respondWith(fetch(req).then(res => {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put('/', copy));
            return res;
        }).catch(() => caches.match('/')));
        return;
    }
    // Built files have a hash in their name, so a cached copy never goes stale
    if (url.pathname.startsWith('/assets/')) {
        e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(req, copy));
            return res;
        })));
    }
});

self.addEventListener('push', (e) => {
    let d = {};
    try { d = e.data ? e.data.json() : {}; } catch { d = { title: e.data?.text() }; }
    const alarm = d.style === 'alarm';
    e.waitUntil(self.registration.showNotification(d.title || 'New alert', {
        body: d.body || '',
        tag: d.id || undefined,
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        data: { link: d.link || '/admin' },
        requireInteraction: alarm,
        renotify: alarm,
        silent: d.style === 'normal',
        vibrate: alarm ? [500, 200, 500, 200, 500, 200, 500] : d.style === 'loud' ? [300, 100, 300] : undefined,
    }));
});

self.addEventListener('notificationclick', (e) => {
    e.notification.close();
    const link = e.notification.data?.link || '/admin';
    e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
        const open = list.find(c => c.url.startsWith(self.location.origin));
        if (open) { open.navigate(link); return open.focus(); }
        return self.clients.openWindow(link);
    }));
});
