/* =========================================================
   coop-client.js (v1) — simple coop client for IONOS PHP API
   - Session: localStorage "coop_session_v1"
   - Endpoints expected:
     POST  {apiBase}/create_incident.php
     POST  {apiBase}/join_incident.php
     GET   {apiBase}/state.php?incident_id=..&token=..&since=..
     POST  {apiBase}/patch_patient.php   (JSON)
     POST  {apiBase}/end_incident.php    (optional; if missing -> reset local)
     POST  {apiBase}/leave_incident.php  (optional; if missing -> reset local)
   - Emits events:
     coop:created, coop:joined, coop:restored, coop:changes, coop:ended, coop:reset, coop:status
   ========================================================= */
(function(){
  'use strict';

  const VER = 'coop-client-v1-2026-01-31';
  if (window.Coop && window.Coop.__ver === VER) return;

  const LS_KEY = 'coop_session_v1';

  let apiBase = '';
  let pollTimer = 0;
  let isPolling = false;
  let lastSince = ''; // "YYYY-mm-dd HH:ii:ss"
  let lastTickAt = 0;

  function now(){ return Date.now(); }

  function safeParse(s, fallback){
    try{ return JSON.parse(s); }catch{ return fallback; }
  }
  function loadSession(){
    return safeParse(localStorage.getItem(LS_KEY) || 'null', null);
  }
  function saveSession(s){
    try{ localStorage.setItem(LS_KEY, JSON.stringify(s)); }catch{}
  }
  function clearSession(){
    try{ localStorage.removeItem(LS_KEY); }catch{}
  }

  function emit(type, detail){
    try{
      window.dispatchEvent(new CustomEvent(type, { detail: detail || {} }));
    }catch(_){}
  }

  function getStatus(){
    const s = loadSession();
    const active = !!(s && s.incident_id && s.token);
    return {
      active,
      apiBase,
      incident_id: s?.incident_id || '',
      token: s?.token || '',
      join_code: s?.join_code || '',
      role: s?.role || '',
      last_since: s?.last_since || lastSince || '',
      last_poll_ms: s?.last_poll_ms || 0
    };
  }

  async function httpJSON(url, opts){
    const res = await fetch(url, opts);
    const data = await res.json().catch(()=>null);
    if (!res.ok || !data) {
      const msg = (data && (data.error || data.message)) ? (data.error || data.message) : ('HTTP ' + res.status);
      const e = new Error(msg);
      e.http = { status: res.status, data };
      throw e;
    }
    return data;
  }

  function enable({ apiBase: base }){
    apiBase = String(base || '').replace(/\/+$/,'');
    emit('coop:status', getStatus());
  }

  async function createIncident(payload){
    if (!apiBase) throw new Error('apiBase missing');
    const url = apiBase + '/create_incident.php';

    // dein PHP kann entweder JSON oder Formdata bekommen – wir senden JSON
    const data = await httpJSON(url, {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'Cache-Control':'no-store' },
      body: JSON.stringify(payload || {})
    });

    // Speichern was wir haben (join_code ist wichtig)
    const join_code = data.join_code || data.joinCode || data.code || '';
    const incident_id = data.incident_id || data.incidentId || '';
    const token = data.token || '';

    const s = loadSession() || {};
    const merged = {
      ...s,
      join_code: join_code || s.join_code || '',
      incident_id: incident_id || s.incident_id || '',
      token: token || s.token || '',
      role: s.role || ''
    };
    saveSession(merged);

    emit('coop:created', merged);
    emit('coop:status', getStatus());
    return data;
  }

  async function joinIncident({ join_code, role }){
    if (!apiBase) throw new Error('apiBase missing');
    const url = apiBase + '/join_incident.php';

    const body = { join_code:String(join_code||'').trim(), role:String(role||'').trim() };
    if (!body.join_code) throw new Error('join_code missing');

    const data = await httpJSON(url, {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'Cache-Control':'no-store' },
      body: JSON.stringify(body)
    });

    // erwartet: { ok:true, incident_id, token, role, join_code }
    const s = {
      join_code: data.join_code || body.join_code,
      incident_id: data.incident_id,
      token: data.token,
      role: data.role || body.role || '',
      last_since: '',
      last_poll_ms: 0
    };
    saveSession(s);
    lastSince = '';
    emit('coop:joined', s);
    emit('coop:status', getStatus());

    startPolling();
    return data;
  }

  async function resume(){
    const s = loadSession();
    if (!s || !s.incident_id || !s.token) return false;
    if (!apiBase) throw new Error('apiBase missing');

    lastSince = s.last_since || '';
    emit('coop:restored', s);
    emit('coop:status', getStatus());
    startPolling();
    return true;
  }

  function stopPolling(){
    isPolling = false;
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = 0;
  }

  function startPolling(){
    const st = getStatus();
    if (!st.active) return;
    if (pollTimer) return;

    isPolling = true;
    pollTimer = setInterval(pollOnceSafe, 1200);
    pollOnceSafe();
  }

  async function pollOnceSafe(){
    const st = getStatus();
    if (!st.active) { stopPolling(); return; }
    if (!apiBase) return;

    // nicht zu häufig, falls Tab im Hintergrund
    const t = now();
    if (t - lastTickAt < 900) return;
    lastTickAt = t;

    try{
      await pollOnce();
    }catch(e){
      // Bei kurzen Netzproblemen nicht gleich resetten
      console.warn('[COOP] poll error', e?.message || e);
    }
  }

  async function pollOnce(){
    const s = loadSession();
    if (!s) return;
    const qs = new URLSearchParams();
    qs.set('incident_id', s.incident_id);
    qs.set('token', s.token);
    if (lastSince) qs.set('since', lastSince);

    const url = apiBase + '/state.php?' + qs.toString();
    const data = await httpJSON(url, { method:'GET', headers:{ 'Cache-Control':'no-store' } });

    // state.php liefert: { ok:true, server_time, changes:[...]}
    const changes = Array.isArray(data.changes) ? data.changes : [];

    // server_time für since
    const server_time = data.server_time || '';
    if (server_time && /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}$/.test(server_time)) {
      lastSince = server_time;
    }

    // Session persistieren
    const next = loadSession() || s;
    next.last_since = lastSince || '';
    next.last_poll_ms = now();
    saveSession(next);

    // Änderungen weiterreichen
    if (changes.length){
      emit('coop:changes', { changes, server_time:lastSince });
    }
    emit('coop:status', getStatus());
  }

  async function patchPatient(patient_id, patch){
    const s = loadSession();
    if (!s || !s.incident_id || !s.token) throw new Error('not in coop session');
    if (!apiBase) throw new Error('apiBase missing');

    const pid = parseInt(patient_id, 10);
    if (!pid) throw new Error('bad patient_id');

    const body = {
      incident_id: s.incident_id,
      token: s.token,
      patient_id: pid,
      ...patch
    };

    const url = apiBase + '/patch_patient.php';
    const data = await httpJSON(url, {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'Cache-Control':'no-store' },
      body: JSON.stringify(body)
    });

    return data;
  }

  async function end({ reason }){
    const s = loadSession();
    if (!s) { reset(); return; }

    stopPolling();

    // optional endpoint
    try{
      if (apiBase) {
        const url = apiBase + '/end_incident.php';
        await fetch(url, {
          method:'POST',
          headers:{ 'Content-Type':'application/json', 'Cache-Control':'no-store' },
          body: JSON.stringify({ incident_id:s.incident_id, token:s.token, reason:String(reason||'') })
        }).catch(()=>null);
      }
    }catch(_){}

    clearSession();
    lastSince = '';
    emit('coop:ended', {});
    emit('coop:status', getStatus());
  }

  async function leave({ reason }){
    const s = loadSession();
    if (!s) { reset(); return; }

    stopPolling();

    // optional endpoint
    try{
      if (apiBase) {
        const url = apiBase + '/leave_incident.php';
        await fetch(url, {
          method:'POST',
          headers:{ 'Content-Type':'application/json', 'Cache-Control':'no-store' },
          body: JSON.stringify({ incident_id:s.incident_id, token:s.token, reason:String(reason||'') })
        }).catch(()=>null);
      }
    }catch(_){}

    clearSession();
    lastSince = '';
    emit('coop:reset', {});
    emit('coop:status', getStatus());
  }

  function reset(){
    stopPolling();
    clearSession();
    lastSince = '';
    emit('coop:reset', {});
    emit('coop:status', getStatus());
  }

  function hardReset(reason){
    console.warn('[COOP] hardReset', reason||'');
    reset();
  }

  // Auto: wenn Tab wieder sichtbar, polling anwerfen
  document.addEventListener('visibilitychange', ()=>{
    if (document.visibilityState === 'visible'){
      try{
        const st = getStatus();
        if (st.active) startPolling();
      }catch(_){}
    }
  });

  // Expose
  window.Coop = {
    __ver: VER,
    enable,
    getStatus,
    createIncident,
    joinIncident,
    resume,
    patchPatient,
    end,
    leave,
    reset,
    hardReset
  };

})();
