// /service-worker.js  (FINAL: 2026-02-02-27)
// Fix: Lizenz persistent im SW speichern (überlebt Updates / kalte Starts)
// + Patienten 1–40 + QR 1–40 + Szenarien 1–8
// + patienten.json network-first (iPad/PWA Cache-Falle gelöst)
// + Duplikat-RespondWith-Block entfernt

const CACHE_VERSION = 'app-v2025-12-28-9';
const CACHE_NAME = `mein-pwa-cache-${CACHE_VERSION}`;
const OFFLINE_URL = '/offline.html';

// ✅ Persistenter Lizenz-Store (wird NICHT bei Updates gelöscht)
const LICENSE_STORE_CACHE = 'license-store-v1';
const LICENSE_STORE_URL   = '/__license_store__';

// ——— Kanonische Pfade (Groß/Klein abfangen) ———
const CANON_ALIASES = {
  '/Index1.html': '/index1.html',
  '/Instruktor.html': '/instruktor.html',
  '/Status4a.html': '/status4a.html',

  // Patient Aliases 1–40
  ...Object.fromEntries(Array.from({ length: 40 }, (_, i) => {
    const n = i + 1;
    return [`/Patient${n}.html`, `/patient${n}.html`];
  })),
};

function hasExt(p) { return /\.[a-z0-9]+$/i.test(p); }
function canonPath(pathname) {
  let p = (CANON_ALIASES[pathname] || pathname || '/').toLowerCase();
  if (p === '/') return '/index.html';
  if (!hasExt(p)) p += '.html';
  return p;
}

// ============================================================
// ✅ Lizenz-Persistenz helper
// ============================================================
async function persistLicense(lic){
  try{
    const c = await caches.open(LICENSE_STORE_CACHE);
    if (!lic){
      await c.delete(LICENSE_STORE_URL);
      return;
    }
    await c.put(
      LICENSE_STORE_URL,
      new Response(JSON.stringify(lic), {
        headers:{'Content-Type':'application/json'}
      })
    );
  }catch(e){
    console.warn('[SW] persistLicense failed', e);
  }
}

async function loadPersistedLicense(){
  try{
    const c = await caches.open(LICENSE_STORE_CACHE);
    const r = await c.match(LICENSE_STORE_URL);
    if (!r) return null;
    return await r.json();
  }catch(e){
    console.warn('[SW] loadPersistedLicense failed', e);
    return null;
  }
}

// -------------------- INSTALL --------------------
self.addEventListener('install', (event) => {
  console.log('[SW] Install…');

  // Patienten 1–40 (lc + uc)
  const PATIENT_PAGES_LC = Array.from({ length: 40 }, (_, i) => `/patient${i + 1}.html`);
  const PATIENT_PAGES_UC = Array.from({ length: 40 }, (_, i) => `/Patient${i + 1}.html`);

  // QR Patient 1–40 (mit Leerzeichen URL-encoded)
  const QR_PATIENT_IMAGES = [
    ...Array.from({ length: 40 }, (_, i) => `/qr/Patient%20${i + 1}.png`),
  ];

  // Szenarien 1–8:
  // Wir unterstützen BEIDE Varianten:
  // 1) /qr/Szenario 1.png (mit Leerzeichen)
  // 2) /qr/szenario1.png (ohne Leerzeichen, klein) — weil du das aktuell im SW hast
  const QR_SCENARIOS_SPACE = [
    ...Array.from({ length: 8 }, (_, i) => `/qr/Szenario%20${i + 1}.png`),
  ];
  const QR_SCENARIOS_LOWER = [
    ...Array.from({ length: 8 }, (_, i) => `/qr/szenario${i + 1}.png`),
  ];

  const QR_IMAGES = [
    ...QR_PATIENT_IMAGES,
    ...QR_SCENARIOS_SPACE,
    ...QR_SCENARIOS_LOWER,
    // optional:
    // '/qr/placeholder.png',
  ];

  const PRECACHE_URLS = [
    '/', '/index.html', OFFLINE_URL,

    '/index1.html', '/instruktor.html',
    '/auswertung.html','/btninstruktor.html',
    '/kontakt.html','/patienten.html',
    '/qr.html','/status4.html','/status4a.html','/status4b.html','/status4c.html',
    '/uebung.html','/uebungsanleitung.html','/szenario.html','/ablage1.html',
    '/klinik.html',

    ...PATIENT_PAGES_LC,
    ...PATIENT_PAGES_UC,

    '/btn1style.css','/menustyle.css','/styles.css','/stylesauswertung.css','/app-flow.css',

    // Scripts
    '/button1.js','/button2.js','/sperrung.js','/timer.js',
    '/license.js','/warmup.js','/warmup-banner.js','/scanner.js','/szenarien.js',
    '/freigabe.js','/ablage.js?v=7',
    '/vendor/jsqr.min.js',

    // Assets
    '/Alarmton2.mp3','/status1_pre.mp3','/Patientenverschlechterung.mp3',
    '/Leit1.jpg','/LogoApp.jpg','/Patientenkarte.jpg',
    '/apple-touch-icon.png','/logoneu.png','/IMG_4004.JPG','/hinter1.JPEG','/achtung.jpg',

    // deine bisherigen Fotos (unverändert)
    '/pat1amesser.JPG','/pat2amesser.JPG','/pat3amesser.JPG','/pat4amesser.JPEG','/pat5amesser.JPG',
    '/pat6amesser.JPG','/pat7amesser.JPG','/pat8amesser.JPG','/pat9amesser.PNG','/pat10amesser.JPG',
    '/pat11amesser.PNG','/pat12amesser.png','/pat12bmesser.png','/pat13amesser.JPG',

    '/scan1.JPG','/scan2.JPG','/scan3.JPG','/scan4.JPG','/scan5.JPG',
    '/scan6.JPG','/scan7.JPG','/scan8.JPG','/scan9.JPG','/scan10.JPG',

    '/polizei350.jpg','/step1.PNG','/step2.PNG','/step3.PNG','/step4.PNG','/step5.PNG',
    '/manifest.json','/icon-192.png','/icon-512.png',

    // Patientenliste (bleibt drin, ABER wird per fetch-regel network-first aktualisiert)
    '/patienten.json',

    ...QR_IMAGES,
  ];

  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(PRECACHE_URLS.map(async (u) => {
      try { await cache.add(u); }
      catch (e) { console.warn('[SW] skip Precache:', u, e && e.message); }
    }));
  })());

  self.skipWaiting();
});

