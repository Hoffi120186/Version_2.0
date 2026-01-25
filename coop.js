// /coop.js (ROOT) — 2026-01-22-2
// FINAL: robust session + start/stop + auto-resume
// + IMPORTANT FIX: incoming state changes are written into local app storage
(() => {
  "use strict";

  const DEFAULTS = {
    apiBase: "https://www.1rettungsmittel.de/api/coop_test",
    pollMs: 1500,
    heartbeatMs: 8000,
    storageKey: "coop_session_v1",
    lsActive: "coop.active",
    sinceSkewSeconds: 2,

    // self-heal thresholds
    maxConsecutivePollErrors: 6,   // ~9s at 1500ms
    maxConsecutiveHbErrors: 3,     // ~24s at 8000ms
  };

  const S = {
    enabled: false,
    apiBase: DEFAULTS.apiBase,

    incident_id: null,
    join_code: null,
    client_id: null,
    role: null,   // "ORGL" / "RTW" / "NEF" ...
    token: null,

    since: "",
    lastVersion: new Map(),

    timers: { poll: null, hb: null },

    pollErrStreak: 0,
    hbErrStreak: 0,
  };

  function log(...a) { console.log("[COOP]", ...a); }
  function warn(...a) { console.warn("[COOP]", ...a); }
  function emit(name, detail = {}) {
    window.dispatchEvent(new CustomEvent(`coop:${name}`, { detail }));
  }

  // ---------------------------
  // Storage helpers (truth = session)
  // ---------------------------
  function saveSession() {
    const payload = {
      apiBase: S.apiBase,
      incident_id: S.incident_id,
      join_code: S.join_code,
      client_id: S.client_id,
      role: S.role,
      token: S.token,
      since: S.since,
      t: Date.now(),
    };
    try { localStorage.setItem(DEFAULTS.storageKey, JSON.stringify(payload)); } catch {}

    // ✅ Keep a simple "state" mirror for older code that reads coop_state_v1
    try {
      localStorage.setItem("coop_state_v1", JSON.stringify({
        apiBase: S.apiBase,
        incident_id: S.incident_id,
        join_code: S.join_code,
        client_id: S.client_id,
        role: S.role,
        token: S.token,
        since: S.since,
        t: Date.now(),
      }));
    } catch {}
  }

  function loadSession() {
    try {
      const raw = localStorage.getItem(DEFAULTS.storageKey);
      if (!raw) return null;
      const data = JSON.parse(raw);
      return (data && typeof data === "object") ? data : null;
    } catch {
      return null;
    }
  }

  function clearSession() {
    try { localStorage.removeItem(DEFAULTS.storageKey); } catch {}
    try { localStorage.removeItem("coop_state_v1"); } catch {}
  }

  function setActiveFlag(on) {
    try { localStorage.setItem(DEFAULTS.lsActive, on ? "1" : "0"); } catch {}
  }
  function isActiveFlag() {
    try { return localStorage.getItem(DEFAULTS.lsActive) === "1"; } catch { return false; }
  }

  function hasSession() {
    const sess = loadSession();
    return !!(sess && sess.incident_id && sess.token);
  }

  function healActiveFlagFromSession() {
    if (hasSession()) setActiveFlag(true);
  }

  function statusSnapshot() {
    const sess = loadSession();
    const sessOk = !!(sess?.incident_id && sess?.token);
    const runtimeOk = !!(S.incident_id && S.token);
    return {
      active: sessOk || runtimeOk,
      enabled: !!S.enabled,
      hasSession: sessOk,
      incident_id: sess?.incident_id || S.incident_id || "",
      join_code: sess?.join_code || S.join_code || "",
      role: sess?.role || S.role || "",
      client_id: sess?.client_id || S.client_id || "",
    };
  }

  function broadcastStatus() {
    emit("status", statusSnapshot());
  }

  // ---------------------------
  // HARD RESET (kills zombie states)
  // ---------------------------
  function hardReset(reason = "manual") {
    warn("HARD RESET:", reason);

    stop();
    S.enabled = false;

    S.incident_id = null;
    S.join_code = null;
    S.client_id = null;
    S.role = null;
    S.token = null;

    S.since = "";
    S.lastVersion.clear();

    S.pollErrStreak = 0;
    S.hbErrStreak = 0;

    clearSession();
    try { localStorage.removeItem(DEFAULTS.lsActive); } catch {}
    try { sessionStorage.clear(); } catch {}

    setActiveFlag(false);

    emit("reset", { reason });
    broadcastStatus();
  }

  function requireValidRuntimeSessionOrReset(where = "unknown") {
    if (S.enabled && (!S.incident_id || !S.token)) {
      hardReset(`zombie_runtime_${where}`);
      emit("need_join", {});
      return false;
    }
    return true;
  }

  // ---------------------------
  // Fetch helpers
  // ---------------------------
  async function fetchJSON(url, opts = {}) {
    const res = await fetch(url, opts);
    const data = await res.json().catch(() => ({}));

    if (!res.ok || data?.ok === false) {
      const msg = data?.error || `HTTP_${res.status}`;
      const err = new Error(msg);
      err._http = res.status;
      err._data = data;
      throw err;
    }
    return data;
  }

  function qs(params) {
    const u = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v === undefined || v === null || v === "") return;
      u.set(k, String(v));
    });
    return u.toString();
  }

  function isInvalidSessionError(msg = "") {
    const m = String(msg || "").toLowerCase();
    return (
      m.includes("invalid") ||
      m.includes("token") ||
      m.includes("unauthorized") ||
      m.includes("forbidden") ||
      m.includes("not_found") ||
      m.includes("incident") ||
      m.includes("expired") ||
      m.includes("ended") ||
      m.includes("closed")
    );
  }

  function subtractSecondsFromDatetimeString(dt, seconds) {
    try {
      const [d, t] = dt.split(" ");
      const [Y, M, D] = d.split("-").map(Number);
      const [h, m, s] = t.split(":").map(Number);
      const ms = new Date(Y, M - 1, D, h, m, s).getTime();
      const ms2 = ms - seconds * 1000;
      const d2 = new Date(ms2);
      const pad = (n) => String(n).padStart(2, "0");
      return `${d2.getFullYear()}-${pad(d2.getMonth() + 1)}-${pad(d2.getDate())} ${pad(d2.getHours())}:${pad(d2.getMinutes())}:${pad(d2.getSeconds())}`;
    } catch {
      return dt;
    }
  }

  // =========================================================
  // ✅ APPLY REMOTE CHANGES → LOCAL APP STORAGE
  // This is THE missing part for “patient shows up on all devices”.
  // =========================================================
  const LS_SICHTUNG_MAP = "sichtungMap";
  const LS_ABL_ACTIVE   = "ablage.active.v1";

  function safeJSONParse(s, fallback) { try { return JSON.parse(s); } catch { return fallback; } }
  function lsGetObj(key, fallback) {
    try { return safeJSONParse(localStorage.getItem(key), fallback); } catch { return fallback; }
  }
  function lsSetObj(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
  }

  function normKat(v){
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
  }

  function upsertAblageActive(patientIdLc, kat){
    const now = Date.now();
    const list = Array.isArray(lsGetObj(LS_ABL_ACTIVE, [])) ? lsGetObj(LS_ABL_ACTIVE, []) : [];
    const idx  = list.findIndex(e => e && String(e.id).toLowerCase() === patientIdLc);

    if (idx >= 0) {
      list[idx] = { ...list[idx], id: patientIdLc, sk: kat, lastUpdate: now, start: list[idx].start ?? now };
    } else {
      list.push({ id: patientIdLc, sk: kat, start: now, lastUpdate: now });
    }

    lsSetObj(LS_ABL_ACTIVE, list);

    // legacy mirrors (bei dir teilweise noch genutzt)
    try { localStorage.setItem("ablage", JSON.stringify(list)); } catch {}
    try { localStorage.setItem("ablage_ids", JSON.stringify(list.map(x => x.id))); } catch {}
    try { localStorage.setItem("ablage_patient_" + patientIdLc, kat); } catch {}

    // optional: BroadcastChannel für Tabs (gleiches Gerät)
    try { new BroadcastChannel("ablage").postMessage({ type:"upsert", id: patientIdLc, sk: kat }); } catch {}
  }

  function applyRemoteRowsToLocal(rows){
    if (!rows || !rows.length) return;

    // sichtungMap laden
    const map = lsGetObj(LS_SICHTUNG_MAP, {}) || {};
    let changedMap = false;

    for (const r of rows){
      const pidNum = parseInt(String(r.patient_id || "").replace(/\D/g,""), 10);
      if (!pidNum) continue;

      const id = ("patient" + pidNum).toLowerCase();

      // triage vom Server übernehmen
      const kat = normKat(r.triage);
      if (kat){
        if (map[id] !== kat){
          map[id] = kat;
          changedMap = true;
        }

        // kompatible Keys
        try { localStorage.setItem("sichtung_" + id, kat); } catch {}
        // Ablage automatisch füllen (damit Ablage1.html den Patienten sieht)
        upsertAblageActive(id, kat);
      }

      // (Optional) Wenn du Location strikt steuern willst:
      // Wenn location leer ist, lassen wir es.
      // Wenn location auf "ABLAGE_1" zeigt aber triage fehlt, könntest du trotzdem upserten – macht aber ohne SK wenig Sinn.
    }

    if (changedMap){
      lsSetObj(LS_SICHTUNG_MAP, map);
    }
  }

  // ---------------------------
  // Timers
  // ---------------------------
  function start() {
    stop();

    // if enabled but no session -> do not pretend
    if (S.enabled && (!S.incident_id || !S.token)) {
      setActiveFlag(false);
      emit("need_join", {});
      broadcastStatus();
      return;
    }

    S.timers.poll = setInterval(pullState, DEFAULTS.pollMs);
    S.timers.hb   = setInterval(ping, DEFAULTS.heartbeatMs);

    pullState();
    ping();
    broadcastStatus();
  }

  function stop() {
    if (S.timers.poll) clearInterval(S.timers.poll);
    if (S.timers.hb)   clearInterval(S.timers.hb);
    S.timers.poll = null;
    S.timers.hb   = null;
  }

  // ---------------------------
  // API: create/join/patch/state/ping
  // ---------------------------
  async function createIncident(payload = {}) {
    S.enabled = true;

    const url = `${S.apiBase}/create_incident.php`;
    const data = await fetchJSON(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    S.incident_id = data.incident_id || S.incident_id;
    S.join_code   = data.join_code   || S.join_code;
    S.token       = data.token       || S.token;
    S.client_id   = data.client_id   || S.client_id;
    S.role        = data.role        || "ORGL";

    S.since = "";
    S.lastVersion.clear();
    S.pollErrStreak = 0;
    S.hbErrStreak = 0;

    saveSession();
    setActiveFlag(true);

    emit("created", data);
    log("created", data);

    start();
    return data;
  }

  async function joinIncident({ join_code, role }) {
    S.enabled = true;

    const url = `${S.apiBase}/join_incident.php`;
    const data = await fetchJSON(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ join_code, role }),
    });

    S.incident_id = data.incident_id;
    S.client_id   = data.client_id;
    S.role        = data.role || role || null;
    S.token       = data.token;
    S.join_code   = join_code;

    S.since = "";
    S.lastVersion.clear();
    S.pollErrStreak = 0;
    S.hbErrStreak = 0;

    saveSession();
    setActiveFlag(true);

    emit("joined", data);
    log("joined", data);

    start();
    return data;
  }

  async function ping() {
  if (!S.enabled) return;
  if (!requireValidRuntimeSessionOrReset("ping")) return;

  try {
    // ✅ ping.php will FORM-encoded, not JSON
    const body = new URLSearchParams({
      incident_id: S.incident_id || "",
      token: S.token || "",
      client_id: S.client_id || ""
    });

    const res = await fetch(`${S.apiBase}/ping.php`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body
    });

    const txt = await res.text();
    let data = {};
    try { data = JSON.parse(txt || "{}"); } catch {}

    if (!res.ok || data?.ok === false) {
      const msg = data?.error || `HTTP_${res.status}`;
      throw new Error(msg);
    }

    S.hbErrStreak = 0;
    emit("heartbeat", { ok: true, server_time: data.server_time });
  } catch (e) {
    const msg = e?.message || "heartbeat_error";
    S.hbErrStreak++;

    emit("heartbeat", { ok: false, error: msg });
    warn("heartbeat fail:", msg);

    if (isInvalidSessionError(msg) || S.hbErrStreak >= DEFAULTS.maxConsecutiveHbErrors) {
      emit("ended", { reason: `heartbeat_${msg}` });
      hardReset(`heartbeat_invalid_${msg}`);
      emit("need_join", {});
    }
  }
}


  async function pullState() {
    if (!S.enabled) return;
    if (!requireValidRuntimeSessionOrReset("pullState")) return;

    const sinceSafe = S.since
      ? subtractSecondsFromDatetimeString(S.since, DEFAULTS.sinceSkewSeconds)
      : "";

    const url = `${S.apiBase}/state.php?` + qs({
      incident_id: S.incident_id,
      token: S.token,
      since: sinceSafe,
    });

    try {
      const data = await fetchJSON(url);

      S.pollErrStreak = 0;

      if (data?.ended === true || data?.status === "ended" || data?.status === "closed") {
        emit("ended", { reason: "server_flag" });
        hardReset("server_flag_ended");
        emit("need_join", {});
        return;
      }

      const serverTime = data.server_time;
      const changes = Array.isArray(data.changes) ? data.changes : [];

      // Optional "end" detection
      const endRow = changes.find(r => String(r.type || "").toLowerCase().includes("end"));
      if (endRow) {
        emit("ended", { reason: "server_change", row: endRow });
        hardReset("server_change_end");
        emit("need_join", {});
        return;
      }

      const filtered = [];
      for (const row of changes) {
        const pid = String(row.patient_id);
        const ver = Number(row.version || 0);
        const last = Number(S.lastVersion.get(pid) || 0);
        if (ver > last) {
          S.lastVersion.set(pid, ver);
          filtered.push(row);
        }
      }

      if (typeof serverTime === "string" && serverTime.length >= 19) {
        S.since = serverTime;
      }

      saveSession();

      if (filtered.length) {
        // ✅ THIS is the missing glue:
        applyRemoteRowsToLocal(filtered);

        emit("changes", { changes: filtered, server_time: serverTime });
      }

      broadcastStatus();
    } catch (e) {
      const msg = e?.message || "poll_error";
      S.pollErrStreak++;

      emit("poll_error", { error: msg });
      warn("pullState fail:", msg);

      if (isInvalidSessionError(msg) || S.pollErrStreak >= DEFAULTS.maxConsecutivePollErrors) {
        emit("ended", { reason: `poll_${msg}` });
        hardReset(`poll_invalid_${msg}`);
        emit("need_join", {});
      }
    }
  }

  async function patchPatient(patient_id, patch = {}) {
    if (!S.enabled) throw new Error("coop_not_enabled");
    if (!S.incident_id || !S.token) throw new Error("missing_session");

    const url = `${S.apiBase}/patch_patient.php`;
    const body = {
      incident_id: S.incident_id,
      token: S.token,
      patient_id,
      ...patch,
    };

    try {
      const data = await fetchJSON(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      emit("patched", { patient_id, patch, version: data.version });
      return data;
    } catch (e) {
      const msg = e?.message || "patch_error";
      emit("patch_error", { patient_id, error: msg });

      if (isInvalidSessionError(msg)) {
        emit("ended", { reason: `patch_${msg}` });
        hardReset(`patch_invalid_${msg}`);
        emit("need_join", {});
      }
      throw e;
    }
  }

  // ---------------------------
  // End/Leave handling
  // ---------------------------
  async function endIncidentOnServer() {
    const url = `${S.apiBase}/end_incident.php`;
    return fetchJSON(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ incident_id: S.incident_id, token: S.token }),
    });
  }

  async function leaveIncidentOnServer() {
    const url = `${S.apiBase}/leave_incident.php`;
    return fetchJSON(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ incident_id: S.incident_id, token: S.token, client_id: S.client_id }),
    });
  }

  async function end(opts = {}) {
    const mode = opts.mode || "auto";
    const reason = opts.reason || "user_action";

    const role = (S.role || loadSession()?.role || "").toUpperCase();
    const isOrgL = role === "ORGL" || role === "ORG L" || role === "ORG-L";

    const finalMode = (mode === "auto")
      ? (isOrgL ? "end" : "leave")
      : mode;

    emit("ending", { mode: finalMode, reason });

    if (!S.incident_id || !S.token) {
      hardReset(`end_no_session_${reason}`);
      emit("ended", { mode: finalMode, reason });
      return true;
    }

    try {
      if (finalMode === "end") {
        await endIncidentOnServer();
      } else {
        await leaveIncidentOnServer();
      }
    } catch (e) {
      warn("end/leave server call failed (ignored):", e?.message || e);
    }

    emit("ended", { mode: finalMode, reason });
    hardReset(`ended_${finalMode}_${reason}`);
    return true;
  }

  // ---------------------------
  // Public control
  // ---------------------------
  function enable(opts = {}) {
    S.apiBase = opts.apiBase || S.apiBase;
    S.enabled = true;

    healActiveFlagFromSession();

    const sess = loadSession();
    if (sess?.token && sess?.incident_id) {
      S.apiBase     = sess.apiBase || S.apiBase;
      S.incident_id = sess.incident_id;
      S.join_code   = sess.join_code || null;
      S.client_id   = sess.client_id || null;
      S.role        = sess.role || null;
      S.token       = sess.token;
      S.since       = sess.since || "";

      setActiveFlag(true);
      emit("restored", { session: sess });
      log("restored", { incident_id: S.incident_id, role: S.role });
    } else {
      setActiveFlag(false);
      emit("need_join", {});
    }

    start();
    return true;
  }

  async function resume() {
    const sess = loadSession();
    if (!sess?.incident_id || !sess?.token) return false;

    S.apiBase     = sess.apiBase || S.apiBase;
    S.incident_id = sess.incident_id;
    S.join_code   = sess.join_code || null;
    S.client_id   = sess.client_id || null;
    S.role        = sess.role || null;
    S.token       = sess.token;
    S.since       = sess.since || "";

    S.enabled = true;
    setActiveFlag(true);

    emit("restored", { session: sess });
    start();
    log("resumed", { incident_id: S.incident_id, role: S.role });
    return true;
  }

  function disable() {
    S.enabled = false;
    stop();
    emit("disabled", {});
    broadcastStatus();
  }

  function reset() {
    hardReset("user_reset");
  }

  async function toggle(opts = {}) {
    const st = statusSnapshot();

    if (st.active || st.enabled) {
      return end({ mode: opts.mode || "auto", reason: opts.reason || "toggle_off" });
    }

    if (hasSession()) {
      return resume();
    }

    emit("need_join", {});
    return false;
  }

  function getStatus() {
    return statusSnapshot();
  }

  window.Coop = {
    enable,
    resume,
    disable,
    reset,
    hardReset,
    toggle,
    end,
    createIncident,
    joinIncident,
    patchPatient,
    pullState,
    getState: () => ({ ...S, active: statusSnapshot().active }),
    getStatus,
  };

  // ---------------------------
  // Auto-Resume on load/visible
  // ---------------------------
  function autoResume() {
    healActiveFlagFromSession();

    if (isActiveFlag() && !hasSession()) {
      setActiveFlag(false);
      emit("need_join", {});
    }

    if (hasSession()) {
      resume().catch((e) => {
        hardReset(`resume_fail_${e?.message || "unknown"}`);
        emit("need_join", {});
      });
    } else {
      broadcastStatus();
    }
  }

  window.addEventListener("load", autoResume);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") autoResume();
  });

})();

