// /coop.js (ROOT) — stable session + resume + lock + only end by reset/end/expiry
(() => {
  "use strict";

  const DEFAULTS = {
    apiBase: "https://www.1rettungsmittel.de/api/coop_test",
    pollMs: 1500,
    heartbeatMs: 8000,
    storageKey: "coop_session_v1",
    sinceSkewSeconds: 2,

    // simple UI flag
    lsActive: "coop.active",

    // Lock (damit nicht mehrere Tabs/HomeScreens gleichzeitig pollen)
    lockKey: "coop.lock.v1",
    lockTtlMs: 12_000, // alle 12s erneuern

    // optional: Session expiry (damit uralte Sessions nicht ewig leben)
    // 0 = deaktiviert
    sessionTtlMs: 24 * 60 * 60 * 1000, // 24h
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

    timers: { poll: null, hb: null, lock: null },
  };

  // -------- helpers --------
  const log  = (...a) => console.log("[COOP]", ...a);
  const warn = (...a) => console.warn("[COOP]", ...a);
  const emit = (name, detail = {}) => {
    window.dispatchEvent(new CustomEvent(`coop:${name}`, { detail }));
  };

  // -------- device id (stable) --------
  function getDeviceId() {
    try {
      const KEY = "COOP_DEVICE_ID_V1";
      let id = localStorage.getItem(KEY);
      if (!id) {
        id = (crypto.randomUUID ? crypto.randomUUID() : (Date.now() + "-" + Math.random()))
          .toString()
          .replace(/[^a-z0-9\-]/gi, "");
        localStorage.setItem(KEY, id);
      }
      return id;
    } catch {
      return "web-" + Date.now();
    }
  }
  const DEVICE_ID = getDeviceId();

  // -------- active flag --------
  function setActiveFlag(on) {
    try { localStorage.setItem(DEFAULTS.lsActive, on ? "1" : "0"); } catch {}
  }
  function isActiveFlag() {
    try { return localStorage.getItem(DEFAULTS.lsActive) === "1"; } catch { return false; }
  }

  // -------- session storage --------
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

  function isSessionExpired(sess) {
    if (!sess || !DEFAULTS.sessionTtlMs) return false;
    const t = Number(sess.t || 0);
    if (!t) return false;
    return (Date.now() - t) > DEFAULTS.sessionTtlMs;
  }

  // -------- fetch helpers --------
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

  // -------- lock (single poller) --------
  function readLock() {
    try { return JSON.parse(localStorage.getItem(DEFAULTS.lockKey) || "null"); } catch { return null; }
  }
  function writeLock(v) {
    try { localStorage.setItem(DEFAULTS.lockKey, JSON.stringify(v)); } catch {}
  }
  function clearLock() {
    try { localStorage.removeItem(DEFAULTS.lockKey); } catch {}
  }

  function claimLock() {
    const now = Date.now();
    const cur = readLock();
    const expired = !cur || !cur.until || now > cur.until;

    // Wenn Lock frei/abgelaufen oder bereits von mir -> ich nehme ihn
    if (expired || cur.owner === DEVICE_ID) {
      writeLock({ owner: DEVICE_ID, until: now + DEFAULTS.lockTtlMs });
      return true;
    }
    return false;
  }

  function startLockHeartbeat() {
    stopLockHeartbeat();
    // Sofort versuchen
    claimLock();
    S.timers.lock = setInterval(() => {
      claimLock();
    }, Math.max(3000, DEFAULTS.lockTtlMs - 3000));
  }

  function stopLockHeartbeat() {
    if (S.timers.lock) clearInterval(S.timers.lock);
    S.timers.lock = null;
  }

  function iAmLockOwner() {
    const cur = readLock();
    if (!cur) return false;
    if (cur.owner !== DEVICE_ID) return false;
    if (Date.now() > Number(cur.until || 0)) return false;
    return true;
  }

  // -------- API --------
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

    saveSession();
    setActiveFlag(true);

    emit("created", data);
    log("created", data);
    start(); // startet poll/heartbeat (mit lock check)
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

    saveSession();
    setActiveFlag(true);

    emit("joined", data);
    log("joined", data);
    start(); // startet poll/heartbeat (mit lock check)
    return data;
  }

  async function ping() {
    if (!S.incident_id || !S.token) return;
    try {
      const url = `${S.apiBase}/ping.php`;
      await fetchJSON(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ incident_id: S.incident_id, token: S.token })
      });
      emit("heartbeat", { ok: true });
    } catch (e) {
      emit("heartbeat", { ok: false, error: e.message });
    }
  }

  async function pullState() {
    if (!S.enabled || !S.incident_id || !S.token) return;

    // WICHTIG: nur Lock-Owner pollt (sonst doppelte Calls / Stress)
    if (!iAmLockOwner()) return;

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
      // wenn unauthorized -> Session nicht automatisch killen (du wolltest nur per Klick beenden)
      emit("poll_error", { error: e.message });
      warn("pullState fail:", e.message);
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

    const data = await fetchJSON(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    emit("patched", { patient_id, patch, version: data.version });
    return data;
  }

  // -------- timers --------
  function start() {
    // immer enabled setzen, aber polling nur wenn lock owner
    S.enabled = true;

    stop(); // stop poll/hb (nicht lock)
    startLockHeartbeat();

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

  // -------- public control --------
  function enable(opts = {}) {
    S.apiBase = opts.apiBase || S.apiBase;
    S.enabled = true;

    const sess = loadSession();

    // Wenn Session existiert -> automatisch "active"
    if (sess?.token && sess?.incident_id && !isSessionExpired(sess)) {
      setActiveFlag(true);
      return resume(); // zieht aus Session und startet timer
    }

    // abgelaufen -> nur wenn du es willst: löschen
    if (sess && isSessionExpired(sess)) {
      warn("stored session expired -> cleared");
      clearSession();
      setActiveFlag(false);
    }

    emit("need_join", {});
    // NICHT start() (weil ohne session sinnlos)
    return false;
  }

  async function resume({ incident_id, token, role } = {}) {
    const sess = loadSession();

    if (sess && isSessionExpired(sess)) {
      warn("resume: session expired -> cleared");
      clearSession();
      setActiveFlag(false);
      emit("need_join", {});
      return false;
    }

    S.apiBase     = sess?.apiBase || S.apiBase;
    S.incident_id = incident_id || sess?.incident_id || S.incident_id;
    S.token       = token       || sess?.token       || S.token;
    S.role        = role        || sess?.role        || S.role;
    S.join_code   = sess?.join_code || S.join_code;
    S.client_id   = sess?.client_id || S.client_id;
    S.since       = sess?.since || S.since;

    if (!S.incident_id || !S.token) {
      emit("need_join", {});
      return false;
    }

    // Session existiert => active=true
    setActiveFlag(true);

    emit("restored", { session: loadSession() });
    start();
    log("resumed", { incident_id: S.incident_id, role: S.role, lockOwner: iAmLockOwner() });
    return true;
  }

  function disable() {
    // disable heißt: coop engine anhalten, aber Session NICHT löschen
    S.enabled = false;
    stop();
    stopLockHeartbeat();
    emit("disabled", {});
  }

  function end() {
    // "Einsatz beenden" -> Session bleibt optional, aber active aus + stop
    // wenn du wirklich komplett raus willst: reset() benutzen
    setActiveFlag(false);
    disable();
    emit("ended", {});
  }

  function reset() {
    // HARTE Beendigung (nur durch Klick)
    disable();
    clearSession();
    setActiveFlag(false);
    clearLock();

    S.incident_id = null;
    S.join_code = null;
    S.client_id = null;
    S.role = null;
    S.token = null;
    S.since = "";
    S.lastVersion.clear();

    emit("reset", {});
    log("reset");
  }

  // -------- expose --------
  window.Coop = {
    enable,
    resume,
    disable,
    end,     // ✅ optional
    reset,   // ✅ harte Beendigung

    createIncident,
    joinIncident,
    patchPatient,

    pullState,
    getState: () => ({
      ...S,
      activeFlag: isActiveFlag(),
      deviceId: DEVICE_ID,
      lock: readLock()
    }),
  };

  // -------- auto-resume --------
  function autoResume() {
    const sess = loadSession();

    // Wenn Session existiert, aber activeFlag fehlt -> activeFlag automatisch setzen
    if (sess?.token && sess?.incident_id && !isSessionExpired(sess) && !isActiveFlag()) {
      setActiveFlag(true);
    }

    // Nur wenn activeFlag true -> resume
    if (isActiveFlag() && sess?.token && sess?.incident_id && !isSessionExpired(sess)) {
      resume().catch(() => {});
    }
  }

  window.addEventListener("load", autoResume);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") autoResume();
  });

})();
