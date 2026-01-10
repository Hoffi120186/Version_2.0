// /js/coop/coop.js
(() => {
  "use strict";

  const DEFAULTS = {
    apiBase: "https://www.1rettungsmittel.de/api/coop_test",
    pollMs: 1500,
    heartbeatMs: 8000,
    storageKey: "coop_session_v1",
    sinceSkewSeconds: 2, // safety window for "updated_at > since"
  };

  const S = {
    enabled: false,
    apiBase: DEFAULTS.apiBase,

    incident_id: null,
    join_code: null, // optional (nice to have)
    client_id: null,
    role: null,
    token: null,

    // pull cursor
    since: "", // 'YYYY-mm-dd HH:ii:ss'
    lastVersion: new Map(), // patient_id -> version

    timers: { poll: null, hb: null },
  };

  function log(...a) { console.log("[COOP]", ...a); }
  function warn(...a) { console.warn("[COOP]", ...a); }
  function emit(name, detail = {}) {
    window.dispatchEvent(new CustomEvent(`coop:${name}`, { detail }));
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
      t: Date.now()
    };
    localStorage.setItem(DEFAULTS.storageKey, JSON.stringify(payload));
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
    localStorage.removeItem(DEFAULTS.storageKey);
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

  // ---- API Wrappers (match your backend) ----

  async function createIncident(payload = {}) {
    // expected endpoint: create_incident.php
    const url = `${S.apiBase}/create_incident.php`;
    const data = await fetchJSON(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    // should contain: incident_id, join_code, token, client_id, role (OrgL)
    // if your API returns slightly different fields, we can map.
    S.incident_id = data.incident_id || S.incident_id;
    S.join_code = data.join_code || S.join_code;
    S.token = data.token || S.token;
    S.client_id = data.client_id || S.client_id;
    S.role = data.role || "ORGL";
    S.since = ""; // reset cursor
    S.lastVersion.clear();
    saveSession();
    emit("created", data);
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
    S.client_id = data.client_id;
    S.role = data.role;
    S.token = data.token;
    S.join_code = join_code;

    S.since = "";
    S.lastVersion.clear();
    saveSession();
    emit("joined", data);
    log("joined", data);
    return data;
  }

  async function ping() {
    // optional; use if your ping.php requires token+incident_id
    try {
      const url = `${S.apiBase}/ping.php`;
      // Many implementations: POST {incident_id, token}
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

  function subtractSecondsFromDatetimeString(dt, seconds) {
    // dt: 'YYYY-mm-dd HH:ii:ss'
    // parse manually to avoid timezone issues; treat as local
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
      return dt; // fallback
    }
  }

  async function pullState() {
    if (!S.enabled || !S.incident_id || !S.token) return;

    // Safety-window to prevent missing same-second updates
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

      const serverTime = data.server_time; // 'YYYY-mm-dd HH:ii:ss'
      const changes = Array.isArray(data.changes) ? data.changes : [];

      // Dedupe by patient_id + version
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

      // advance cursor to server_time (not last row time), so clock is consistent
      if (typeof serverTime === "string" && serverTime.length >= 19) {
        S.since = serverTime;
      }

      saveSession();

      if (filtered.length) {
        emit("changes", { changes: filtered, server_time: serverTime });
      }
    } catch (e) {
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

  function start() {
    stop();
    S.timers.poll = setInterval(pullState, DEFAULTS.pollMs);
    S.timers.hb = setInterval(ping, DEFAULTS.heartbeatMs);
    pullState();
    ping();
  }

  function stop() {
    if (S.timers.poll) clearInterval(S.timers.poll);
    if (S.timers.hb) clearInterval(S.timers.hb);
    S.timers.poll = null;
    S.timers.hb = null;
  }

  function enable(opts = {}) {
    S.apiBase = opts.apiBase || S.apiBase;
    S.enabled = true;

    // restore if possible
    const sess = loadSession();
    if (sess?.token && sess?.incident_id) {
      S.apiBase = sess.apiBase || S.apiBase;
      S.incident_id = sess.incident_id;
      S.join_code = sess.join_code || null;
      S.client_id = sess.client_id || null;
      S.role = sess.role || null;
      S.token = sess.token;
      S.since = sess.since || "";
      emit("restored", { session: sess });
    } else {
      emit("need_join", {});
    }

    start();
    return true;
  }

  function disable() {
    S.enabled = false;
    stop();
    emit("disabled", {});
  }

  function reset() {
    disable();
    clearSession();
    S.incident_id = null;
    S.join_code = null;
    S.client_id = null;
    S.role = null;
    S.token = null;
    S.since = "";
    S.lastVersion.clear();
    emit("reset", {});
  }

  window.Coop = {
    enable,
    disable,
    reset,

    createIncident,
    joinIncident,
    patchPatient,

    pullState, // optional manual trigger
    getState: () => ({ ...S }),
  };

})();
(function(){
  const LS = localStorage;

  function getState(){
    try{
      return {
        active: LS.getItem("coop.active") === "1",
        incident_id: LS.getItem("coop.incident_id") || "",
        token: LS.getItem("coop.token") || "",
        role: LS.getItem("coop.role") || ""
      };
    }catch{
      return { active:false, incident_id:"", token:"", role:"" };
    }
  }

  async function resumeIfNeeded(){
    const st = getState();
    if (!st.active || !st.incident_id || !st.token) return;

    // wichtig: NICHT neu erstellen, nur reconnect/poll starten
    console.log("[COOP] resume from localStorage", st);

    try{
      // falls du eine Coop-Instanz / API hast:
      if (window.Coop && typeof window.Coop.resume === "function") {
        await window.Coop.resume({
          incident_id: st.incident_id,
          token: st.token,
          role: st.role
        });
      } else {
        console.warn("[COOP] window.Coop.resume fehlt – coop.js API nicht geladen?");
      }
    }catch(e){
      console.error("[COOP] resume failed", e);
    }
  }

  // beim Laden & wenn Tab wieder sichtbar wird
  window.addEventListener("load", resumeIfNeeded);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") resumeIfNeeded();
  });
})();

