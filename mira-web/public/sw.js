const CACHE_NAME = 'factorylm-v3';
const PRECACHE_URLS = ['/', '/cmms', '/pricing', '/manifest.json', '/_tokens.css', '/_components.css'];
const API_PREFIXES = ['/api/', '/demo/'];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE_URLS))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Never intercept API or demo endpoints — always live
  if (API_PREFIXES.some(p => url.pathname.startsWith(p))) return;

  // Network-first for HTML navigations so deploys are visible immediately.
  // Falls back to cached HTML only on offline failure.
  const isHtmlNav =
    event.request.mode === 'navigate' ||
    event.request.destination === 'document';

  if (isHtmlNav) {
    event.respondWith(
      fetch(event.request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
        }
        return response;
      }).catch(() => caches.match(event.request))
    );
    return;
  }

  // Cache-first for static assets (CSS, JS, images, fonts).
  event.respondWith(
    caches.match(event.request).then(cached =>
      cached || fetch(event.request).then(response => {
        if (response.ok && event.request.method === 'GET') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
        }
        return response;
      })
    )
  );
});
