// /coop.js (ROOT) — FINAL: robust start/stop + toggle button + hard reset + auto-end handling
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
    // ✅ IMPORTANT: ensure coop actually runs even if UI never called enable()
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
    // ✅ IMPORTANT: ensure coop actually runs even if UI never called enable()
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
      const url = `${S.apiBase}/ping.php`;
      await fetchJSON(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ incident_id: S.incident_id, token: S.token }),
      });

      S.hbErrStreak = 0;
      emit("heartbeat", { ok: true });
    } catch (e) {
      const msg = e?.message || "heartbeat_error";
      S.hbErrStreak++;

      emit("heartbeat", { ok: false, error: msg });
      warn("heartbeat fail:", msg);

      if (isInvalidSessionError(msg) || S.hbErrStreak >= DEFAULTS.maxConsecutiveHbErrors) {
        // ✅ incident ended / invalid -> end locally clean
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

      // ✅ Optional: if your backend returns ended flags
      if (data?.ended === true || data?.status === "ended" || data?.status === "closed") {
        emit("ended", { reason: "server_flag" });
        hardReset("server_flag_ended");
        emit("need_join", {});
        return;
      }

      const serverTime = data.server_time;
      const changes = Array.isArray(data.changes) ? data.changes : [];

      // ✅ Optional: handle "exercise end" via a change row
      // If one row indicates end, we stop everything
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
  // End/Leave handling (Übungsende / Coop beenden)
  // ---------------------------
  async function endIncidentOnServer() {
    // If your backend supports it, this ends the whole incident for everyone.
    // If not available (404 etc.), we still end locally.
    const url = `${S.apiBase}/end_incident.php`;
    return fetchJSON(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ incident_id: S.incident_id, token: S.token }),
    });
  }

  async function leaveIncidentOnServer() {
    // Optional: if your backend supports leaving a session without ending it.
    const url = `${S.apiBase}/leave_incident.php`;
    return fetchJSON(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ incident_id: S.incident_id, token: S.token, client_id: S.client_id }),
    });
  }

  /**
   * End/Leave coop
   * @param {Object} opts
   * @param {"auto"|"leave"|"end"} opts.mode
   *    - auto: if role ORGL => end, else leave
   *    - end: try to end whole incident
   *    - leave: only leave locally (and optional server leave)
   * @param {string} opts.reason
   */
  async function end(opts = {}) {
    const mode = opts.mode || "auto";
    const reason = opts.reason || "user_action";

    const role = (S.role || loadSession()?.role || "").toUpperCase();
    const isOrgL = role === "ORGL" || role === "ORG L" || role === "ORG-L";

    const finalMode = (mode === "auto")
      ? (isOrgL ? "end" : "leave")
      : mode;

    emit("ending", { mode: finalMode, reason });

    // If no session, just reset
    if (!S.incident_id || !S.token) {
      hardReset(`end_no_session_${reason}`);
      emit("ended", { mode: finalMode, reason });
      return true;
    }

    // Try server-side if available, but ALWAYS ensure local clean finish
    try {
      if (finalMode === "end") {
        await endIncidentOnServer();
      } else {
        await leaveIncidentOnServer();
      }
    } catch (e) {
      // If endpoint not there / fails -> ignore, still end locally
      warn("end/leave server call failed (ignored):", e?.message || e);
    }

    // local final
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

  // "Coop beenden" button should call end() (not just reset)
  function reset() {
    // keep backwards compatibility: do a safe local reset
    hardReset("user_reset");
  }

  // ✅ Toggle helper for ONE button UX
  // If active -> end/leave. If not active -> emit need_join (or resume if session exists)
  async function toggle(opts = {}) {
    const st = statusSnapshot();

    // if already active -> end/leave
    if (st.active || st.enabled) {
      return end({ mode: opts.mode || "auto", reason: opts.reason || "toggle_off" });
    }

    // if we have a stored session -> resume
    if (hasSession()) {
      return resume();
    }

    // otherwise UI must show join/create modal
    emit("need_join", {});
    return false;
  }

  function getStatus() {
    return statusSnapshot();
  }

  window.Coop = {
    // core lifecycle
    enable,
    resume,
    disable,
    reset,
    hardReset,

    // toggle & end
    toggle,
    end, // end({mode:"auto"|"end"|"leave", reason:"..."})

    // api
    createIncident,
    joinIncident,
    patchPatient,
    pullState,

    // state
    getState: () => ({ ...S, active: statusSnapshot().active }),
    getStatus,
  };

  // ---------------------------
  // Auto-Resume on load/visible
  // ---------------------------
  function autoResume() {
    healActiveFlagFromSession();

    // if only UI flag but NO session -> fix lie
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
