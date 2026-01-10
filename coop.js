// /coop.js (ROOT) — stable session, persists across navigation, ends on explicit click OR app restart
(() => {
  "use strict";

  const DEFAULTS = {
    apiBase: "https://www.1rettungsmittel.de/api/coop_test",
    pollMs: 1500,
    heartbeatMs: 8000,
    sinceSkewSeconds: 2,

    storageKey: "coop_session_v1",
    lsActive: "coop.active",

    // Boot marker: sessionStorage is cleared on full app restart (iOS homescreen)
    ssBoot: "coop.boot.v1",
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
    _bootFresh: false,
  };

  // ---------------------------
  // Helpers
  // ---------------------------
  function log(...a) { console.log("[COOP]", ...a); }
  function warn(...a) { console.warn("[COOP]", ...a); }
  function emit(name, detail = {}) {
    window.dispatchEvent(new CustomEvent(`coop:${name}`, { detail }));
  }

  function setActiveFlag(on) {
    try { localStorage.setItem(DEFAULTS.lsActive, on ? "1" : "0"); } catch {}
  }
  function isActiveFlag() {
    try { return localStorage.getItem(DEFAULTS.lsActive) === "1"; } catch { return false; }
  }

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

  // Boot logic:
  // - if app was fully restarted, sessionStorage is empty → we consider coop "ended on restart"
  function ensureBootMarker() {
    try {
      const boot = sessionStorage.getItem(DEFAULTS.ssBoot);
      if (!boot) {
        sessionStorage.setItem(DEFAULTS.ssBoot, String(Date.now()));
        S._bootFresh = true; // new boot detected
      }
    } catch {
      // if sessionStorage not available, do nothing
    }
  }

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
  // API
  // ---------------------------
  async function createIncident(payload = {}) {
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

    saveSession();
    setActiveFlag(true);

    emit("created", data);
    emit("status", getStatus());
    log("created", data);
    start();
    return data;
  }

  async function joinIncident({ join_code, role }) {
    const url = `${S.apiBase}/join_incident.php`;
    const data = await fetchJSON(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ join_code, role }),
    });

    S.incident_id = (data.incident_id || "").trim();
    S.client_id   = (data.client_id || "").trim();
    S.role        = (data.role || role || "").trim();
    S.token       = (data.token || "").trim();
    S.join_code   = (join_code || "").trim();

    S.since = "";
    S.lastVersion.clear();

    saveSession();
    setActiveFlag(true);

    emit("joined", data);
    emit("status", getStatus());
    log("joined", data);
    start();
    return data;
  }

  async function ping() {
    if (!S.incident_id || !S.token) return;
    try {
      const url = `${S.apiBase}/ping.php`;
      await fetchJSON(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ incident_id: S.incident_id, token: S.token }),
      });
      emit("heartbeat", { ok: true });
    } catch (e) {
      emit("heartbeat", { ok: false, error: e.message });
    }
  }

  async function pullState() {
    if (!S.enabled || !isActiveFlag()) return;
    if (!S.incident_id || !S.token) return;

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
      // If backend says unauthorized, we STOP polling but DO NOT delete session automatically.
      // (User wants it to persist until explicit stop.)
      if (String(e.message).includes("unauthorized") || String(e.message).includes("403")) {
        emit("auth_error", { error: e.message });
        warn("pullState unauthorized -> stopped polling (session kept):", e.message);
        stop();
        return;
      }
      emit("poll_error", { error: e.message });
      warn("pullState fail:", e.message);
    }
  }

  async function patchPatient(patient_id, patch = {}) {
    if (!S.enabled) throw new Error("coop_not_enabled");
    if (!S.incident_id || !S.token) throw new Error("missing_session");

    const url = `${S.apiBase}/patch_patient.php`;
    const body = { incident_id: S.incident_id, token: S.token, patient_id, ...patch };

    const data = await fetchJSON(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    emit("patched", { patient_id, patch, version: data.version });
    return data;
  }

  // ---------------------------
  // Timers
  // ---------------------------
  function start() {
    stop();
    S.enabled = true;
    if (!isActiveFlag()) setActiveFlag(true);

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
  // Control
  // ---------------------------
  function enable(opts = {}) {
    S.apiBase = opts.apiBase || S.apiBase;
    S.enabled = true;

    const sess = loadSession();
    if (sess?.token && sess?.incident_id) {
      S.apiBase     = sess.apiBase || S.apiBase;
      S.incident_id = String(sess.incident_id || "").trim();
      S.join_code   = String(sess.join_code || "").trim() || null;
      S.client_id   = String(sess.client_id || "").trim() || null;
      S.role        = String(sess.role || "").trim() || null;
      S.token       = String(sess.token || "").trim();
      S.since       = String(sess.since || "");

      setActiveFlag(true);
      emit("restored", { session: sess });
      emit("status", getStatus());
      log("restored", { incident_id: S.incident_id, role: S.role });
      start();
      return true;
    }

    emit("need_join", {});
    emit("status", getStatus());
    return false;
  }

  async function resume() {
    const sess = loadSession();
    if (!sess?.token || !sess?.incident_id) return false;

    S.apiBase     = sess.apiBase || S.apiBase;
    S.incident_id = String(sess.incident_id || "").trim();
    S.join_code   = String(sess.join_code || "").trim() || null;
    S.client_id   = String(sess.client_id || "").trim() || null;
    S.role        = String(sess.role || "").trim() || null;
    S.token       = String(sess.token || "").trim();
    S.since       = String(sess.since || "");

    S.enabled = true;
    setActiveFlag(true);

    emit("restored", { session: sess });
    emit("status", getStatus());
    log("resumed", { incident_id: S.incident_id, role: S.role });

    start();
    return true;
  }

  function endSession() {
    // “Beenden” = nicht weiter pollen, Flag aus, Session bleibt optional (ich lasse sie da, falls du später "fortsetzen" willst)
    stop();
    S.enabled = false;
    setActiveFlag(false);
    emit("disabled", {});
    emit("status", getStatus());
  }

  function reset() {
    // Hard reset = alles weg
    stop();
    S.enabled = false;

    clearSession();
    setActiveFlag(false);

    S.incident_id = null;
    S.join_code   = null;
    S.client_id   = null;
    S.role        = null;
    S.token       = null;
    S.since       = "";
    S.lastVersion.clear();

    emit("reset", {});
    emit("status", getStatus());
  }

  function getStatus() {
    return {
      active: isActiveFlag(),
      enabled: !!S.enabled,
      incident_id: S.incident_id,
      join_code: S.join_code,
      role: S.role,
      hasSession: !!loadSession(),
    };
  }

  // ---------------------------
  // Auto behavior:
  // - If app restarted (fresh boot) => coop ends automatically (as you wanted)
  // - If NOT restarted and active flag true => resume on each page
  // ---------------------------
  function autoResume() {
    ensureBootMarker();

    // End on app restart:
    // When boot is fresh AND coop was active previously, we turn it off.
    if (S._bootFresh && isActiveFlag()) {
      // End on restart (your requirement)
      setActiveFlag(false);
      stop();
      S.enabled = false;
      emit("status", getStatus());
      log("boot detected -> coop ended on restart");
      return;
    }

    // Normal navigation: keep running if active+session exists
    const sess = loadSession();
    if (isActiveFlag() && sess?.token && sess?.incident_id) {
      resume().catch(() => {});
    } else {
      emit("status", getStatus());
    }
  }

  window.Coop = {
    enable,
    resume,
    endSession, // ✅ "beenden" ohne session löschen
    reset,      // ✅ hard reset

    createIncident,
    joinIncident,
    patchPatient,

    pullState,
    ping,

    getState: () => ({ ...S, activeFlag: isActiveFlag() }),
    getStatus,
    isActive: () => isActiveFlag() && !!loadSession(),
  };

  window.addEventListener("load", autoResume);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") autoResume();
  });

})();
