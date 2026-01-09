// /warmup.js – Offline-"Vorladen" für deine PWA
// Läuft nur 1x pro Tab/Sitzung und nur, wenn online.

(async () => {
  const WARMUP_VERSION = '2025-08-23-3';             // ← bei Änderungen erhöhen
  const SESSION_FLAG   = `WARMUP_DONE_${WARMUP_VERSION}`;
  const CACHE_PREFIX   = 'mein-pwa-cache-';

  // Nur einmal pro Tab & nur online
  if (sessionStorage.getItem(SESSION_FLAG)) return;
  if (!navigator.onLine || !('serviceWorker' in navigator)) return;

  try { await navigator.serviceWorker.ready; } catch { return; }

  // Auf PRECACHE_DONE warten (SW hat Kontrolle) – robuster Dual-Listener
  const swReady = new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; cleanup(); resolve(true); } };

    const handler = (ev) => {
      if (ev?.data?.type === 'PRECACHE_DONE') finish();
    };

    const cleanup = () => {
      navigator.serviceWorker?.removeEventListener?.('message', handler);
      window.removeEventListener('message', handler);
    };

    navigator.serviceWorker?.addEventListener?.('message', handler);
    window.addEventListener('message', handler);

    // Fallback: nach 2s trotzdem loslegen
    setTimeout(finish, 2000);
  });
  await swReady;

  // Aktiven Cache finden
  const cacheNames = await caches.keys();
  const cacheName  = cacheNames.find(n => n.startsWith(CACHE_PREFIX)) || cacheNames[0];
  if (!cacheName) return;
  const cache = await caches.open(cacheName);

  // Kanonisierung wie im SW (nur Aliase + lowercase)
  const canonAliases = {
    '/Index1.html': '/index1.html',
    '/Instruktor.html': '/instruktor.html',
    '/Status4a.html': '/status4a.html',
  };
  const canon = (p) => (canonAliases[p] || p).toLowerCase();

  const dedupe = (arr) => [...new Set(arr)];

  // Seiten (spiegelt deinen SW); ALLES lowercase
  const PATIENT_COUNT = 13; // passend zum SW
  const PAGES = dedupe([
    '/index.html','/index1.html','/instruktor.html','/auswertung.html',
    '/kontakt.html','/patienten.html','/uebung.html','/uebungsanleitung.html',
    '/qr.html','/status4.html','/status4a.html','/szenario.html',
    ...Array.from({ length: PATIENT_COUNT }, (_, i) => `/patient${i+1}.html`),
  ]);

  // QR-Bilder wie in qr.html (Leerzeichen per %20)
  const QR_IMAGES = dedupe([
    ...Array.from({ length: 14 }, (_, i) => `/qr/Patient%20${i+1}.png`),
    '/qr/szenario1.png',
    '/qr/szenario2.png',
  ]);

  // Assets
  const ASSETS = dedupe([
    // Styles
    '/btn1style.css','/menustyle.css','/styles.css','/stylesauswertung.css',
    // Scripts (lokales jsQR + Scanner wichtig!)
    '/button1.js','/button2.js','/script.js','/sperrung.js','/timer.js',
    '/freigabe.js','/license.js','/scanner.js','/warmup.js',
    '/vendor/jsqr.min.js','/warmup-banner.js',
    // Medien/Icons die oft gebraucht werden
    '/Patientenkarte.jpg','/apple-touch-icon.png','/icon-192.png',
    '/icon-512.png','/logoneu.png','/Alarmton2.mp3'
  ]);

  // Alles zusammen
  const ALL = dedupe([...PAGES, ...ASSETS, ...QR_IMAGES]);

  // ----- Erststart-Progress (Events für UI) -----
  const TOTAL_ITEMS = ALL.length;
  let progressed = 0;

  function emitProgress() {
    window.dispatchEvent(new CustomEvent('warmup:progress', {
      detail: { done: progressed, total: TOTAL_ITEMS }
    }));
  }
  emitProgress(); // initial 0/x

  // Fetch + in aktiven Cache spiegeln (mit Redirect-Handling)
  async function fetchAndPut(u) {
    try {
      const res = await fetch(u, { cache: 'no-store', redirect: 'follow' });
      if (!res) return false;

      let finalRes  = res;
      let finalPath = canon(new URL(res.url, location.origin).pathname);

      if (res.redirected && res.url) {
        try {
          const f = await fetch(res.url, { cache: 'no-store', redirect: 'follow' });
          if (f && f.ok) {
            finalRes  = f;
            finalPath = canon(new URL(res.url).pathname);
          }
        } catch {}
      }

      if (finalRes.ok || finalRes.type === 'opaque') {
        await cache.put(new Request(finalPath), finalRes.clone());
        return true;
      }
    } catch {}
    return false;
  }

  // In kleinen Batches arbeiten (schont Netz + UI)
  const BATCH = 10;
  for (let i = 0; i < ALL.length; i += BATCH) {
    const slice = ALL.slice(i, i + BATCH);
    await Promise.all(slice.map(async (u) => {
      try { await fetchAndPut(u); }
      finally { progressed++; emitProgress(); }
    }));
  }

  sessionStorage.setItem(SESSION_FLAG, '1');
  window.dispatchEvent(new CustomEvent('warmup:done'));
  console.log(`[warmup] cached ~${ALL.length} URLs (v${WARMUP_VERSION})`);
})();