// -------------------- ACTIVATE --------------------
self.addEventListener('activate', (event) => {
  console.log('[SW] Aktiviert');

  event.waitUntil((async () => {
    // alte Caches löschen – aber Lizenz-Store behalten!
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => {
      if (k === CACHE_NAME) return Promise.resolve();
      if (k === LICENSE_STORE_CACHE) return Promise.resolve(); // <<< niemals löschen
      return caches.delete(k);
    }));

    // Navigation Preload aktivieren (wenn verfügbar)
    if ('navigationPreload' in self.registration) {
      try { await self.registration.navigationPreload.enable(); } catch {}
    }

    // kanonische Duplikate aus Cache entfernen
    const c = await caches.open(CACHE_NAME);
    const reqs = await c.keys();
    await Promise.all(reqs.map(async (req) => {
      const p = new URL(req.url).pathname;
      if (CANON_ALIASES[p]) { await c.delete(req); }
    }));

    await self.clients.claim();

    // Clients informieren (optional)
    const clientsList = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
    for (const cl of clientsList) {
      cl.postMessage({ type: 'PRECACHE_DONE', version: CACHE_VERSION });
    }
  })());
});

// -------------------- FETCH --------------------
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;

  // Netlify Functions immer live
  if (url.pathname.startsWith('/.netlify/functions/')) {
    event.respondWith(fetch(request, { cache: 'no-store' }));
    return;
  }
  // ✅ AUDIO (.mp3) immer NETWORK-FIRST + Cache mit vollem Request (inkl. Query)
  if (sameOrigin && url.pathname.endsWith('.mp3')) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request, { cache: 'no-store' });
        if (fresh && (fresh.ok || fresh.type === 'opaque')) {
          const c = await caches.open(CACHE_NAME);
          await c.put(request, fresh.clone()); // Query bleibt erhalten
        }
        return fresh;
      } catch {
        const cached = await caches.match(request); // KEIN ignoreSearch!
        return cached || caches.match(OFFLINE_URL);
      }
    })());
    return;
  }

  // ✅ Patientenliste: IMMER frisch (löst "nur 20 Patienten" / iPad PWA Cache)
  if (sameOrigin && (url.pathname === '/patienten.json' || url.pathname === '/patients.json')) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request, { cache: 'no-store' });
        if (fresh && (fresh.ok || fresh.type === 'opaque')) {
          const c = await caches.open(CACHE_NAME);
          // ohne query speichern (stabiler)
          await c.put(new Request(url.pathname), fresh.clone());
        }
        return fresh;
      } catch {
        const cached = await caches.match(new Request(url.pathname), { ignoreSearch: true });
        return cached || new Response('[]', { headers: { 'Content-Type': 'application/json' } });
      }
    })());
    return;
  }

  // Immer frisch laden: zentrales App-Script (falls du es nutzt)
  if (sameOrigin && url.pathname === '/script.js') {
    event.respondWith((async () => {
      try {
        const netRes = await fetch(request, { cache: 'no-store' });
        if (netRes && (netRes.ok || netRes.type === 'opaque')) {
          const c = await caches.open(CACHE_NAME);
          await c.put(request, netRes.clone());
        }
        return netRes;
      } catch {
        const cached = await caches.match(request);
        if (cached) return cached;
        const noQueryReq = new Request(url.origin + url.pathname);
        const old = await caches.match(noQueryReq);
        if (old) return old;
        return caches.match(OFFLINE_URL);
      }
    })());
    return;
  }

  // Niemals cachen: Lizenz / Checkins
  if (
    url.pathname === '/license.php' ||
    url.pathname === '/licenses.json' ||
    url.pathname === '/checkin.php' ||
    (url.hostname === '1rettungsmittel.de' && (
      url.pathname === '/license.php' ||
      url.pathname === '/licenses.json' ||
      url.pathname === '/checkin.php'
    )) ||
    url.pathname.endsWith('/freigabe.json') ||
    (url.hostname === 'www.1rettungsmittel.de' && url.pathname.endsWith('/check.php'))
  ) {
    event.respondWith(fetch(request, { cache: 'no-store' }));
    return;
  }

  // Immer frisch + spiegeln: freigabe.js / license.js / sperrung.js
  if (sameOrigin && (
    url.pathname.endsWith('/freigabe.js') ||
    url.pathname.endsWith('/license.js') ||
    url.pathname.endsWith('/sperrung.js')
  )) {
    event.respondWith((async () => {
      try {
        const netRes = await fetch(request, { cache: 'no-store' });
        if (netRes && (netRes.ok || netRes.type === 'opaque')) {
          const c = await caches.open(CACHE_NAME);
          const keyReq = new Request(url.pathname);
          await c.put(keyReq, netRes.clone());
        }
        return netRes;
      } catch {
        const cached = await caches.match(new Request(url.pathname), { ignoreSearch: true });
        if (cached) return cached;
        return new Response(`/* offline stub for ${url.pathname} */`, {
          headers: { 'Content-Type': 'application/javascript' }
        });
      }
    })());
    return;
  }

  // QR-Bilder
  if (url.pathname.startsWith('/qr/') && /\.(png|jpe?g|webp|gif)$/i.test(url.pathname)) {
    event.respondWith((async () => {
      const cached = await caches.match(request, { ignoreSearch: true });
      if (cached) return cached;
      try {
        const netRes = await fetch(request);
        if (netRes && (netRes.ok || netRes.type === 'opaque')) {
          const c = await caches.open(CACHE_NAME);
          await c.put(request, netRes.clone());
        }
        return netRes;
      } catch {
        const fallback = await caches.match('/qr/placeholder.png');
        if (fallback) return fallback;
        return caches.match(OFFLINE_URL);
      }
    })());
    return;
  }

  // Kritische Seiten network-first
  if (sameOrigin && (
     url.pathname === '/index1.html'||
    url.pathname === '/klinik.html' ||
    url.pathname === '/ablage1.html' ||
    url.pathname === '/auswertung.html'
  )) {
    event.respondWith(networkFirst(request));
    return;
  }

  // Niemals cachen: metrics.js (immer frisch laden)
  if (sameOrigin && url.pathname === '/metrics.js') {
    event.respondWith(fetch(request, { cache: 'no-store' }));
    return;
  }

  // HTML / Navigationsdokumente
  const isNav =
    request.mode === 'navigate' ||
    request.destination === 'document' ||
    url.pathname === '/' ||
    url.pathname.endsWith('.html');

  if (isNav) {
    event.respondWith((async () => {
      const isIndex = (url.pathname === '/' || url.pathname.toLowerCase().endsWith('/index.html'));

      // Index immer network-first
      if (isIndex) return networkFirst(request);

      const keyPath = canonPath(url.pathname);
      const keyReq  = new Request(keyPath);

      let cached = await caches.match(keyReq, { ignoreSearch: true });
      if (cached) {
        fetch(request, { cache: 'no-store', redirect: 'follow' }).then(async res => {
          if (!res) return;
          let finalRes  = res;
          let finalPath = keyPath;

          if (res.redirected && res.url) {
            finalPath = canonPath(new URL(res.url).pathname);
            try {
              const f = await fetch(res.url, { cache: 'no-store', redirect: 'follow' });
              if (f && f.ok) finalRes = f;
            } catch {}
          }
          if (finalRes && (finalRes.ok || finalRes.type === 'opaque')) {
            const c = await caches.open(CACHE_NAME);
            await c.put(new Request(finalPath), finalRes.clone());
          }
        }).catch(()=>{});
        return cached;
      }

      try {
        const preload = ('navigationPreload' in self.registration)
          ? await event.preloadResponse
          : null;

        let netRes   = preload || await fetch(request, { cache: 'no-store', redirect: 'follow' });
        let finalRes = netRes;
        let finalPath = keyPath;

        if (netRes && netRes.redirected && netRes.url) {
          finalPath = canonPath(new URL(netRes.url).pathname);
          const f = await fetch(netRes.url, { cache: 'no-store', redirect: 'follow' });
          if (f && f.ok) finalRes = f;
        }

        if (finalRes && (finalRes.ok || finalRes.type === 'opaque')) {
          const c = await caches.open(CACHE_NAME);
          await c.put(new Request(finalPath), finalRes.clone());
        }
        return finalRes;
      } catch {
        const idx = await caches.match('/index.html', { ignoreSearch: true });
        if (idx) return idx;
        return caches.match(OFFLINE_URL);
      }
    })());
    return;
  }

  // Sonstige Assets: cache-first (nur EINMAL – Duplikat entfernt)
  event.respondWith((async () => {
    const cached = await caches.match(request, { ignoreSearch: true });
    if (cached) return cached;
    try {
      const netRes = await fetch(request);
      if (netRes && (netRes.ok || netRes.type === 'opaque')) {
        const c = await caches.open(CACHE_NAME);
        await c.put(request, netRes.clone());
      }
      return netRes;
    } catch {
      return caches.match(OFFLINE_URL);
    }
  })());
});

