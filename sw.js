const CACHE = 'balenco-v2';
const SHELL = ['/', '/index.html', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png'];

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
