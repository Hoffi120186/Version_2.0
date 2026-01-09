// script.js — 2025-11-25-6 (patched: last-click-wins + SK jederzeit änderbar + T/B nur bei SK1/SK3)

// ==== Version & Singleton Guards (wichtig gegen doppelte Init via SW) ====
(function(){
  const VER = '2025-11-25-6';
  if (window.__APP_VER && window.__APP_VER === VER) {
    console.warn('[guard] already initialized', VER);
    return;
  }
  window.__APP_VER = VER;
  window.__SK_SINGLETON = window.__SK_SINGLETON || { wired:false, tap:false };
})();

// ==== (Optional) Host-Normalizer gegen Split-Storage ====
const CANONICAL_HOST = ""; // z.B. "app.1rettungsmittel.de"
(function(){
  try{
    if (CANONICAL_HOST && location.hostname !== CANONICAL_HOST) {
      location.replace(
        location.protocol + '//' + CANONICAL_HOST +
        location.pathname + location.search + location.hash
      );
    }
  }catch(_){}
})();

const __SK_DEBUG = true;

// ==== Patient-ID erkennen (robust) ====
(function(){
  function __detectPatientIdFromPage(){
    const m1 = document.querySelector('meta[name="patient-id"]')?.content;
    if (m1 && /^patient\d+$/i.test(m1)) return m1.toLowerCase();

    const host = document.querySelector("#patient");
    const cand = host?.dataset?.id || host?.id;
    if (cand && /^patient\d+$/i.test(cand)) return cand.toLowerCase();

    let m = location.pathname.match(/patient(\d+)\.html/i);
    if (m) return ("patient" + m[1]).toLowerCase();

    m = location.pathname.match(/(?:^|\/|_)(\d{1,3})(?:\.html|$)/i);
    if (m) return ("patient" + m[1]).toLowerCase();

    try{
      const bg = getComputedStyle(document.body).backgroundImage || "";
      const u  = bg.match(/url\(["']?([^"')]+)["']?\)/i)?.[1] || "";
      let n = u.match(/pat(?:ient)?(\d{1,3})/i)?.[1]
           || u.match(/([0-9]{1,3})\.(?:jpg|jpeg|png|webp)$/i)?.[1];
      if (n) return ("patient" + n).toLowerCase();
    }catch(_){}

    try{
      const imgs = Array.from(document.querySelectorAll("img[src],img[data-src]"));
      for (const el of imgs){
        const s = el.getAttribute("src") || el.getAttribute("data-src") || "";
        const n = s.match(/pat(?:ient)?(\d{1,3})/i)?.[1]
               || s.match(/([0-9]{1,3})\.(jpg|jpeg|png|webp)$/i)?.[1];
        if (n) return ("patient" + n).toLowerCase();
      }
    }catch(_){}

    return null;
  }
  window.__detectPatientIdFromPage = __detectPatientIdFromPage;
})();

