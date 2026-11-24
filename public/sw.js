// Kolot Music Service Worker v7 - Network-First Navigation + Local Offline Fallback
const CACHE_NAME = 'kolot-music-v7';
const OFFLINE_URL = '/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.add(new Request(OFFLINE_URL, { cache: 'reload' })))
      .catch(() => {})
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  // Never intercept cross-origin requests (Google Analytics / Tag Manager, FormSubmit, APIs, CDNs) or Vite dev assets
  if (
    event.request.method !== 'GET' ||
    !url.startsWith(self.location.origin) ||
    url.includes('/api/') ||
    url.includes('/assets/') ||
    url.includes('/@') ||
    url.includes('/src/') ||
    url.includes('node_modules') ||
    url.startsWith('blob:')
  ) {
    return;
  }

  // Always fetch fresh HTML when online; serve locally cached /offline.html when offline
  if (event.request.mode === 'navigate' || event.request.destination === 'document') {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' }).catch(async () => {
        const offlineFallback = await caches.match(OFFLINE_URL, { ignoreSearch: true });
        if (offlineFallback) return offlineFallback;
        return caches.match('/index.html');
      })
    );
    return;
  }
});
