// Kolot Music Service Worker v6 - Network-First Navigation (Prevents White Screen on Deploy)
const CACHE_NAME = 'kolot-music-v6';

self.addEventListener('install', (event) => {
  // Activate immediately so old broken caches are purged right away
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((key) => caches.delete(key)))
    ).then(() => self.clients.claim())
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

  // Always fetch fresh HTML for navigation so new Cloudflare deploys never load stale hashed assets
  if (event.request.mode === 'navigate' || event.request.destination === 'document') {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' }).catch(() => caches.match('/index.html'))
    );
    return;
  }
});
