// Service Worker – macht die App installierbar und offlinefähig.
// VERSION wird vom Server beim Ausliefern durch einen Hash aller App-Dateien ersetzt,
// sodass jede Änderung automatisch eine Aktualisierung auf den Geräten auslöst.
const VERSION = 'grbz-v1.0.0';
const SHELL = `${VERSION}-shell`;
const MEDIA = 'grbz-media-v1';
const PRECACHE = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/css/app.css',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/icons/icon.svg',
  '/js/api.js',
  '/js/app.js',
  '/js/icons.js',
  '/js/idb.js',
  '/js/media.js',
  '/js/routes.js',
  '/js/scanner.js',
  '/js/store.js',
  '/js/ui.js',
  '/shared/constants.js',
  '/shared/dates.js',
  '/shared/entities.js',
  '/shared/rules.js',
  '/vendor/jsQR.js',
  '/js/views/admin.js',
  '/js/views/checklists.js',
  '/js/views/common.js',
  '/js/views/customers.js',
  '/js/views/dashboard.js',
  '/js/views/documents.js',
  '/js/views/machines.js',
  '/js/views/materials.js',
  '/js/views/objects.js',
  '/js/views/orders.js',
  '/js/views/portal.js',
  '/js/views/qr.js',
  '/js/views/quality.js',
  '/js/views/reports.js',
  '/js/views/staff.js',
  '/js/views/time.js',
  '/js/views/winter.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== SHELL && key !== MEDIA) await caches.delete(key);
    await self.clients.claim();
  })());
});

const offlineJson = () => new Response(JSON.stringify({ offline: true, error: 'Keine Verbindung zum Server.' }), { status: 503, headers: { 'Content-Type': 'application/json' } });

async function trimMedia() {
  const c = await caches.open(MEDIA);
  const keys = await c.keys();
  for (const k of keys.slice(0, Math.max(0, keys.length - 400))) await c.delete(k);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // App-Navigation (inkl. QR-Links /q/…): Netz zuerst, offline aus dem Cache
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), 4000);
        const res = await fetch(req, { signal: ctl.signal });
        clearTimeout(t);
        return res;
      } catch {
        return (await caches.match('/index.html')) || offlineJson();
      }
    })());
    return;
  }

  // Fotos, QR-Grafiken, Logo: einmal laden, dann aus dem Cache (auch offline sichtbar)
  if (/^\/api\/photos\/[^/]+\/file/.test(url.pathname) || /^\/api\/qr\/[^/]+\.svg$/.test(url.pathname) || url.pathname === '/api/branding/logo') {
    event.respondWith((async () => {
      const c = await caches.open(MEDIA);
      const hit = await c.match(req);
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res.ok) { c.put(req, res.clone()); trimMedia(); }
        return res;
      } catch { return new Response('', { status: 504 }); }
    })());
    return;
  }

  // Übrige API: immer Netz (Daten kommen offline aus IndexedDB)
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(req).catch(offlineJson));
    return;
  }

  // App-Dateien: aus dem Cache der aktuellen Version (konsistenter Stand),
  // Aktualisierung erfolgt über eine neue Service-Worker-Version.
  event.respondWith((async () => {
    const hit = await caches.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try { return await fetch(req); } catch { return new Response('', { status: 504 }); }
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});