// ==== Zentraler Writer: Dedupe + Throttle + Ablage-Kompat ====
const SKWriter = (() => {
  const MAP_KEY = "sichtungMap";
  const ABL_KEY = "ablage.active.v1";
  const lastWriteTs = new Map();
  const LOCK_MS = 600;

  const normKat = (v)=>{
    if (!v) return null;
    let x = String(v).trim().toLowerCase();
    const map = {
      "sk1":"rot","sk 1":"rot","1":"rot","r":"rot","rot":"rot",
      "sk2":"gelb","sk 2":"gelb","2":"gelb","y":"gelb","gelb":"gelb",
      "sk3":"gruen","sk 3":"gruen","3":"gruen","g":"gruen",
      "gruen":"gruen","grün":"gruen",
      "sk0":"schwarz","sk 0":"schwarz","0":"schwarz","b":"schwarz",
      "schwarz":"schwarz","sk":"schwarz"
    };
    if (map[x]) return map[x];
    if (x.includes("grün")) x = x.replace("grün","gruen");
    return ["rot","gelb","gruen","schwarz"].includes(x) ? x : null;
  };

  const J = {
    load:(k,f)=>{ try { return JSON.parse(localStorage.getItem(k)) ?? f; } catch(_) { return f; } },
    save:(k,v)=>{ try { localStorage.setItem(k, JSON.stringify(v)); } catch(_) {} },
  };

  function upsertAblage(id, kat){
    const now = Date.now();
    const list = J.load(ABL_KEY, []);
    const i = list.findIndex(e => e && e.id === id);
    if (i >= 0) {
      list[i] = { ...list[i], id, sk: kat, lastUpdate: now, start: list[i].start ?? now };
    } else {
      list.push({ id, sk: kat, start: now, lastUpdate: now });
    }

    J.save(ABL_KEY, list);

    try { localStorage.setItem('ablage', JSON.stringify(list)); } catch(_){}
    try { localStorage.setItem('ablage_ids', JSON.stringify(list.map(x => x.id))); } catch(_){}
    try { localStorage.setItem('ablage_patient_' + id, kat); } catch(_){}

    try { new BroadcastChannel('ablage').postMessage({ type:'upsert', id, sk: kat }); } catch(_){}
    if (__SK_DEBUG) console.log('Ablage upsert:', { id, kat });
  }

  // ✅ PATCH: opts.force => letzter Klick gewinnt (keine LOCK-Blockade)
  function setSK(rawId, rawKat, opts = {}){
    const id  = String(rawId||"").toLowerCase();
    const kat = normKat(rawKat);
    if (!id || !kat) return false;

    const force = !!opts.force;

    const now  = Date.now();
    const last = lastWriteTs.get(id) || 0;

    // 🔥 Wenn force=true, niemals wegen LOCK blocken
    if (!force && (now - last < LOCK_MS)) return false;

    const map = J.load(MAP_KEY, {});
    if (!force && map[id] === kat) {
      lastWriteTs.set(id, now);
      return false;
    }

    map[id] = kat;
    J.save(MAP_KEY, map);
    try { localStorage.setItem("sichtung_" + id, kat); } catch(_){}
    try { localStorage.setItem("sichtung_" + window.location.pathname, kat); } catch(_){}

    upsertAblage(id, kat);
    lastWriteTs.set(id, now);
    if (__SK_DEBUG) console.log("SKWriter.setSK ->", {id, kat, force});
    return true;
  }

  function getSK(id){
    try {
      return (JSON.parse(localStorage.getItem(MAP_KEY)||"{}"))[String(id).toLowerCase()] || null;
    } catch {
      return null;
    }
  }

  return { setSK, getSK, normKat };
})();

/* ==== Legacy-Bridges ==== */
(function(){
  // PATCH: force=true, damit auch legacy calls immer "letzter klick gewinnt" sind
  const pass = (id, kat) => { try { return SKWriter.setSK(id, kat, { force:true }); } catch(_) { return false; } };
  try {
    Object.defineProperty(window, 'setSichtung', {
      configurable: true, enumerable: false,
      get(){ return pass; },
      set(){ console.warn('[guard] legacy setSichtung overridden'); }
    });
    Object.defineProperty(window, '__enqueueAblage', {
      configurable: true, enumerable: false,
      get(){ return pass; },
      set(){ console.warn('[guard] legacy __enqueueAblage overridden'); }
    });
  } catch(_) {}
})();

// ==== Grundfunktionen / Zeiten ====
document.addEventListener("DOMContentLoaded", function () {
  let startTime = localStorage.getItem("startTime");
  if (!startTime) {
    startTime = Date.now();
    localStorage.setItem("startTime", startTime);
  }

  const statusButton   = document.getElementById("status4Button");
  const endButton      = document.getElementById("einsatzEndeButton") || document.getElementById("einsatzendeButton");
  const categoryButton = document.getElementById("sichtungskategorieButton");
  const categoryContainer = document.getElementById("categoryContainer");

  if (statusButton) {
    statusButton.addEventListener("click", function () {
      const totalTime = Date.now() - startTime;
      localStorage.setItem("gesamtEinsatzzeit", totalTime);
    });
  }

  if (endButton) {
    endButton.addEventListener("click", function () {
      const patientTotalTime = Date.now() - startTime;
      localStorage.setItem(window.location.pathname, patientTotalTime);
    });
  }

  if (categoryButton && categoryContainer) {
    categoryButton.addEventListener("click", function () {
      categoryContainer.style.display = "block";
    });
  }

  const summaryBtn = document.getElementById("showSummaryButton");
  if (summaryBtn) summaryBtn.addEventListener("click", loadSummary);

  if (!window.__SK_SINGLETON.wired) {
    SightingSync.setup();
    window.__SK_SINGLETON.wired = true;
  } else {
    console.warn('[guard] SightingSync.setup() already wired');
  }
});

