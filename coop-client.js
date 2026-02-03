// /coop-client.js  (NEW COOP v1)
(function(){
  'use strict';

  const KEY = 'coop_session_v1';
  const EVT = 'coop:changed';

  function loadSession(){
    try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
  }
  function saveSession(s){
    try { localStorage.setItem(KEY, JSON.stringify(s||null)); } catch {}
  }
  function clearSession(){
    try { localStorage.removeItem(KEY); } catch {}
  }
  function isActive(){
    const s = loadSession();
    return !!(s && s.baseUrl && s.incident_id && s.token);
  }

  async function api(path, opts){
    const s = loadSession();
    if(!s) throw new Error('no_session');
    const url = String(s.baseUrl).replace(/\/$/,'') + path;
    const o = Object.assign({ headers:{} }, opts||{});
    o.headers['Content-Type'] = 'application/json';
    o.headers['X-Coop-Incident'] = s.incident_id;
    o.headers['X-Coop-Token'] = s.token;
    const res = await fetch(url, o);
    const data = await res.json().catch(()=>null);
    if(!res.ok) throw new Error(data?.error || ('http_'+res.status));
    return data;
  }

  async function sendEvent(type, payload){
    if(!isActive()) return { ok:false, skipped:true };
    return api('/incident/event', { method:'POST', body: JSON.stringify({ type, payload }) });
  }

  async function getState(since){
    if(!isActive()) return null;
    const s = loadSession();
    const qs = new URLSearchParams({ incident_id:s.incident_id, since:String(since||0) });
    const url = String(s.baseUrl).replace(/\/$/,'') + '/incident/state?' + qs.toString();
    const res = await fetch(url, { headers: { 'X-Coop-Token': s.token } });
    const data = await res.json().catch(()=>null);
    if(!res.ok) return null;
    return data;
  }

  function emitChanged(){
    try { window.dispatchEvent(new Event(EVT)); } catch {}
  }

  window.Coop = {
    KEY, EVT,
    loadSession, saveSession, clearSession,
    isActive,
    sendEvent,
    getState,
    emitChanged
  };
})();
