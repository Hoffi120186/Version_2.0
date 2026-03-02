<!-- SCANNER KOMPLETT, 1 zu 1. In index.html ganz unten vor </body> einfügen.
     Voraussetzung, jsQR ist bereits geladen, bei dir ist das meist /vendor/jsqr.min.js oder CDN.
     Optional, wenn du schon einen Scan Button hast, nutze id="cameraButton". -->

<script>
(function(){
  "use strict";

  const SCAN_BTN_IDS = ["cameraButton","scanButton","startScan","status4Button"];
  const PARAM_NAME = "autoscanner";

  let stream = null;
  let rafId = 0;
  let scanning = false;
  let lastHit = { text:"", at:0 };

  function qs(sel){ return document.querySelector(sel); }

  function getOrCreateScannerUI(){
    let wrap = qs("#scannerModal");
    if (wrap) return wrap;

    wrap = document.createElement("div");
    wrap.id = "scannerModal";
    wrap.style.cssText = [
      "position:fixed",
      "inset:0",
      "background:rgba(0,0,0,.85)",
      "z-index:99999",
      "display:none",
      "align-items:center",
      "justify-content:center",
      "padding:16px"
    ].join(";");

    wrap.innerHTML = `
      <div style="
        width:min(92vw,760px);
        background:rgba(255,255,255,.08);
        border:1px solid rgba(255,255,255,.18);
        border-radius:18px;
        box-shadow:0 10px 26px rgba(0,0,0,.35);
        overflow:hidden;
      ">
        <div style="
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:12px;
          padding:14px 14px;
          color:#fff;
          font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
          font-size:16px;
          background:rgba(0,0,0,.28);
        ">
          <div style="font-weight:700">QR Scanner</div>
          <button id="scannerCloseBtn" style="
            background:rgba(255,255,255,.12);
            border:1px solid rgba(255,255,255,.20);
            color:#fff;
            padding:10px 12px;
            border-radius:12px;
            cursor:pointer;
            font-size:14px;
          ">Schließen</button>
        </div>

        <div style="position:relative; background:#000;">
          <video id="scannerVideo" playsinline autoplay muted style="
            width:100%;
            height:min(62vh,520px);
            object-fit:cover;
            display:block;
            background:#000;
          "></video>

          <div style="
            position:absolute;
            inset:0;
            pointer-events:none;
            display:flex;
            align-items:center;
            justify-content:center;
          ">
            <div style="
              width:min(62vw,380px);
              height:min(62vw,380px);
              border:3px solid rgba(11,95,255,.95);
              border-radius:18px;
              box-shadow:0 0 0 2000px rgba(0,0,0,.25);
            "></div>
          </div>
        </div>

        <div id="scannerHint" style="
          padding:12px 14px 14px;
          color:rgba(255,255,255,.85);
          font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
          font-size:14px;
        ">Halte den QR Code ruhig in den Rahmen.</div>

        <canvas id="scannerCanvas" style="display:none"></canvas>
      </div>
    `;

    document.body.appendChild(wrap);

    qs("#scannerCloseBtn").addEventListener("click", stopScanner);

    return wrap;
  }

  function showModal(){
    const wrap = getOrCreateScannerUI();
    wrap.style.display = "flex";
  }

  function hideModal(){
    const wrap = qs("#scannerModal");
    if (wrap) wrap.style.display = "none";
  }

  async function startCamera(){
    const video = qs("#scannerVideo");
    if (!video) return;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setHint("Kamera wird nicht unterstützt.");
      return;
    }

    try{
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false
      });

      video.srcObject = stream;

      await video.play().catch(()=>{});

      return true;
    }catch(e){
      setHint("Kamera konnte nicht gestartet werden. Prüfe Berechtigungen.");
      return false;
    }
  }

  function stopCamera(){
    try{
      if (stream) {
        stream.getTracks().forEach(t => { try{ t.stop(); }catch(_){} });
      }
    }catch(_){}
    stream = null;
  }

  function setHint(text){
    const el = qs("#scannerHint");
    if (el) el.textContent = text;
  }

  function normalizeToPatientUrl(text){
    const raw = String(text || "").trim();
    if (!raw) return null;

    try{
      if (/^https?:\/\//i.test(raw)) {
        const u = new URL(raw);
        if (u.pathname) return u.pathname + u.search + u.hash;
      }
    }catch(_){}

    const m1 = raw.match(/patient(\d{1,3})/i);
    if (m1) return "/patient" + parseInt(m1[1],10) + ".html";

    const m2 = raw.match(/^\s*(\d{1,3})\s*$/);
    if (m2) return "/patient" + parseInt(m2[1],10) + ".html";

    const m3 = raw.match(/\/patient(\d{1,3})\.html/i);
    if (m3) return "/patient" + parseInt(m3[1],10) + ".html";

    return null;
  }

  function patientIdFromUrl(url){
    const m = String(url||"").match(/patient(\d{1,3})\.html/i);
    if (!m) return null;
    return ("patient" + parseInt(m[1],10)).toLowerCase();
  }

  function isAlreadyScanned(pid){
    if (!pid) return false;
    try{
      const map = JSON.parse(localStorage.getItem("sichtungMap") || "{}");
      if (map && map[pid]) return true;
    }catch(_){}
    try{
      const scanned = JSON.parse(localStorage.getItem("scannedPatients") || "[]");
      if (Array.isArray(scanned) && scanned.includes(pid)) return true;
    }catch(_){}
    return false;
  }

  function showAlreadyScannedOverlay(targetUrl){
    const existing = qs("#alreadyScannedOverlay");
    if (existing) existing.remove();

    const overlay = document.createElement("div");
    overlay.id = "alreadyScannedOverlay";
    overlay.style.cssText = [
      "position:fixed",
      "inset:0",
      "z-index:100000",
      "background:rgba(0,0,0,.92)",
      "display:flex",
      "align-items:center",
      "justify-content:center",
      "padding:16px"
    ].join(";");

    overlay.innerHTML = `
      <div style="
        width:min(92vw,680px);
        background:rgba(255,255,255,.10);
        border:1px solid rgba(255,255,255,.18);
        border-radius:18px;
        box-shadow:0 10px 26px rgba(0,0,0,.35);
        padding:16px;
        color:#fff;
        font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
        text-align:center;
      ">
        <div style="font-size:22px; font-weight:800; margin-bottom:10px;">
          ⚠️ Patient bereits gescannt
        </div>
        <div style="opacity:.9; margin-bottom:14px; line-height:1.35;">
          Du kannst direkt weiter scannen, oder den Patienten trotzdem öffnen.
        </div>

        <div style="display:grid; gap:10px;">
          <button id="asScanAgain" style="
            padding:14px 14px;
            border-radius:14px;
            border:0;
            background:#0B5FFF;
            color:#fff;
            font-size:16px;
            font-weight:700;
            cursor:pointer;
          ">Weiter scannen</button>

          <button id="asOpenAnyway" style="
            padding:14px 14px;
            border-radius:14px;
            border:0;
            background:#ff5500;
            color:#fff;
            font-size:16px;
            font-weight:700;
            cursor:pointer;
          ">Trotzdem öffnen</button>

          <button id="asClose" style="
            padding:12px 14px;
            border-radius:14px;
            border:1px solid rgba(255,255,255,.22);
            background:rgba(255,255,255,.10);
            color:#fff;
            font-size:14px;
            cursor:pointer;
          ">Schließen</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    qs("#asScanAgain").onclick = () => {
      overlay.remove();
      setHint("Weiter scannen.");
      scanning = true;
    };

    qs("#asOpenAnyway").onclick = () => {
      overlay.remove();
      stopScanner();
      location.href = targetUrl;
    };

    qs("#asClose").onclick = () => {
      overlay.remove();
    };
  }

  function onQrHit(text){
    const now = Date.now();
    if (text === lastHit.text && (now - lastHit.at) < 2000) return;
    lastHit = { text, at: now };

    const targetUrl = normalizeToPatientUrl(text);
    if (!targetUrl) {
      setHint("QR erkannt, aber nicht als Patient QR gültig.");
      return;
    }

    const pid = patientIdFromUrl(targetUrl);
    if (pid && isAlreadyScanned(pid)) {
      scanning = false;
      showAlreadyScannedOverlay(targetUrl);
      return;
    }

    stopScanner();
    location.href = targetUrl;
  }

  function scanLoop(){
    if (!scanning) return;

    const video = qs("#scannerVideo");
    const canvas = qs("#scannerCanvas");
    if (!video || !canvas || typeof jsQR !== "function") {
      setHint("Scanner ist nicht bereit. Prüfe jsQR Einbindung.");
      scanning = false;
      return;
    }

    const w = video.videoWidth || 0;
    const h = video.videoHeight || 0;

    if (w < 10 || h < 10) {
      rafId = requestAnimationFrame(scanLoop);
      return;
    }

    canvas.width = w;
    canvas.height = h;

    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, w, h);

    const img = ctx.getImageData(0, 0, w, h);
    const code = jsQR(img.data, w, h, { inversionAttempts: "attemptBoth" });

    if (code && code.data) {
      onQrHit(code.data);
      return;
    }

    rafId = requestAnimationFrame(scanLoop);
  }

  async function startScanner(){
    if (scanning) return;
    showModal();
    setHint("Kamera wird gestartet.");
    const ok = await startCamera();
    if (!ok) return;

    setHint("Halte den QR Code ruhig in den Rahmen.");
    scanning = true;
    rafId = requestAnimationFrame(scanLoop);
  }

  function stopScanner(){
    scanning = false;
    try{ if (rafId) cancelAnimationFrame(rafId); }catch(_){}
    rafId = 0;
    stopCamera();
    hideModal();
  }

  function wireButtons(){
    for (const id of SCAN_BTN_IDS){
      const el = document.getElementById(id);
      if (!el) continue;
      if (el.__wiredScanner) continue;
      el.__wiredScanner = true;

      el.addEventListener("click", (e) => {
        try{ e.preventDefault(); }catch(_){}
        try{ e.stopPropagation(); }catch(_){}
        startScanner();
      });
    }

    window.addEventListener("autoscanner", () => startScanner());
  }

  function autostartFromParam(){
    try{
      const params = new URLSearchParams(location.search);
      if (params.get(PARAM_NAME) !== "1") return;

      try{
        history.replaceState({}, document.title, "/index.html");
      }catch(_){}

      startScanner();
    }catch(_){}
  }

  document.addEventListener("DOMContentLoaded", () => {
    wireButtons();
    autostartFromParam();
  });

  window.Scanner = window.Scanner || {};
  window.Scanner.start = startScanner;
  window.Scanner.stop = stopScanner;

})();
</script>