// ==== Reset/Redirect ====
function resetAndRedirect() {
  window.location.href = "/index.html";
}

function endMission() {
  localStorage.setItem("appGesperrt", "true");
  location.reload();
}

// ==== Schickes Modal für "Übung abbrechen" (Startseite-Button) ====
function showStartAbbruchModal(targetHref) {
  if (!targetHref) targetHref = "/index.html";

  let backdrop = document.getElementById("abbruchModalBackdrop");
  if (!backdrop) {
    backdrop = document.createElement("div");
    backdrop.id = "abbruchModalBackdrop";
    backdrop.className = "app-modal-backdrop hidden";
    backdrop.innerHTML = `
      <div class="app-modal">
        <div class="app-modal-title">Übung abbrechen?</div>
        <div class="app-modal-text">
          Wenn du zur Startseite zurückkehrst, wird die aktuelle Übung beendet.
        </div>
        <div class="app-modal-actions">
          <button type="button" class="app-btn-primary" id="abbruchConfirm">
            Ja, Übung abbrechen
          </button>
          <button type="button" class="app-btn-secondary" id="abbruchCancel">
            Nein, hier bleiben
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);
  }

  const confirmBtn = backdrop.querySelector("#abbruchConfirm");
  const cancelBtn  = backdrop.querySelector("#abbruchCancel");

  cancelBtn.onclick = () => {
    backdrop.classList.add("hidden");
  };

  confirmBtn.onclick = () => {
    backdrop.classList.add("hidden");
    if (typeof window.resetAndRedirect === "function") {
      resetAndRedirect();
    } else {
      window.location.href = targetHref;
    }
  };

  backdrop.classList.remove("hidden");
}

// ==== (Kompatibel belassen) __enqueueAblage ====
(function(){
  const ABL_KEY = "ablage.active.v1";
  const load=(k,f)=>{ try { return JSON.parse(localStorage.getItem(k)) ?? f; } catch(_) { return f; } };
  const save=(k,v)=>{ try { localStorage.setItem(k, JSON.stringify(v)); } catch(_) {} };
  function upsertAblageActive(id, kat){
    if(!id || !kat) return;
    const now = Date.now();
    const list = load(ABL_KEY, []);
    const idx = list.findIndex(x => x && x.id === id);
    if (idx >= 0) {
      list[idx] = { ...list[idx], id, sk: kat, lastUpdate: now, start: list[idx].start ?? now };
    } else {
      list.push({ id, sk: kat, start: now, lastUpdate: now });
    }
    save(ABL_KEY, list);
    try { localStorage.setItem('ablage', JSON.stringify(list)); } catch(_){}
    try { localStorage.setItem('ablage_ids', JSON.stringify(list.map(x => x.id))); } catch(_){}
    try { localStorage.setItem('ablage_patient_' + id, kat); } catch(_){}
    try { new BroadcastChannel('ablage').postMessage({ type:'upsert', id, sk: kat }); } catch(_){}
  }
  window.__enqueueAblage = upsertAblageActive;
})();

// ==== Sichtung-Sync (Buttons/Inputs) nutzt SKWriter ====
const SightingSync = (() => {
  const BTN = [
    ".categoryButton",".sk-btn",
    "[data-sk]","[data-sichtung]","[data-category]",
    "button[name='sk']", ".btn-sk"
  ];
  const INP = [
    "input[type='radio'][name='sk']",
    "input[type='radio'][name='sichtung']",
    "select[name='sk']",
    "select[name='sichtung']"
  ];
  const ATTRS = ["data-sk","data-category","data-sichtung","value"];

  function pid(){ return window.__detectPatientIdFromPage?.() || null; }

  function markActive(kat){
    document.querySelectorAll(".categoryButton").forEach(b=>{
      const val = ATTRS.map(a => b.getAttribute(a)).find(Boolean) || b.textContent;
      b.classList.toggle("selected", SKWriter.normKat(val) === kat);
    });
    document.querySelectorAll(".sk-btn").forEach(b=>{
      const val = ATTRS.map(a => b.getAttribute(a)).find(Boolean) || b.textContent;
      b.classList.toggle("is-active", SKWriter.normKat(val) === kat);
    });
    document.documentElement.setAttribute("data-sichtung", kat || "");
  }

  function handle(raw, id){
    const kat = SKWriter.normKat(raw);
    if (!kat || !id) return;

    // ✅ PATCH: force=true => letzter Klick gewinnt
    const changed = SKWriter.setSK(id, kat, { force:true });

    if (changed) markActive(kat);
    if (__SK_DEBUG) console.log("✅ SK(handler):", { id, kat, changed });
  }

  function wireBtn(btn, id){
    if (btn.__wiredSichtung) return;
    btn.__wiredSichtung = true;
    btn.addEventListener("click", ()=>{
      if (btn.classList.contains("categoryButton"))
        document.querySelectorAll(".categoryButton").forEach(el=>el.classList.remove("selected"));
      if (btn.classList.contains("sk-btn"))
        document.querySelectorAll(".sk-btn").forEach(el=>el.classList.remove("is-active"));
      const raw = ATTRS.map(a => btn.getAttribute(a)).find(Boolean) || btn.textContent;
      handle(raw, id);
    });
  }

  function wireInp(el, id){
    if (el.__wiredSichtung) return;
    el.__wiredSichtung = true;
    el.addEventListener("change", ()=>{
      const raw = el.value
               || el.getAttribute("value")
               || el.getAttribute("data-sk")
               || el.getAttribute("data-sichtung")
               || el.getAttribute("data-category");
      handle(raw, id);
    });
  }

  function setup(){
    const id = pid();
    if (!id) {
      if (__SK_DEBUG) console.warn("⚠️ keine Patient-ID erkannt");
      return;
    }

    BTN.forEach(sel=>document.querySelectorAll(sel).forEach(b=>wireBtn(b,id)));
    INP.forEach(sel=>document.querySelectorAll(sel).forEach(i=>wireInp(i,id)));

    const mo = new MutationObserver(muts=>{
      muts.forEach(m=>{
        m.addedNodes && m.addedNodes.forEach(n=>{
          if (n.nodeType !== 1) return;
          BTN.forEach(sel=>{
            if (n.matches?.(sel)) wireBtn(n,id);
            n.querySelectorAll?.(sel).forEach(b=>wireBtn(b,id));
          });
          INP.forEach(sel=>{
            if (n.matches?.(sel)) wireInp(n,id);
            n.querySelectorAll?.(sel).forEach(i=>wireInp(i,id));
          });
        });
      });
    });
    mo.observe(document.documentElement, { childList:true, subtree:true });

    const prev = SKWriter.getSK(id);
    if (prev) {
      markActive(prev);
      try {
        const list = JSON.parse(localStorage.getItem("ablage.active.v1") || "[]");
        if (!list.some(x=>x && x.id===id)) window.__enqueueAblage?.(id, prev);
      } catch(_){}
    }
    if (__SK_DEBUG) console.log("[Patient erkannt]", id, "Host:", location.hostname);
  }

  return { setup };
})();

// ==== Summary ====
function loadSummary(){
  let summary = "Gesamtzeiten:\n";
  for (let i=0;i<localStorage.length;i++){
    const key = localStorage.key(i);
    if (key && key.startsWith("/") && key !== "startTime") {
      summary += `${key}: ${localStorage.getItem(key)} ms\n`;
    }
  }
  const sMap = (()=>{ try { return JSON.parse(localStorage.getItem("sichtungMap") || "{}"); }
    catch { return {}; }
  })();
  const cnt = { rot:0, gelb:0, grün:0, schwarz:0 };
  Object.values(sMap).forEach(k=>{
    if (k==="rot") cnt.rot++;
    else if (k==="gelb") cnt.gelb++;
    else if (k==="gruen") cnt.grün++;
    else if (k==="schwarz") cnt.schwarz++;
  });
  summary += "\nSichtungskategorien:\n";
  ["rot","gelb","grün","schwarz"].forEach(cat=>{
    summary += `${cat}: ${cnt[cat]}\n`;
  });
  alert(summary);
}

// ==== Metadaten ernten (leicht) ====
(function(){
  const META_KEY = "patMeta";
  function saveMeta(id, meta){
    let map={};
    try{ map = JSON.parse(localStorage.getItem(META_KEY)||"{}"); }catch{}
    map[id] = { ...(map[id]||{}), ...meta };
    try{ localStorage.setItem(META_KEY, JSON.stringify(map)); }catch{}
    let scanned=[];
    try{ scanned = JSON.parse(localStorage.getItem("scannedPatients")||"[]"); }catch{}
    if(!scanned.includes(id)) scanned.push(id);
    try{ localStorage.setItem("scannedPatients", JSON.stringify(scanned)); }catch{}
  }
  function normGender(g){
    if(!g) return null;
    const x = String(g).trim().toLowerCase();
    if(x==="m"||/m(ännlich|aennlich)|male|mann|herr/.test(x)) return "männlich";
    if(x==="w"||/weiblich|female|frau|weibl/.test(x))       return "weiblich";
    if(x==="d"||/divers|non[-\s]?binary/.test(x))           return "divers";
    return null;
  }
  function parseGender(t){
    const s = String(t||"").trim();
    let m = s.match(/^\s*([MWDmwdf])\b/);
    if(m){ const n=normGender(m[1]); if(n) return n; }
    m = s.match(/Geschlecht\s*:\s*([a-zäöüA-ZÄÖÜ]+|[MWDmwdf])/i);
    if(m){ const n=normGender(m[1]); if(n) return n; }
    m = s.match(/\b(männlich|maennlich|weiblich|divers|male|female|weibl)\b/i);
    if(m){ const n=normGender(m[1]); if(n) return n; }
    return null;
  }
  function parseAge(t){
    const s=String(t||"");
    let m = s.match(/Alter\s*[: ]\s*(\d{1,3})/i);
    if(m) return m[1];
    m = s.match(/\b(\d{1,3})\s*(Jahre|J|j)\b/i);
    if(m) return m[1];
    m = s.match(/\b(\d{1,3})\s*Jahre\s*alt\b/i);
    if(m) return m[1];
    return null;
  }
  function harvest(){
    const id = window.__detectPatientIdFromPage?.();
    if(!id) return;
    const host = document.querySelector("#patient");
    let age = host?.dataset?.age || null;
    let gender = host?.dataset?.gender || null;
    let photo = host?.dataset?.photo || null;

    const t1 = document.getElementById("btn1")?.innerText || "";
    const t2 = document.getElementById("btn2")?.innerText || "";
    if(!gender) gender = parseGender(t1) || parseGender(t2);
    if(!age)    age    = parseAge(t1)    || parseAge(t2);

    if(!photo){
      try{
        const bg = getComputedStyle(document.body).backgroundImage || "";
        const u  = bg.match(/url\(["']?([^"')]+)["']?\)/i)?.[1] || "";
        if (u) photo = u;
      }catch(_){}
    }

    const meta={};
    if(gender) meta.gender=gender;
    if(age)    meta.age=String(age);
    if(photo)  meta.photo=photo;
    if(Object.keys(meta).length) saveMeta(id, meta);
  }
  if(document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", harvest);
  else
    harvest();
})();

// ==== iOS Tap-Catcher ====
(function(){
  "use strict";
  if (window.__SK_SINGLETON.tap) {
    console.warn('[guard] tap-catcher already active');
    return;
  }
  window.__SK_SINGLETON.tap = true;

  const getPid = ()=> window.__detectPatientIdFromPage?.() || null;
  const getKatFromNode = (node)=>{
    const raw = node.getAttribute?.("data-sichtung")
             || node.getAttribute?.("data-sk")
             || node.getAttribute?.("data-category")
             || node.value
             || node.textContent;
    return SKWriter.normKat(raw);
  };
  const isSK = (node)=>{
    if (!node || node.nodeType !== 1) return false;
    if (node.matches?.(".sk-btn,[data-sichtung],[data-sk],[data-category],button[name='sk'],.btn-sk")) return true;
    if (node.matches?.("input[type='radio'][name='sk'],input[type='radio'][name='sichtung'],select[name='sk'],select[name='sichtung']")) return true;
    return false;
  };

  function handleTap(target, ev){
    let el = target;
    for (let i=0; i<3 && el; i++, el = el.parentElement) {
      if (isSK(el)) {
        const pid = getPid();
        const kat = getKatFromNode(el);
        if (__SK_DEBUG) console.log("⛳ Tap SK:", { pid, kat });
        if (!pid || !kat) return;

        // ✅ PATCH: force=true => letzter Tap gewinnt
        const changed = SKWriter.setSK(pid, kat, { force:true });

        if (changed) {
          try{
            document.querySelectorAll(".sk-btn").forEach(b=>b.classList.remove("is-active"));
            if (el.classList.contains("sk-btn")) el.classList.add("is-active");
            document.documentElement.setAttribute("data-sichtung", kat);
          }catch(_){}
          try { ev?.stopImmediatePropagation?.(); } catch(_){}
        }
        break;
      }
    }
  }

  let __lastTapAt = 0;
  document.addEventListener('pointerup', (e) => {
    const now = Date.now();
    if (now - __lastTapAt < 350) return;
    __lastTapAt = now;
    handleTap(e.target, e);
  }, true);

  document.addEventListener("DOMContentLoaded", ()=>{
    const pid = getPid();
    if (!pid) {
      if (__SK_DEBUG) console.warn("⚠️ keine Patient-ID (Tap-Catcher)");
      return;
    }
    const prev = SKWriter.getSK(pid);
    if (prev) {
      try {
        const list = JSON.parse(localStorage.getItem("ablage.active.v1") || "[]");
        if (!list.some(x=>x && x.id===pid)) window.__enqueueAblage?.(pid, prev);
      } catch(_){}
    }
    if (__SK_DEBUG) console.log("[Tap-Catcher aktiv]", pid, "Host:", location.hostname);
  });
})();

/* =========================================================
   Countdown UI + Vibration (zentral, rein visuell)
   ========================================================= */
(function(){
  if (window.__COUNTDOWN_UI__) return;
  window.__COUNTDOWN_UI__ = true;

  let lastVibrate = 0;

  function canVibrate(){
    return "vibrate" in navigator;
  }

  function vibrateOnce(pattern){
    const now = Date.now();
    // max 1x pro Sekunde
    if (now - lastVibrate < 1000) return;
    lastVibrate = now;

    try { navigator.vibrate(pattern); } catch(_){}
  }

  function parseSeconds(text){
    if(!text) return null;
    const clean = String(text).trim().replace(/[^\d:]/g,"");
    if(!clean) return null;

    if(clean.includes(":")){
      const [m,s] = clean.split(":").map(Number);
      if(Number.isFinite(m) && Number.isFinite(s)) return m*60 + s;
      return null;
    }
    const n = parseInt(clean,10);
    return Number.isFinite(n) ? n : null;
  }

  function updateCountdownUI(){
    document.querySelectorAll(".countdown").forEach(cd=>{
      const btn = cd.closest(".btn");
      if(!btn) return;

      const secs = parseSeconds(cd.textContent);
      const running = secs !== null && secs > 0;
      const urgent  = running && secs <= 10;

      btn.classList.toggle("countdown-active", running);
      btn.classList.toggle("countdown-urgent", urgent);

      // 📳 Vibration nur bei urgent
      if (urgent && canVibrate()) {
        vibrateOnce([120, 80, 120]);
      }
    });
  }

  function observeCountdowns(){
    document.querySelectorAll(".countdown").forEach(cd=>{
      new MutationObserver(updateCountdownUI)
        .observe(cd, { childList:true, characterData:true, subtree:true });
    });

    document.querySelectorAll(".btn").forEach(btn=>{
      new MutationObserver(updateCountdownUI)
        .observe(btn, { attributes:true, attributeFilter:["class"] });
    });

    updateCountdownUI();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", observeCountdowns);
  } else {
    observeCountdowns();
  }
})();

// ==== Interne Links in PWA halten + Startseite-Modal ====
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href]');
  if (!a) return;

  const url = new URL(a.getAttribute('href'), location.href);
  if (url.origin !== location.origin) return;

  // Startseite-Button → Sicherheits-Modal
  if (a.id === 'startseiteButton') {
    e.preventDefault();
    e.stopImmediatePropagation(); // ganz wichtig, damit NICHTS anderes mehr feuert
    const targetHref = url.pathname + url.search + url.hash;
    showStartAbbruchModal(targetHref);
    return;
  }

  // alle anderen internen Links wie bisher behandeln
  if (a.target && a.target.toLowerCase() !== '_self') {
    a.target = '_self';
  }
  if (!e.defaultPrevented && e.button === 0) {
    e.preventDefault();
    location.assign(url.pathname + url.search + url.hash);
  }
}, { capture: true });

/* =========================================================
   SK-Toggle (SK1 → T, SK3 → B) – stabil, eigens verdrahtet
   PATCH: SK-Buttons bleiben sichtbar, T/B nur bei SK1/SK3 sichtbar
   + Reset-Flags bei Wechsel auf SK2/SK4
   ========================================================= */
document.addEventListener("DOMContentLoaded", () => {
  const skWrap  = document.getElementById("sk-btns");
  const toggleT = document.getElementById("transportToggle"); // SK1 / T
  const toggleB = document.getElementById("affectedToggle");  // SK3 / B
  if (!skWrap) return; // Seite ohne SK-Buttons

  const pid = (window.__detectPatientIdFromPage?.() || "").toLowerCase();
  const STORE_KEY = "sicht_" + (pid || "unknown");

  let pendingCat = null; // 'rot','gelb','gruen','schwarz'

  // ✅ T/B darf vor Auswahl NICHT sichtbar sein
  function hideTB(){
    toggleT && toggleT.classList.add("hidden");
    toggleB && toggleB.classList.add("hidden");
  }
  function showT(){
    hideTB();
    toggleT && toggleT.classList.remove("hidden");
  }
  function showB(){
    hideTB();
    toggleB && toggleB.classList.remove("hidden");
  }

  // Beim Laden immer verstecken
  hideTB();

  function savePayload(cat, flags){
    const payload = { cat, t:!!flags?.t, b:!!flags?.b, ts: Date.now() };
    try { localStorage.setItem(STORE_KEY, JSON.stringify(payload)); } catch {}

    // ✅ immer in zentrale Sichtung + Ablage schreiben (letzter Klick gewinnt)
    if (pid && cat) {
      SKWriter.setSK(pid, cat, { force:true });
    }

    if (window.sendMetric) {
      try { sendMetric("sichtung", payload); } catch {}
    }
    if (window.__SK_DEBUG) console.log("✅ Sichtung gespeichert (Toggle)", payload);
  }

  // SK-Buttons verdrahten (nur Toggle-Verhalten)
  skWrap.querySelectorAll(".sk-btn").forEach(btn => {
    if (btn.__wiredToggleSK) return;
    btn.__wiredToggleSK = true;

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();

      // Alte T/B Frage weg, wird bei SK1/SK3 wieder gezeigt
      hideTB();

      const raw = btn.dataset.sichtung || btn.getAttribute("data-sichtung") || btn.textContent;
      const cat = SKWriter.normKat(raw); // 'rot','gelb','gruen','schwarz'
      if (!cat) return;

      pendingCat = cat;

      // ✅ Sofort SK speichern (ohne Flags) -> Ablage ist direkt korrekt
      if (pid) SKWriter.setSK(pid, cat, { force:true });

      if (cat === "rot") {                 // SK1 -> T fragen
        showT();
      } else if (cat === "gruen") {        // SK3 -> B fragen
        showB();
      } else {
        // ✅ SK2 / SK4: keine Zusatzfrage + Flags resetten
        savePayload(cat, { t:false, b:false });
        hideTB();
      }
    });
  });

  // T (für SK1)
  document.getElementById("t-yes")?.addEventListener("click", (e) => {
    e.preventDefault(); e.stopPropagation();
    savePayload(pendingCat || "rot", { t:true, b:false });
    hideTB();
  });
  document.getElementById("t-no")?.addEventListener("click", (e) => {
    e.preventDefault(); e.stopPropagation();
    savePayload(pendingCat || "rot", { t:false, b:false });
    hideTB();
  });

  // B (für SK3)
  document.getElementById("b-yes")?.addEventListener("click", (e) => {
    e.preventDefault(); e.stopPropagation();
    savePayload(pendingCat || "gruen", { t:false, b:true });
    hideTB();
  });
  document.getElementById("b-no")?.addEventListener("click", (e) => {
    e.preventDefault(); e.stopPropagation();
    savePayload(pendingCat || "gruen", { t:false, b:false });
    hideTB();
  });

  // ✅ Wenn Seite mit bestehender SK geladen wird: T/B NICHT automatisch anzeigen (so gewünscht)
});

// === Anzeige-Helfer für Auswertung/Ablage/Klinik ====
function __getPatientId(){
  return (window.__detectPatientIdFromPage?.() || "").toLowerCase();
}

function __readTogglePayload(id){
  let raw = null;
  try { raw = localStorage.getItem("sicht_" + id); } catch(_){}
  if (!raw) {
    const pathKey = "sicht_" + (location.pathname.split("/").pop() || "unknown");
    try { raw = localStorage.getItem(pathKey); } catch(_){}
  }
  if (!raw) return null;
  try { return JSON.parse(raw); } catch(_) { return null; }
}

function __labelFromCat(cat){
  if (!cat) return "";
  const norm = String(cat).toLowerCase();
  if (norm === "rot") return "SK1";
  if (norm === "gelb") return "SK2";
  if (norm === "gruen" || norm === "grün") return "SK3";
  if (norm === "schwarz") return "SK4";
  return "";
}

function getSichtungDisplay(id){
  id = String(id||"").toLowerCase();

  let cat = null;
  try {
    const map = JSON.parse(localStorage.getItem("sichtungMap") || "{}");
    if (map[id]) cat = map[id];
  } catch(_){}
  if (!cat) {
    try {
      const a = JSON.parse(localStorage.getItem("ablage.active.v1") || "[]");
      cat = a.find(x=>x && x.id===id)?.sk || null;
    } catch(_){}
  }

  const payload = __readTogglePayload(id);
  const t = !!(payload && payload.t);
  const b = !!(payload && payload.b);

  if (!cat && payload && payload.cat) cat = payload.cat;

  const base = __labelFromCat(cat);
  if (!base) return "";
  if (cat === 'rot'   && t) return base + " · T";
  if (cat === 'gruen' && b) return base + " · B";
  return base;
}

// ===== License Runtime Guard (global) =====
(function(){
  if (window.__LICENSE_GUARD_INIT__) return;
  window.__LICENSE_GUARD_INIT__ = true;

  const LICENSE_ENDPOINT = '/license.php';
  const BLOCK_REDIRECT   = '/gesperrt.html';
  const REQUIRE_ATTR     = 'data-require-license';

  const path = (location.pathname || '').toLowerCase();
  if (path.includes('admin_licenses.php') || path.includes('/wp-admin') || path.includes('/admin')) {
    return;
  }

  function getDeviceId(){
    try{
      const KEY='DEVICE_ID_V1';
      let id = localStorage.getItem(KEY);
      if(!id){
        id = (crypto.randomUUID ? crypto.randomUUID() : (Date.now()+''+Math.random()))
              .toString().replace(/[^a-f0-9]/gi,'');
        localStorage.setItem(KEY, id);
      }
      return id;
    }catch(_){ return 'web-'+Date.now(); }
  }
  function getLicenseToken(){
    try{ return localStorage.getItem('LICENSE_TOKEN') || ''; }catch(_){ return ''; }
  }
  function setLicenseToken(t){
    try{ localStorage.setItem('LICENSE_TOKEN', t||''); }catch(_){}
  }
  function clearLicense(){
    try{
      localStorage.removeItem('LICENSE_TOKEN');
    }catch(_){}
  }

  async function heartbeat(){
    const token = getLicenseToken();
    if (!token) return { ok:false, code:'no_token' };
    const body = new URLSearchParams({ action:'heartbeat', token, device_id:getDeviceId() });
    try{
      const res = await fetch(LICENSE_ENDPOINT, {
        method:'POST',
        headers:{ 'Content-Type':'application/x-www-form-urlencoded', 'Cache-Control':'no-store' },
        body
      });
      const data = await res.json().catch(()=>null);
      return data || { ok:false, code:'bad_json' };
    }catch(_){
      return { ok:false, code:'net_fail' };
    }
  }

  let lastRun = 0;
  async function enforceLicenseNow(force=false){
    const now = Date.now();
    if (!force && (now - lastRun) < 60_000) return;
    lastRun = now;

    const token = getLicenseToken();
    if (!token) return;

    const hb = await heartbeat();
    if (!hb || hb.ok !== true){
      clearLicense();
      if (location.pathname !== BLOCK_REDIRECT){
        location.href = BLOCK_REDIRECT;
      }
      return;
    }
  }

  document.addEventListener('visibilitychange', ()=>{
    if (document.visibilityState==='visible') enforceLicenseNow(true);
  });
  window.addEventListener('online', ()=>enforceLicenseNow(true));

  setInterval(enforceLicenseNow, 60_000);
  enforceLicenseNow(true);

  window.resolveLicenseLogin = async function(token){
    setLicenseToken(token);
    const body = new URLSearchParams({ action:'resolve', token, device_id:getDeviceId() });
    const res  = await fetch(LICENSE_ENDPOINT, {
      method:'POST',
      headers:{ 'Content-Type':'application/x-www-form-urlencoded', 'Cache-Control':'no-store' },
      body
    }).catch(()=>null);

    let data=null;
    try{ data = await res.json(); }catch(_){}
    if (!res || !res.ok || !data || data.ok !== true){
      clearLicense();
      throw (data||{ok:false});
    }
    return data;
  };
})();
