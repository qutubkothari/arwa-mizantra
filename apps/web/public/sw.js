// Keep this version in step with the registration URL in PWARegister.  A new
// worker clears bundles from previous releases before it takes control.
const CACHE_NAME = 'saif-erp-shell-v6';
const SHELL_ASSETS = [
  '/',
  '/login',
  '/offline.html',
  '/favicon.svg',
  '/pwa-icon.svg',
  '/pwa-icon-192.png',
  '/pwa-icon-512.png',
  '/manifest.webmanifest'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== 'GET') return;
  // Browser extensions can issue requests while this service worker is active.
  // Cache Storage only accepts http(s) requests from this app, so never try to
  // cache extension, DevTools, or any other cross-origin request.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(async () => (await caches.match(request)) || caches.match('/offline.html'))
    );
    return;
  }

  if (url.pathname.startsWith('/_next/static/') || url.pathname.match(/\.(css|js|svg|png|jpg|jpeg|webp|woff2?)$/)) {
    event.respondWith(
      // Next.js chunks must always be fetched first.  Cache-first here can
      // serve an old chunk after a release and leave the app as a white page.
      fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      }).catch(() => caches.match(request))
    );
  }
});