// --------- Helpers ----------
async function networkFirst(request) {
  try {
    const fresh = await fetch(request, { cache: 'no-store' });
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, fresh.clone());
    return fresh;
  } catch {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    return caches.match(OFFLINE_URL);
  }
}

// ---------------- PUSH / NOTIFICATIONS ----------------
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data?.json() || {}; } catch {}

  const title = data.title || '1Rettungsmittel';
  const body  = data.body  || '';
  const url   = data.url   || '/index.html';
  const options = {
    body, icon: '/icon-192.png', badge: '/icon-192.png',
    data: { url, ts: Date.now() }
  };

  event.waitUntil((async () => {
    const all = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      c.postMessage({ type: 'PUSH', title, body, payload: options.data });
      c.postMessage({ type: 'INBOX_PING', ts: Date.now() });
    }
    await self.registration.showNotification(title, options);
    await new Promise(r => setTimeout(r, 600));
    const again = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of again) c.postMessage({ type: 'INBOX_PING', ts: Date.now() });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/index.html';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    let client = all.find(c => {
      try { return new URL(c.url).origin === self.location.origin; }
      catch { return false; }
    });

    if (client) {
      await client.focus();
      try { await client.navigate(targetUrl); } catch {}
    } else {
      await self.clients.openWindow(targetUrl);
    }
  })());
});

