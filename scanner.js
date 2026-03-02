// scanner.js — SW-Gate, Anti-Doppel-Scan (Gap-Frames), sanfte Wiederholungswarnung + Kaltstart-Block

// ===== SW-Ready Gate =====
let SW_READY = false;

function whenServiceWorkerReady(timeoutMs = 4000) {
  return new Promise(async (resolve) => {
    const done = () => { SW_READY = true; resolve(true); };
    if (navigator.serviceWorker?.controller) setTimeout(done, 150);
    navigator.serviceWorker?.addEventListener?.('message', (ev) => {
      if (ev.data?.type === 'PRECACHE_DONE') done();
    });
    try { await navigator.serviceWorker.ready; setTimeout(() => { if (!SW_READY) done(); }, 150); } catch {}
    setTimeout(() => { if (!SW_READY) resolve(false); }, timeoutMs);
  });
}

// ===== Helpers: Sanitizing & Normalisierung =====
function cleanScanText(s) {
  if (!s) return '';
  // Zero-Width & BOM entfernen + trimmen
  return String(s).replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
}

function normalizeToWhitelistedTarget(raw) {
  // Gibt eine absolute URL-String zurück, oder '' wenn unzulässig
  const now = Date.now();
  const s0  = cleanScanText(raw);

  // 1) Auf absolute URL auflösen (auch wenn nur Pfad)
  let u;
  try { u = new URL(s0, location.origin); }
  catch { return ''; }

  // 2) Host prüfen: interne Hosts whitelisten
  const ownHosts = new Set([
    location.hostname,
    'www.1rettungsmittel.de',
    '1rettungsmittel.de',
    'app.1rettungsmittel.de'
  ]);
  const isOwn = ownHosts.has(u.hostname);

  // 3) Pfad-String für Prüfung vorbereiten (Case normalisieren)
  let path = (u.pathname || '/').trim();

  // Varianten tolerant mappen: "Patient 6", "/patient6", "PATIENT-06", etc.
  // → bevorzugt numerische Extraktion, aber NUR für patient/szenario
  const patientLoose = path.match(/^\/?patient\s*[-_ ]?\s*(\d{1,2})(?:\.html)?$/i);
  const szenarioLoose = path.match(/^\/?szenario\s*[-_ ]?\s*(\d{1,2})(?:\.html)?$/i);

  if (patientLoose) {
    const n = parseInt(patientLoose[1], 10);
    if (n >= 1 && n <= 20) {
      const url = new URL(`/patient${n}.html`, location.origin);
      url.searchParams.set('t', String(now));
      return url.toString();
    }
    return '';
  }

  if (szenarioLoose) {
    const n = parseInt(szenarioLoose[1], 10);
    if (n >= 1 && n <= 4) {
      const url = new URL(`/szenario${n}.html`, location.origin);
      url.searchParams.set('t', String(now));
      return url.toString();
    }
    return '';
  }

  // Bereits „sauber“?
  const patientStrict = path.match(/^\/patient(\d{1,2})\.html$/i);
  if (patientStrict) {
    const n = parseInt(patientStrict[1], 10);
    if (n >= 1 && n <= 20) {
      const url = new URL(`/patient${n}.html`, location.origin);
      url.searchParams.set('t', String(now));
      return url.toString();
    }
    return '';
  }

  const szenarioStrict = path.match(/^\/szenario(\d{1,2})\.html$/i);
  if (szenarioStrict) {
    const n = parseInt(szenarioStrict[1], 10);
    if (n >= 1 && n <= 4) {
      const url = new URL(`/szenario${n}.html`, location.origin);
      url.searchParams.set('t', String(now));
      return url.toString();
    }
    return '';
  }

  // Externe oder sonstige Links:
  if (!isOwn) {
    // Nur online erlauben, sonst ablehnen
    if (!navigator.onLine) return '';
    // Externen Link direkt zulassen
    return u.href;
  }

  // Interne, aber nicht-whitelistete Pfade: nichts öffnen
  return '';
}

// Einmal-Navigation + kurzer Debounce
let __navLock = false;
let __lastNavTs = 0;

