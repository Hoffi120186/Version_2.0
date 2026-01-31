// /coop-client.js (ROOT) — 2026-01-31-2
// robust session + start/stop + auto-resume + polling + emits coop:* events
(() => {
  "use strict";

  const DEFAULTS = {
    apiBase: "https://www.1rettungsmittel.de/api/coop_test",
    pollMs: 1500,
    heartbeatMs: 8000,
    storageKey: "coop_session_v1",
    sinceSkewSeconds: 2,
    maxConsecutivePollErrors: 6,
    maxConsecutiveHbErrors: 3,
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
    pollErrStreak: 0,
    hbErrStreak: 0,
  };

  function emit(name, detail = {}) {
    window.dispatchEvent(new CustomEvent(`coop:${name}`, { detail }));
  }

  function loadSession() {
    try { return JSON.parse(localStorage.getItem(DEFAULTS.storageKey) || "null"); }
    catch { return null; }
  }
  function saveSession(s) {
    try { localStorage.setItem(DEFAULTS.storageKey, JSON.stringify(s)); } catch {}
  }
  function clearSession() {
    try { localStorage.removeItem(DEFAULTS.storageKey); } catch {}
  }

  function isActive() {
    return !!(S.incident_id && S.token);
  }

  function getStatus() {
    return {
      active: isActive(),
      apiBase: S.apiBase,
      incident_id: S.incident_id,
      join_code: S.join_code,
      client_id: S.client_id,
      role: S.role,
      token: S.token,
      since: S.since,
    };
  }

  function setStateFromSession(sess) {
    S.incident_id = sess?.incident_id || null;
    S.join_code   = sess?.join_code || null;
    S.client_id   = sess?.client_id || null;
    S.role        = sess?.role || null;
    S.token       = sess?.token || null;
    S.since       = sess?.since || "";
  }

  function enable(opts = {}) {
    S.enabled = true;
    S.apiBase = (opts.apiBase || DEFAULTS.apiBase).replace(/\/$/, "");
    emit("status", getStatus());
  }

  function hardReset(reason = "hardReset") {
    stopLoops();
    S.enabled = false;
    S.apiBase = DEFAULTS.apiBase;
    S.incident_id = S.join_code = S.client_id = S.role = S.token = null;
    S.since = "";
    S.lastVersion.clear();
    clearSession();
    emit("reset", { reason });
    emit("status", getStatus());
  }

  async function postJSON(url, body) {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type":"application/json" },
      body: JSON.stringify(body || {}),
      cache: "no-store",
    });
    const j = await r.json().catch(() => null);
    if (!j || j.ok !== true) {
      const err = (j && j.error) ? j.error : `http_${r.status}`;
      throw new Error(err);
    }
    return j;
  }

  function isoSinceNowSkewed() {
    // kleine Skew, damit wir keine Events verpassen
    const d = new Date(Date.now() - DEFAULTS.sinceSkewSeconds * 1000);
    return d.toISOString().slice(0, 19).replace("T", " ");
  }

  async function createIncident({ expires_hours = 12 } = {}) {
    if (!S.enabled) enable({});
    const url = `${S.apiBase}/create_incident.php`;
    const j = await postJSON(url, { expires_hours });

    // server response
    S.incident_id = j.incident_id;
    S.join_code   = j.join_code;
    S.client_id   = j.client_id;
    S.role        = j.role;
    S.token       = j.token;

    S.since = isoSinceNowSkewed();
    saveSession(getStatus());
    startLoops();
    emit("created", getStatus());
    emit("status", getStatus());
    return j;
  }

  async function joinIncident({ join_code, role = "RTW", label = "" } = {}) {
    if (!S.enabled) enable({});
    const url = `${S.apiBase}/join_incident.php`;
    const j = await postJSON(url, { join_code, role, label });

    S.incident_id = j.incident_id;
    S.join_code   = j.join_code || join_code;
    S.client_id   = j.client_id;
    S.role        = j.role || role;
    S.token       = j.token;

    S.since = isoSinceNowSkewed();
    saveSession(getStatus());
    startLoops();
    emit("joined", getStatus());
    emit("status", getStatus());
    return j;
  }

  async function leave({ reason = "leave" } = {}) {
    if (!isActive()) { hardReset("leave_no_session"); return { ok:true }; }
    try {
      await postJSON(`${S.apiBase}/leave_incident.php`, {
        incident_id: S.incident_id,
        token: S.token,
        reason
      });
    } finally {
      hardReset("left");
      emit("disabled", { reason });
    }
    return { ok:true };
  }

  async function end({ reason = "end" } = {}) {
    if (!isActive()) { hardReset("end_no_session"); return { ok:true }; }
    try {
      await postJSON(`${S.apiBase}/end_incident.php`, {
        incident_id: S.incident_id,
        token: S.token,
        reason
      });
    } finally {
      hardReset("ended");
      emit("ended", { reason });
    }
    return { ok:true };
  }

  async function patchPatient(patient_id, patch) {
    if (!isActive()) throw new Error("coop_not_active");
    const pid = Number(patient_id);
    if (!pid) throw new Error("missing_patient_id");
    return postJSON(`${S.apiBase}/patch_patient.php`, {
      incident_id: S.incident_id,
      token: S.token,
      patient_id: pid,
      ...(patch || {}),
    });
  }

  async function pollChangesOnce() {
    if (!isActive()) return;

    const url = new URL(`${S.apiBase}/state.php`);
    url.searchParams.set("incident_id", S.incident_id);
    url.searchParams.set("token", S.token);
    if (S.since) url.searchParams.set("since", S.since);

    const r = await fetch(url.toString(), { cache:"no-store" });
    const j = await r.json().catch(() => null);
    if (!j || j.ok !== true) throw new Error((j && j.error) ? j.error : `http_${r.status}`);

    // server returns: changes[], server_time?, next_since?
    const changes = Array.isArray(j.changes) ? j.changes : [];
    if (j.next_since) S.since = j.next_since;
    else if (j.server_time) S.since = j.server_time;

    saveSession(getStatus());

    if (changes.length) emit("changes", { changes });
    emit("status", getStatus());
  }

  async function heartbeatOnce() {
    if (!isActive()) return;
    await postJSON(`${S.apiBase}/ping.php`, {
      incident_id: S.incident_id,
      token: S.token
    });
  }

  function stopLoops() {
    if (S.timers.poll) { clearInterval(S.timers.poll); S.timers.poll = null; }
    if (S.timers.hb)   { clearInterval(S.timers.hb);   S.timers.hb = null; }
    S.pollErrStreak = 0;
    S.hbErrStreak = 0;
  }

  function startLoops() {
    stopLoops();

    S.timers.poll = setInterval(async () => {
      try {
        await pollChangesOnce();
        S.pollErrStreak = 0;
      } catch (e) {
        S.pollErrStreak++;
        if (S.pollErrStreak >= DEFAULTS.maxConsecutivePollErrors) {
          // self-heal: stop polling, keep session
          stopLoops();
          emit("status", { ...getStatus(), poll_stopped:true, err:String(e?.message||e) });
        }
      }
    }, DEFAULTS.pollMs);

    S.timers.hb = setInterval(async () => {
      try {
        await heartbeatOnce();
        S.hbErrStreak = 0;
      } catch (e) {
        S.hbErrStreak++;
        if (S.hbErrStreak >= DEFAULTS.maxConsecutiveHbErrors) {
          stopLoops();
          emit("status", { ...getStatus(), hb_stopped:true, err:String(e?.message||e) });
        }
      }
    }, DEFAULTS.heartbeatMs);
  }

  async function resume() {
    const sess = loadSession();
    if (!sess?.incident_id || !sess?.token) return { ok:false, reason:"no_session" };
    if (!S.enabled) enable({ apiBase: sess.apiBase || DEFAULTS.apiBase });

    setStateFromSession(sess);
    if (!S.since) S.since = isoSinceNowSkewed();
    startLoops();
    emit("restored", getStatus());
    emit("status", getStatus());
    return { ok:true };
  }

  // expose
  window.Coop = {
    enable,
    resume,
    hardReset,
    getStatus,
    getState: getStatus,
    isActive,

    createIncident,
    joinIncident,

    leave,
    end,

    patchPatient,
  };
})();
