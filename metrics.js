// https://app.1rettungsmittel.de/metrics.js
// v2025-11-12-03 – mit license_key + device_id + Batch-Events

(function () {
  const METRICS_URL = 'https://1rettungsmittel.de/metrics.php';

  // ============================================================
  // Helpers
  // ============================================================
  const nowISO = () => new Date().toISOString();

  function currentPath() {
    try {
      const u = new URL(location.href);
      let p = u.pathname || '/';
      p = p.replace(/\/+$/, '');
      if (!p) p = '/index.html';
      if (/\/index(\.html?|\/)?$/i.test(p)) p = '/index.html';
      if (!/\.(html?|php)$/i.test(p)) p += '.html';
      return p.toLowerCase();
    } catch (_) {
      let p = location.pathname || '/';
      p = p.replace(/\/+$/, '');
      if (!p) p = '/index.html';
      if (/\/index(\.htm)?$/i.test(p)) p = '/index.html';
      if (!/\.html?$/i.test(p)) p += '.html';
      return p.toLowerCase();
    }
  }

  // patient7.html | patient-7.html | patient_7(.html) | ?patient=7
  function matchPatientFromPathOrQuery(path) {
    const file = (path.split('/').pop() || '').toLowerCase();
    const m1 = file.match(/^patient[-_]?(\d+)(?:\.html?)?$/i);
    if (m1) return m1;
    try {
      const u = new URL(location.href);
      const qv =
        u.searchParams.get('patient') ||
        u.searchParams.get('pid') ||
        u.searchParams.get('p');
      if (qv && /^\d+$/.test(qv)) return [null, qv];
    } catch (_) {}
    return null;
  }

  function normalizePid(v) {
    const num = String(v ?? '').replace(/\D+/g, '');
    return String(parseInt(num || '0', 10));
  }

  // ============================================================
  // Lizenz-Key + Device-ID aus localStorage
  // (freigabe.js setzt license_token + device_id)
  // ============================================================
  function getLicenseAndDevice() {
    let license_key = '';
    let device_id = '';

    try {
      license_key = (localStorage.getItem('license_token') || '').trim();
    } catch (_) {}

    try {
      device_id = (localStorage.getItem('device_id') || '').trim();
    } catch (_) {}

    return { license_key, device_id };
  }

  // ============================================================
  // Offline-Persistenz (localStorage)
  // ============================================================
  const LS_KEY = 'rm_metrics_queue';
  const LS_MAX_EVENTS = 200;
  const LS_MAX_BYTES = 64 * 1024;

  function loadQueueFromLS() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch (_) {
      return [];
    }
  }

  function saveQueueToLS(arr) {
    try {
      let out = Array.isArray(arr) ? arr.slice(-LS_MAX_EVENTS) : [];
      let s = JSON.stringify(out);
      if (s.length > LS_MAX_BYTES) {
        let lo = 0,
          hi = out.length;
        while (s.length > LS_MAX_BYTES && hi - lo > 1) {
          lo = Math.floor((lo + hi) / 2);
          s = JSON.stringify(out.slice(lo));
        }
        out = out.slice(lo);
      }
      localStorage.setItem(LS_KEY, JSON.stringify(out));
    } catch (_) {}
  }

  function clearQueueInLS() {
    try {
      localStorage.removeItem(LS_KEY);
    } catch (_) {}
  }

  // ============================================================
  // Queue + Beacon/Fetch + Dedupe
  // ============================================================
  const QUEUE = [];
  let flushTimer = null;
  const BATCH_SIZE = 25;
  const FLUSH_MS = 15000;
  const DEDUPE_MS = 1200;

  // vorhandene (offline gespeicherte) Events übernehmen
  try {
    const pending = loadQueueFromLS();
    if (pending.length) for (const ev of pending) QUEUE.push(ev);
  } catch (_) {}

  const recent = [];
  function dedupe(ev) {
    const key = [ev.type, ev.patient_id || '', ev.page || ''].join('|');
    const t = Date.now();
    for (let i = recent.length - 1; i >= 0; i--) {
      if (t - recent[i].t > DEDUPE_MS) recent.splice(i, 1);
    }
    if (recent.some((r) => r.key === key)) return true;
    recent.push({ key, t });
    return false;
  }

  // ========= zentrale Funktion: jedes Event bekommt license_key + device_id =========
  function enqueue(ev, { urgent = false } = {}) {
    if (!ev || typeof ev !== 'object') return;

    if (!ev.ts) ev.ts = nowISO();

    // Lizenz + Device mitschicken
    const { license_key, device_id } = getLicenseAndDevice();
    if (license_key && !ev.license_key) ev.license_key = license_key;
    if (device_id && !ev.device_id) ev.device_id = device_id;

    if (dedupe(ev)) return;

    QUEUE.push(ev);
    saveQueueToLS(QUEUE);

    if (urgent || QUEUE.length >= BATCH_SIZE) {
      flush({ useBeacon: urgent });
    } else if (!flushTimer) {
      flushTimer = setTimeout(() => flush(), FLUSH_MS);
    }
  }

  // queued_ms + flush_mode für ingest_daily
  function flush({ useBeacon = false } = {}) {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    if (!QUEUE.length) return;

    const now = Date.now();
    const mode =
      useBeacon || document.visibilityState === 'hidden' ? 'beacon' : 'fetch';

    const raw = QUEUE.splice(0, QUEUE.length);
    const events = raw.map((ev) => {
      let ts = ev.ts ? Date.parse(ev.ts) : now;
      if (isNaN(ts)) ts = now;
      const queued_ms = Math.max(0, now - ts);
      return { ...ev, queued_ms, flush_mode: mode };
    });

    const payload = { events };
    const json = JSON.stringify(payload);

    if (mode === 'beacon' && navigator.sendBeacon) {
      try {
        const ok = navigator.sendBeacon(
          METRICS_URL,
          new Blob([json], { type: 'application/json' })
        );
        if (ok) {
          clearQueueInLS();
          return;
        }
      } catch (_) {}
    }

    try {
      fetch(METRICS_URL, {
        method: 'POST',
        // <<< geändert: "simple" Content-Type, dann kein CORS-Preflight (OPTIONS) mehr
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: json,
        // credentials brauchst du hier nicht, also raus
        keepalive: mode === 'beacon',
      })
        .then(() => clearQueueInLS())
        .catch(() => {});
    } catch (_) {}

  }

  function sendMetric(ev, opts) {
    enqueue(ev, opts || {});
  }

  // ============================================================
  // 1) Page-Views / Patient-Views (nur beim Laden!)
  // ============================================================
  function sendPageOrPatientView() {
    const path = currentPath();
    const m = matchPatientFromPathOrQuery(path);
    if (m) {
      const pid = normalizePid(m[1]);
      if (pid !== '0')
        sendMetric({ type: 'patient_view', patient_id: pid });
    } else {
      sendMetric({ type: 'page_view', page: path });
    }
  }
  window.addEventListener('DOMContentLoaded', sendPageOrPatientView, {
    once: true,
  });

  // ============================================================
  // 2) KEINE Button-Klick-Auswertung mehr – nur Views & Sessions
  // ============================================================

  // ============================================================
  // 3) Session-Zeit + Lifecycle
  // ============================================================
  const START_TS = Date.now();
  sendMetric({ type: 'session_start' });

  let sessionEnded = false;
  function endSession() {
    if (sessionEnded) return;
    sessionEnded = true;
    const seconds = Math.max(
      0,
      Math.round((Date.now() - START_TS) / 1000)
    );
    // PHP filtert <5s und >3h sowieso heraus
    sendMetric(
      { type: 'session_end', seconds },
      { urgent: true }
    );
    flush({ useBeacon: true });
  }

  window.addEventListener('pagehide', endSession);
  window.addEventListener('beforeunload', endSession);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flush({ useBeacon: true });
    }
  });

  setInterval(() => flush(), FLUSH_MS);

  // ============================================================
  // 4) SPA-Navigation (falls du später mal History-Push nutzt)
  // ============================================================
  (function hookHistory() {
    const origPush = history.pushState;
    const origReplace = history.replaceState;
    function onNav() {
      setTimeout(sendPageOrPatientView, 0);
    }
    history.pushState = function () {
      const r = origPush.apply(this, arguments);
      onNav();
      return r;
    };
    history.replaceState = function () {
      const r = origReplace.apply(this, arguments);
      onNav();
      return r;
    };
    window.addEventListener('popstate', onNav);
  })();

  // ============================================================
  // 5) Optionaler Helper für Spezialfälle
  // ============================================================
  window.trackPatientView = (pid) => {
    const n = normalizePid(pid);
    if (n !== '0')
      sendMetric({ type: 'patient_view', patient_id: n });
  };
})();