function navigateOnceAbsUrl(absUrl) {
  const now = Date.now();
  if (__navLock || (now - __lastNavTs < 800)) return; // 0.8s Debounce
  __navLock = true;
  __lastNavTs = now;
  // replace → kein History-Müll, minimiert Zurück-Flicker
  location.replace(absUrl);
}

// ===== (Optional) getUserMedia-Gate für iOS-Gesten =====
function wrapGetUserMediaOnce() {
  if (!navigator.mediaDevices?.getUserMedia || window.__gk_wrapped) return;
  const orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  let allowOnce = false;
  window.__allowCameraOnce = () => { allowOnce = true; setTimeout(()=>allowOnce=false, 3000); };
  navigator.mediaDevices.getUserMedia = (c) => {
    if (!allowOnce) return Promise.reject(new DOMException('Needs user gesture','NotAllowedError'));
    allowOnce = false; return orig(c);
  };
  window.__gk_wrapped = true;
}

/* ===================== ScanGuard: Anti-Doppel-Scan ===================== */

// Einstellungen
const SCANGUARD = {
  GAP_FRAMES_REQUIRED: 10,      // Frames ohne sichtbaren Code, bevor derselbe ID wieder darf
  SAME_ID_COOLDOWN_MS: 1200     // zusätzliche kurze Sperre nach Annahme
};

// State
let framesSinceNoCode = SCANGUARD.GAP_FRAMES_REQUIRED;
let lastAcceptedId = null;
let lastAcceptTs = 0;
let coldStartBlockId = null; // NEU: blockt beim Öffnen den zuletzt akzeptierten Patienten bis Gap erreicht

// Bereits „irgendwann“ (in diesem Einsatz) gescannte Patienten
const VISITED_KEY = 'visitedPatients';
const visitedPatients = new Set(JSON.parse(sessionStorage.getItem(VISITED_KEY) || '[]'));

function markVisited(id) {
  if (!visitedPatients.has(id)) {
    visitedPatients.add(id);
    sessionStorage.setItem(VISITED_KEY, JSON.stringify([...visitedPatients]));
  }
}

// ID aus absoluter URL extrahieren (z.B. "/patient15.html?...")
function extractPatientIdFromAbs(absUrl) {
  try {
    const u = new URL(absUrl, location.origin);
    const m = u.pathname.match(/\/patient(\d+)\.html$/i);
    return m ? `patient${m[1]}` : null;
  } catch {
    return null;
  }
}

// Dezente Toast-Blase
function showToast(msg, seconds = 2) {
  let el = document.getElementById('scanToast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'scanToast';
    Object.assign(el.style, {
      position:'fixed', inset:'auto 12px 12px 12px', zIndex:9999,
      maxWidth:'520px', padding:'10px 14px', borderRadius:'12px',
      background:'rgba(0,0,0,.75)', color:'#fff', font:'500 15px system-ui',
      boxShadow:'0 8px 24px rgba(0,0,0,.35)', textAlign:'center',
      transition:'opacity .25s ease', opacity:'0'
    });
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.opacity = '1';
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.opacity = '0'; }, seconds * 1000);
}

