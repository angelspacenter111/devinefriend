/* 
 * Friend - Progressive Web App (PWA) Service Worker
 */

const CACHE_NAME = 'friend-pwa-v1';
const STATIC_ASSETS = [
  '/css/style.css',
  '/css/app-shell.css',
  '/css/responsive.css',
  '/js/custom.js',
  '/manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Network first strategy with cache fallback for static assets
  if (event.request.method === 'GET' && (
    event.request.url.includes('/css/') || 
    event.request.url.includes('/js/') ||
    event.request.url.includes('bootstrap')
  )) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
  }
});
