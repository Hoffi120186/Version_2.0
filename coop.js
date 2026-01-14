// /coop.js (ROOT) — robust session truth + auto-resume + UI-safe status + HARD RESET + auto-heal
(() => {
  "use strict";

  const DEFAULTS = {
    apiBase: "https://www.1rettungsmittel.de/api/coop_test",
    pollMs: 1500,
    heartbeatMs: 8000,
    storageKey: "coop_session_v1",

    // UI flag (nice-to-have, but NOT source of truth)
    lsActive: "coop.active",

    sinceSkewSeconds: 2,

    // ✅ if we get repeated errors, we self-heal/reset
    maxConsecutiveErrors: 6,          // ~9s at 1500ms polling
    maxConsecutiveHbErrors: 3,        // ~24s at 8000ms heartbeat
  };

  const S = {
    enabled: false,
    apiBase: DEFAULTS.apiBase,

    incident_id: null,
    join_code: null,
    client_id: null,
    role: null,
    token: null,

    since: "",
    lastVersion: new Map(),

    timers: { poll: null, hb: null },

    // ✅ error counters for self-heal
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
      t: Date.now()
    };
    try { localStorage.setItem(DEFAULTS.storageKey, JSON.stringify(payload)); } catch {}
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
  }

  // UI flag: never trust it alone
  function setActiveFlag(on) {
    try { localStorage.setItem(DEFAULTS.lsActive, on ? "1" : "0"); } catch {}
  }
  function isActiveFlag() {
    try { return localStorage.getItem(DEFAULTS.lsActive) === "1"; } catch { return false; }
  }

  // ✅ The real truth:
  function hasSession() {
    const sess = loadSession();
    return !!(sess && sess.incident_id && sess.token);
  }

  // ✅ Self-heal: if session exists, force coop.active = 1
  function healActiveFlagFromSession() {
    if (hasSession()) setActiveFlag(true);
  }

  // ---------------------------
  // HARD RESET (kills zombie states)
  // ---------------------------
  function hardReset(reason = "manual") {
    warn("HARD RESET:", reason);

    // stop timers
    stop();

    // disable
    S.enabled = false;

    // clear RAM session
    S.incident_id = null;
    S.join_code = null;
    S.client_id = null;
    S.role = null;
    S.token = null;
    S.since = "";
    S.lastVersion.clear();

    // clear error streaks
    S.pollErrStreak = 0;
    S.hbErrStreak = 0;

    // clear storage
    clearSession();
    try { localStorage.removeItem(DEFAULTS.lsActive); } catch {}
    try { sessionStorage.clear(); } catch {}

    // update UI
    setActiveFlag(false);

    emit("reset", { reason });
  }

  // ---------------------------
  // Fetch helpers
  // ---------------------------
  async function fetchJSON(url, opts = {}) {
    const res = await fetch(url, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.ok === false) {
      const msg = data?.error || `HTTP_${res.status}`;
      throw new Error(msg);
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

  // ---------------------------
  // Error classification (important!)
  // ---------------------------
  function isInvalidSessionError(msg = "") {
    const m = String(msg || "").toLowerCase();
    // ✅ add more keywords if your backend uses different errors
    return (
      m.includes("invalid") ||
      m.includes("token") ||
      m.includes("unauthorized") ||
      m.includes("forbidden") ||
      m.includes("not_found") ||
      m.includes("incident") ||
      m.includes("expired") ||
      m.includes("missing_session")
    );
  }

  function requireValidRuntimeSessionOrReset(where = "unknown") {
    // If UI says active but we don't have incident/token -> zombie -> reset
    if (S.enabled && (!S.incident_id || !S.token)) {
      hardReset(`zombie_runtime_${where}`);
      emit("need_join", {});
      return false;
    }
    return true;
  }

  // ---------------------------
  // API
  // ---------------------------
  async function createIncident(payload = {}) {
    const url = `${S.apiBase}/create_incident.php`;
    const data = await fetchJSON(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
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

    // ensure timers run
    if (S.enabled) start();

    return data;
  }

  async function joinIncident({ join_code, role }) {
    const url = `${S.apiBase}/join_incident.php`;
    const data = await fetchJSON(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ join_code, role })
    });

    S.incident_id = data.incident_id;
    S.client_id   = data.client_id;
    S.role        = data.role;
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

    // ensure timers run
    if (S.enabled) start();

    return data;
  }

  async function ping() {
    if (!S.enabled) return;
    if (!requireValidRuntimeSessionOrReset("ping")) return;

    try {
      const url = `${S.apiBase}/ping.php`;
      await fetchJSON(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ incident_id: S.incident_id, token: S.token })
      });

      S.hbErrStreak = 0;
      emit("heartbeat", { ok: true });
    } catch (e) {
      const msg = e?.message || "heartbeat_error";
      S.hbErrStreak++;

      emit("heartbeat", { ok: false, error: msg });
      warn("heartbeat fail:", msg);

      if (isInvalidSessionError(msg) || S.hbErrStreak >= DEFAULTS.maxConsecutiveHbErrors) {
        hardReset(`heartbeat_invalid_${msg}`);
        emit("need_join", {});
      }
    }
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

  async function pullState() {
    if (!S.enabled) return;
    if (!requireValidRuntimeSessionOrReset("pullState")) return;

    const sinceSafe = S.since
      ? subtractSecondsFromDatetimeString(S.since, DEFAULTS.sinceSkewSeconds)
      : "";

    const url = `${S.apiBase}/state.php?` + qs({
      incident_id: S.incident_id,
      token: S.token,
      since: sinceSafe
    });

    try {
      const data = await fetchJSON(url);

      // success => reset streak
      S.pollErrStreak = 0;

      const serverTime = data.server_time;
      const changes = Array.isArray(data.changes) ? data.changes : [];

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
        emit("changes", { changes: filtered, server_time: serverTime });
      }
    } catch (e) {
      const msg = e?.message || "poll_error";
      S.pollErrStreak++;

      emit("poll_error", { error: msg });
      warn("pullState fail:", msg);

      // ✅ auto-reset on invalid session OR too many consecutive errors
      if (isInvalidSessionError(msg) || S.pollErrStreak >= DEFAULTS.maxConsecutiveErrors) {
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
      ...patch
    };

    try {
      const data = await fetchJSON(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });

      emit("patched", { patient_id, patch, version: data.version });
      return data;
    } catch (e) {
      const msg = e?.message || "patch_error";
      emit("patch_error", { patient_id, error: msg });

      // ✅ if token/incident invalid -> hard reset
      if (isInvalidSessionError(msg)) {
        hardReset(`patch_invalid_${msg}`);
        emit("need_join", {});
      }
      throw e;
    }
  }

  // ---------------------------
  // Timers
  // ---------------------------
  function start() {
    stop();

    // if enabled but no session => don't pretend
    if (S.enabled && (!S.incident_id || !S.token)) {
      emit("need_join", {});
      return;
    }

    S.timers.poll = setInterval(pullState, DEFAULTS.pollMs);
    S.timers.hb   = setInterval(ping, DEFAULTS.heartbeatMs);

    pullState();
    ping();
  }

  function stop() {
    if (S.timers.poll) clearInterval(S.timers.poll);
    if (S.timers.hb)   clearInterval(S.timers.hb);
    S.timers.poll = null;
    S.timers.hb   = null;
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

      // session exists -> active
      setActiveFlag(true);

      emit("restored", { session: sess });
      log("restored", { incident_id: S.incident_id, role: S.role });
    } else {
      // no session -> no fake active
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

    // ✅ session => always active
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
  }

  // Only ends on explicit user action (your "Coop beenden")
  function reset() {
    // keep semantics but make it HARD
    hardReset("user_reset");
  }

  // ✅ UI-friendly status (never lies)
  function getStatus() {
    const sess = loadSession();
    const sessOk = !!(sess?.incident_id && sess?.token);
    const runtimeOk = !!(S.incident_id && S.token);
    return {
      // active means: we truly have a session OR runtime session
      active: sessOk || runtimeOk,
      hasSession: sessOk,
      incident_id: sess?.incident_id || S.incident_id || "",
      join_code: sess?.join_code || S.join_code || "",
      role: sess?.role || S.role || "",
      enabled: !!S.enabled
    };
  }

  window.Coop = {
    enable,
    resume,
    disable,
    reset,
    hardReset, // ✅ expose for emergency button

    createIncident,
    joinIncident,
    patchPatient,

    pullState,
    getState: () => ({ ...S, active: hasSession() || (!!S.incident_id && !!S.token) }),
    getStatus,
  };

  // ---------------------------
  // Auto-Resume (every page load)
  // ---------------------------
  function autoResume() {
    healActiveFlagFromSession();

    // if we only have UI flag but NO session => fix the lie
    if (isActiveFlag() && !hasSession()) {
      setActiveFlag(false);
      emit("need_join", {});
    }

    if (hasSession()) {
      resume().catch((e) => {
        // if resume fails -> hard reset to avoid zombie UI
        hardReset(`resume_fail_${e?.message || "unknown"}`);
        emit("need_join", {});
      });
    }
  }

  window.addEventListener("load", autoResume);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") autoResume();
  });

})();