// Nachfrage bei Wiederverwendung innerhalb des Einsatzes
function confirmRescan(id) {
  return new Promise((resolve) => {
    let wrap = document.getElementById('rescanWrap');
    if (!wrap) {
      wrap = document.createElement('div'); wrap.id = 'rescanWrap';
      Object.assign(wrap.style, {
        position:'fixed', inset:0, background:'rgba(0,0,0,.45)', display:'grid',
        placeItems:'center', zIndex:10000
      });
      const card = document.createElement('div');
      Object.assign(card.style, {
        width:'min(92vw,420px)', background:'#111827', color:'#fff',
        borderRadius:'16px', padding:'16px', boxShadow:'0 18px 50px rgba(0,0,0,.5)'
      });
      card.innerHTML = `
        <div style="font:600 18px system-ui;margin-bottom:8px">Diesen Patienten erneut öffnen?</div>
        <div style="opacity:.8;margin-bottom:14px">Der Patient <b id="rescanId"></b> wurde bereits gescannt.</div>
        <div style="display:flex; gap:10px; justify-content:flex-end">
          <button id="rescanCancel" style="padding:10px 12px;border-radius:10px;border:1px solid #384152;background:#1f2937;color:#fff">Anderen scannen</button>
          <button id="rescanOk" style="padding:10px 12px;border-radius:10px;border:0;background:#2563eb;color:#fff">Trotzdem öffnen</button>
        </div>`;
      wrap.appendChild(card);
      document.body.appendChild(wrap);
    }
    wrap.querySelector('#rescanId').textContent = id.replace('patient','Patient ');
    wrap.style.display = 'grid';
    wrap.querySelector('#rescanCancel').onclick = () => { wrap.style.display = 'none'; resolve(false); };
    wrap.querySelector('#rescanOk').onclick     = () => { wrap.style.display = 'none'; resolve(true);  };
  });
}

// Von außen nutzbar (z.B. bei Status 4 Button)
window.resetScanSession = function resetScanSession() {
  sessionStorage.removeItem(VISITED_KEY);
  visitedPatients.clear();
  lastAcceptedId = null;
  lastAcceptTs = 0;
  framesSinceNoCode = SCANGUARD.GAP_FRAMES_REQUIRED;
  coldStartBlockId = null;
};

/* ===================== Scanner Init ===================== */

(function initWhenDomReady() {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initScanner, { once: true });
  } else {
    initScanner();
  }
})();

