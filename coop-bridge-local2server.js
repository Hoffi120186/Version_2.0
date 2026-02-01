// /coop-bridge-local2server.js  (v1)
// Zweck: lokale Ablage/Sichtung -> Server (patchPatient)
// Funktioniert ohne Änderungen an deinen Buttons, solange du
// sichtungMap + ablage.active.v1 nutzt.

(() => {
  "use strict";

  const VER = "coop-bridge-local2server-v1";
  if (window.__COOP_L2S_VER__ === VER) return;
  window.__COOP_L2S_VER__ = VER;

  const DEBUG = true;
  const log  = (...a) => DEBUG && console.log("[COOP-L2S]", ...a);
  const warn = (...a) => console.warn("[COOP-L2S]", ...a);

  const KEY_SICHTUNG = "sichtungMap";
  const KEY_ABLAGE   = "ablage.active.v1";

  const normKat = (v) => {
    const x = String(v || "").trim().toLowerCase().replace("grün", "gruen");
    if (x === "sk1" || x === "rot") return "SK1";
    if (x === "sk2" || x === "gelb") return "SK2";
    if (x === "sk3" || x === "gruen") return "SK3";
    if (x === "sk4" || x === "schwarz") return "SK4";
    return "";
  };

  const readJSON = (k, fb) => {
    try { return JSON.parse(localStorage.getItem(k) || ""); } catch { return fb; }
  };

  const getFlagsLocal = (patientLc) => {
    // deine vorhandene Logik: sicht_patientX / sicht_patientX JSON
    // wenn du Flags anders speicherst, hier anpassen.
    try {
      const raw = localStorage.getItem("sicht_" + patientLc);
      if (!raw) return { flag_t: 0, flag_b: 0 };
      const j = JSON.parse(raw);
      return { flag_t: j?.t ? 1 : 0, flag_b: j?.b ? 1 : 0 };
    } catch {
      return { flag_t: 0, flag_b: 0 };
    }
  };

  const pidFromLc = (patientLc) => {
    const n = parseInt(String(patientLc).replace(/\D/g, ""), 10);
    return Number.isFinite(n) ? n : 0;
  };

  // --- Queue/De-Dupe, damit wir nicht spammen ---
  const pending = new Map(); // pid -> payload
  let flushTimer = null;

  function enqueue(pid, payload) {
    if (!pid) return;
    pending.set(pid, payload);
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, 150);
  }

  async function flush() {
    flushTimer = null;
    if (!pending.size) return;

    if (!window.Coop || typeof window.Coop.patchPatient !== "function") {
      warn("Coop.patchPatient fehlt – coop-client nicht geladen?");
      return;
    }

    const st = (window.Coop.getStatus && window.Coop.getStatus()) || {};
    if (!st.incident_id || !st.token) {
      warn("keine aktive Coop-Session – skip flush");
      return;
    }

    const batch = [...pending.entries()];
    pending.clear();

    for (const [pid, payload] of batch) {
      try {
        await window.Coop.patchPatient(pid, payload);
        log("patched", pid, payload);
      } catch (e) {
        warn("patch failed", pid, e?.message || e);
        // Retry beim nächsten Change reicht meistens; optional: re-enqueue
      }
    }
  }

  // --- Aus lokalen Daten “was liegt in Ablage?” ableiten ---
  function syncNow(reason = "manual") {
    const sMap = readJSON(KEY_SICHTUNG, {}) || {};
    const abl  = readJSON(KEY_ABLAGE, []) || [];

    // Wir nehmen Patienten aus der Ablage-Liste (ablage.active.v1)
    // und holen dazu SK aus sichtungMap.
    for (const it of (Array.isArray(abl) ? abl : [])) {
      const idLc = String(it?.id || "").toLowerCase();
      if (!/^patient\d+$/.test(idLc)) continue;

      const pid = pidFromLc(idLc);
      const triage = normKat(it?.sk || sMap[idLc] || "");
      if (!triage) continue;

      const flags = getFlagsLocal(idLc);

      enqueue(pid, {
        triage,
        location: "ABLAGE_1",
        flag_t: flags.flag_t,
        flag_b: flags.flag_b
      });
    }

    log("syncNow", reason, "queued:", pending.size);
    flush();
  }

  // Storage-Changes (auch tabübergreifend)
  window.addEventListener("storage", (e) => {
    if (!e?.key) return;
    if (e.key === KEY_SICHTUNG || e.key === KEY_ABLAGE || e.key.startsWith("sicht_")) {
      syncNow("storage:" + e.key);
    }
  });

  // Optional: BroadcastChannel (gleiches Gerät, andere Tabs)
  try {
    const bc = new BroadcastChannel("ablage");
    bc.onmessage = (msg) => {
      const t = msg?.data?.type;
      if (t === "refresh" || t === "upsert" || t === "done") syncNow("bc:" + t);
    };
  } catch {}

  // Beim Start/Restore einmal schieben
  window.addEventListener("coop:created",  () => syncNow("created"));
  window.addEventListener("coop:joined",   () => syncNow("joined"));
  window.addEventListener("coop:restored", () => syncNow("restored"));
  window.addEventListener("load",          () => setTimeout(() => syncNow("load"), 400));
})();
