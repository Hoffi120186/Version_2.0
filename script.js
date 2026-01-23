// script.js — 2025-11-25-6 (patched: last-click-wins + SK jederzeit änderbar + T/B nur bei SK1/SK3)
// + COOP PATCH: SK schreibt zusätzlich in Coop-Backend (triage + location=ABLAGE_1)

// ==== Version & Singleton Guards (wichtig gegen doppelte Init via SW) ====
(function(){
  const VER = '2025-11-25-6-coop2';
  if (window.__APP_VER && window.__APP_VER === VER) {
    console.warn('[guard] already initialized', VER);
    return;
  }
  window.__APP_VER = VER;
  window.__SK_SINGLETON = window.__SK_SINGLETON || { wired:false, tap:false };
})();

// ==== (Optional) Host-Normalizer gegen Split-Storage ====
const CANONICAL_HOST = ""; // z.B. "www.1rettungsmittel.de" oder "app.1rettungsmittel.de"
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

// ==== Zentraler Writer: Dedupe + Throttle + Ablage-Kompat + COOP Sync ====
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

  // ===== COOP Sync (triage + location) =====
  const COOP_LOC_ABLAGE = "ABLAGE_1";

  const coopState = () => {
    try {
      if (window.Coop && typeof window.Coop.getState === "function") return window.Coop.getState();
    } catch {}
    try {
      const raw = localStorage.getItem("coop_state_v1") || localStorage.getItem("coop_state");
      return raw ? JSON.parse(raw) : null;
    } catch {}
    return null;
  };

  const coopEnabled = () => {
    const st = coopState();
    return !!(st && st.incident_id && st.token);
  };

  const pidNum = (id) => parseInt(String(id||"").replace(/\D/g,""), 10) || 0;

  const coopLastSend = new Map();
  const COOP_MIN_MS = 250;

  function coopSyncTriageAndLocation(id, kat){
    try{
      if (!coopEnabled()) return;
      if (!window.Coop || typeof window.Coop.patchPatient !== "function") return;

      const p = pidNum(id);
      if (!p) return;

      const t = Date.now();
      const last = coopLastSend.get(id) || 0;
      if (t - last < COOP_MIN_MS) return;
      coopLastSend.set(id, t);

      // ✅ FIX: richtige Signatur: patchPatient(patient_id, patchObject)
      window.Coop
        .patchPatient(p, { triage: kat, location: COOP_LOC_ABLAGE })
        .catch(err => console.warn("[COOP] patch failed", err));
    }catch(e){
      console.warn("[COOP] sync error", e);
    }
  }

  function setSK(rawId, rawKat, opts = {}){
    const id  = String(rawId||"").toLowerCase();
    const kat = normKat(rawKat);
    if (!id || !kat) return false;

    const force = !!opts.force;

    const now  = Date.now();
    const last = lastWriteTs.get(id) || 0;
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

    // ✅ COOP: direkt ins Backend syncen (triage + location)
    coopSyncTriageAndLocation(id, kat);

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
function resetAndRedirect() { window.location.href = "/index.html"; }
function endMission() { localStorage.setItem("appGesperrt", "true"); location.reload(); }

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

  cancelBtn.onclick = () => { backdrop.classList.add("hidden"); };

  confirmBtn.onclick = () => {
    backdrop.classList.add("hidden");
    if (typeof window.resetAndRedirect === "function") resetAndRedirect();
    else window.location.href = targetHref;
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
    if (idx >= 0) list[idx] = { ...list[idx], id, sk: kat, lastUpdate: now, start: list[idx].start ?? now };
    else list.push({ id, sk: kat, start: now, lastUpdate: now });
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

// (… ab hier bleibt DEIN Script exakt wie gepostet …)
// Du kannst den Rest 1:1 drunter lassen – ich habe nur den Coop-call gefixt.
