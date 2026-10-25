/* Build template: content hashes and VERSION are replaced by build_mobile_pwa.py. */
'use strict';
const VERSION = 'dd090ee7078145f6b08aeedeffef3aba0cdc83c9cef32c5cbeb65ba77922ad76';
const PRECACHE = [{"url":"./app.js","sha256":"dd1fad740f6ae80abc7435694a8eb90a7f4a803f3d203618b2b20e3e3681cf81"},{"url":"./data.js","sha256":"449f164c22aa7f6b9b94f5a93aff423c977952fbbedfe28c7033c5671c137f5b"},{"url":"./engine.js","sha256":"cb9e3680d9f6a1db269d5f5f0aa570d999ba68c5053b1caef793d4f8434e6e54"},{"url":"./icons/apple-touch-icon.png","sha256":"771d0732bce8a41fdd83c5983d06cee5d8c0c8b55cc298f5b112d2be481ea4f2"},{"url":"./icons/icon-192.png","sha256":"09a9063c21125511959b6ea29af91d929f868edf5a65628bb1ac9f29fc8bdd4a"},{"url":"./icons/icon-512.png","sha256":"3c227e5d3ee4889318c4f3430c09819de0ae6bf30eaa0b6e0e1d3a00409e5d76"},{"url":"./index.html","sha256":"ad8ee466f24c736b5a65c4edc074e749616edac680f970e3cffc4de328519953"},{"url":"./manifest.webmanifest","sha256":"eec0aa32d49845cb907fc3ea2ae85311b2e8bb2b65b4251555b6ebc9c8945013"},{"url":"./pwa.js","sha256":"774e46f92538819a01b3b8ec52d2e8c6016fa4f18cdf564f3c31ebdfab333c15"},{"url":"./style.css","sha256":"875b93d2721d26610fd30b9c7639e903f7902a54cedf856f1d49f4769233caeb"}];
// Isolate apps even when several GitHub Pages projects share this origin.
const SCOPE = self.registration.scope;
const PREFIX = 'estudy-pwa:' + encodeURIComponent(SCOPE) + ':';
const CACHE = PREFIX + VERSION;
const ENTRIES = PRECACHE.map(entry => ({
  url: new URL(entry.url, SCOPE).href, sha256: entry.sha256
}));
const INDEX = new URL('./index.html', SCOPE).href;
const ROOT_URL = new URL('./', SCOPE).href;
const ALLOWED = new Set(ENTRIES.map(entry => entry.url));

async function sha256(buffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest), x => x.toString(16).padStart(2, '0')).join('');
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    try {
      // No partial installation can activate. Hashes also reject mixed deployment files.
      for (const entry of ENTRIES) {
        const response = await fetch(new Request(entry.url, { cache: 'reload', credentials: 'same-origin' }));
        if (!response.ok || response.type === 'opaque' || response.redirected) {
          throw new Error('Precache failed: ' + entry.url);
        }
        if (await sha256(await response.clone().arrayBuffer()) !== entry.sha256) {
          throw new Error('Content hash mismatch: ' + entry.url);
        }
        await cache.put(entry.url, response);
      }
      await cache.put(ROOT_URL, await cache.match(INDEX));
    } catch (error) {
      await caches.delete(CACHE);
      throw error;
    }
    // Deliberately no skipWaiting: page offers explicit user-controlled activation.
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith(PREFIX) && name !== CACHE)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    event.waitUntil(self.skipWaiting());
  }
  if (event.data && event.data.type === 'CACHE_STATUS' && event.ports[0]) {
    event.waitUntil((async () => {
      const ready = (await Promise.all(ENTRIES.map(entry =>
        caches.match(entry.url, { cacheName: CACHE })))).every(Boolean);
      event.ports[0].postMessage({ type: 'CACHE_STATUS', ready: ready, version: VERSION });
    })());
  }
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== new URL(SCOPE).origin || !url.href.startsWith(SCOPE)) return;
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok) return response;
      } catch (error) { /* Cached shell is available without a network. */ }
      return (await caches.match(INDEX, { cacheName: CACHE })) || Response.error();
    })());
    return;
  }
  // Ignore query strings for our versioned, same-scope shell resources only.
  url.search = '';
  url.hash = '';
  if (!ALLOWED.has(url.href)) return;
  event.respondWith((async () => {
    return (await caches.match(url.href, { cacheName: CACHE })) || fetch(request);
  })());
});
