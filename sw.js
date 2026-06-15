const CACHE = 'balenco-v29';
const SHELL = ['/', '/index.html', '/logo.png', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png'];

// Install — cache the app shell
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
  self.skipWaiting();
});

// Activate — delete old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch — network first for API calls, cache first for app shell
self.addEventListener('fetch', e => {
  const url = e.request.url;

  // Always go network for Supabase, Stripe, and external resources
  if (
    url.includes('supabase.co') ||
    url.includes('stripe.com') ||
    url.includes('resend.com') ||
    !url.startsWith(self.location.origin)
  ) return;

  e.respondWith(
    caches.match(e.request).then(cached => {
      const network = fetch(e.request).then(res => {
        if (res && res.ok) {
          caches.open(CACHE).then(c => c.put(e.request, res.clone()));
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});

// Push — show a notification when the server sends one
self.addEventListener('push', e => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { data = { body: e.data ? e.data.text() : '' }; }
  const title = data.title || 'Balenco';
  e.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag || 'balenco',
    data: { url: data.url || '/' }
  }));
});

// Notification click — focus the app if open, otherwise open it
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(wins => {
      for (const w of wins) {
        if (w.url.startsWith(self.location.origin) && 'focus' in w) return w.focus();
      }
      return self.clients.openWindow(url);
    })
  );
});