function initScanner() {
  // Elemente erst JETZT abfragen (DOM fertig)
  const startBtn = document.getElementById('cameraButton');
  const overlay  = document.getElementById('scannerOverlay');
  const video    = document.getElementById('scanVideo');
  const canvas   = document.getElementById('scanCanvas');
  const closeBtn = document.getElementById('scanCloseBtn');

  if (!startBtn || !overlay || !video || !canvas || !closeBtn) {
    console.info('[scanner.js] Scanner-UI nicht vorhanden – init übersprungen.');
    return;
  }

  if (!window.jsQR) {
    console.error('[scanner.js] jsQR nicht geladen – prüfe <script src="/vendor/jsqr.min.js" defer>.');
    return;
  }

  wrapGetUserMediaOnce();

  const ctx = canvas.getContext('2d');
  let stream = null, rAFid = 0, scanning = false, redirected = false;

  async function openScanner(){
    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden','false');
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    redirected = false;
    __navLock = false; // reset bei neuem Scan
    framesSinceNoCode = SCANGUARD.GAP_FRAMES_REQUIRED; // frischer Start
    coldStartBlockId = lastAcceptedId; // NEU: zuletzt akzeptierten Patienten beim Öffnen blocken

    try{
      if (typeof window.__allowCameraOnce === 'function') window.__allowCameraOnce();
      stream = await navigator.mediaDevices.getUserMedia({ video:{ facingMode:{ ideal:'environment' } }, audio:false });
      video.srcObject = stream;
      await video.play().catch(()=>{});
      await new Promise(r => (video.readyState >= 2 ? r() : (video.onloadedmetadata = r)));

      canvas.width  = video.videoWidth  || 640;
      canvas.height = video.videoHeight || 480;

      startLoop();
      try { history.pushState({ scan: true }, ''); } catch {}
    } catch(e){
      console.error('[scanner.js] Camera error:', e);
      alert('Kamera konnte nicht gestartet werden.');
      closeScanner();
    }
  }

  function startLoop(){
    if (scanning) return;
    scanning = true;

    const tick = () => {
      if (!scanning || !stream) return;
      try{
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const img  = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(img.data, canvas.width, canvas.height, { inversionAttempts:'dontInvert' });

        if (code && code.data) {
          // Es ist ein QR im Bild → Lücke zurücksetzen
          // (wichtig für die „GAP_FRAMES_REQUIRED“-Logik)
          if (framesSinceNoCode < 1000) framesSinceNoCode = 0;

          // zentrale Normalisierung (whitelist)
          const targetAbs = normalizeToWhitelistedTarget(code.data);

          if (targetAbs && !redirected) {
            // Patient-ID extrahieren (falls einer)
            const pid = extractPatientIdFromAbs(targetAbs);

            if (!pid) {
              // Kein Patient (z.B. Szenario oder externer Link): direkt annehmen
              redirected = true;
              closeScanner();
              navigateOnceAbsUrl(targetAbs);
              return;
            }

            // === NEU: Kaltstart-Block (derselbe Patient wie zuletzt) ===
            if (pid === coldStartBlockId && framesSinceNoCode < SCANGUARD.GAP_FRAMES_REQUIRED) {
              // QR ist noch im Bild, fordere Mini-Bewegung
              if (framesSinceNoCode === 0) {
                showToast('Kurz vom QR wegbewegen, dann nächsten scannen.');
              }
              rAFid = requestAnimationFrame(tick);
              return;
            }

            // === Anti-Doppel-Scan-Logik ===
            const now = Date.now();
            const stillSameInView = (framesSinceNoCode < SCANGUARD.GAP_FRAMES_REQUIRED);
            const cooldownActive  = (pid === lastAcceptedId) && (now - lastAcceptTs < SCANGUARD.SAME_ID_COOLDOWN_MS);

            // 1) Sofort-Block, wenn derselbe Code weiterhin im Bild oder Cooldown aktiv
            if ((pid === lastAcceptedId && stillSameInView) || cooldownActive) {
              // Optionaler Hinweis nur einmal „nahe beim Start“
              if (framesSinceNoCode === 0) {
                showToast('Bewege das Gerät kurz weg, um doppelte Scans zu vermeiden.');
              }
              // Nicht navigieren, weiter scannen
              rAFid = requestAnimationFrame(tick);
              return;
            }

            // 2) Bereits im Einsatz besucht → Nachfrage
            if (visitedPatients.has(pid)) {
              confirmRescan(pid).then(ok => {
                if (ok && !redirected) {
                  lastAcceptedId = pid;
                  lastAcceptTs = Date.now();
                  markVisited(pid);
                  redirected = true;
                  closeScanner();
                  navigateOnceAbsUrl(targetAbs);
                } else {
                  showToast('Okay. Kamera zum nächsten QR bewegen.');
                }
              });
              rAFid = requestAnimationFrame(tick);
              return;
            }

            // 3) Normaler erster Scan dieses Patienten
            lastAcceptedId = pid;
            lastAcceptTs = now;
            markVisited(pid);
            redirected = true;
            closeScanner();
            navigateOnceAbsUrl(targetAbs);
            return;
          }

          // QR sichtbar, aber kein zulässiges Ziel → einfach weiter scannen
        } else {
          // Kein Code im Bild → Lücke zählt hoch (für GAP-Erkennung)
          if (framesSinceNoCode < 1000) framesSinceNoCode++;
        }
      } catch {}
      rAFid = requestAnimationFrame(tick);
    };

    rAFid = requestAnimationFrame(tick);
  }

  function stopLoop(){ scanning = false; if (rAFid) cancelAnimationFrame(rAFid); rAFid = 0; }
  function stopTracks(){ if (stream){ try{ stream.getTracks().forEach(t=>t.stop()); }catch{} stream=null; } }

  function closeScanner(){
    stopLoop(); stopTracks();
    try { video.pause(); } catch {}
    video.srcObject = null;
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden','true');
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
    try { const st = history.state; if (st && st.scan) history.back(); } catch {}
  }

  // Start nur per Klick + SW-Gate
  startBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    await whenServiceWorkerReady();
    openScanner();
  }, { passive: true });

  // Schließen
  closeBtn.addEventListener('click', closeScanner, { passive: true });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && overlay.classList.contains('open')) closeScanner(); });

  document.addEventListener('visibilitychange', () => { if (document.hidden && overlay.classList.contains('open')) closeScanner(); });
  window.addEventListener('pagehide', () => { if (overlay.classList.contains('open')) closeScanner(); });
  window.addEventListener('popstate', () => { if (overlay.classList.contains('open')) closeScanner(); });
}