// ============================================================
// ✅ LIZENZ-VERWALTUNG (App ↔ Service Worker)  PERSISTENT
// ============================================================
let currentLicense = null;

// Beim Aktivieren Lizenz aus Store laden (falls vorhanden)
self.addEventListener('activate', (event) => {
  event.waitUntil((async ()=>{
    const lic = await loadPersistedLicense();
    if (lic) {
      currentLicense = lic;
      console.log('[SW] Lizenz aus Store restauriert:', currentLicense);
    }
  })());
});

self.addEventListener('message', (event) => {
  const msg = event.data;
  if (!msg?.type) return;

  event.waitUntil((async ()=>{
    switch (msg.type) {

      case 'SET_LICENSE': {
        currentLicense = msg.payload || null;
        await persistLicense(currentLicense);
        console.log('[SW] Lizenz gespeichert (RAM + Store):', currentLicense);
        break;
      }

      case 'GET_LICENSE': {
        if (!currentLicense) {
          currentLicense = await loadPersistedLicense();
          if (currentLicense) {
            console.log('[SW] GET_LICENSE → Restore aus Store:', currentLicense);
          }
        }
        event.source?.postMessage({
          type: 'LICENSE_VALUE',
          payload: currentLicense
        });
        break;
      }

      case 'LICENSE_PING': {
        event.source?.postMessage({ type:'LICENSE_PONG', ts: Date.now() });
        break;
      }

      default:
        break;
    }
  })());
});



























