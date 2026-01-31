// /coop-bridge-ablage.js  (v2: robust active-check + poll loop)
// Zweck: Holt Coop-Änderungen regelmäßig vom Server (über coop.js pullState/poll)
//        und feuert "coop:changes", damit script.js / SKWriter das in localStorage/Ablage schreibt.

(function () {
  'use strict';

  const VER = 'coop-bridge-ablage-v2';
  if (window.__COOP_BRIDGE_VER__ === VER) return;
  window.__COOP_BRIDGE_VER__ = VER;

  const DEBUG = false;
  const log  = (...a) => DEBUG && console.log('[COOP-BRIDGE]', ...a);
  const warn = (...a) => console.warn('[COOP-BRIDGE]', ...a);

  function isCoopActive() {
    try {
      if (window.Coop && typeof window.Coop.getStatus === 'function') {
        const st = window.Coop.getStatus();
        return !!st?.active;
      }
      const s = JSON.parse(localStorage.getItem('coop_session_v1') || 'null');
      return !!(s && s.token && s.incident_id);
    } catch {
      return false;
    }
  }

  async function doPoll(){
    if (!window.Coop) return null;

    // 1) Falls eine poll()-Methode existiert (ältere/andere Clients)
    if (typeof window.Coop.poll === 'function') {
      try { return await window.Coop.poll(); }
      catch (e) { warn('poll failed', e); return null; }
    }

    // 2) coop.js: nutzt pullState() und feuert coop:changes selbst
    if (typeof window.Coop.pullState === 'function') {
      try { await window.Coop.pullState(); return null; }
      catch (e) { warn('pullState failed', e); return null; }
    }

    return null;
  }

  function fireChanges(changes){
    try {
      window.dispatchEvent(new CustomEvent('coop:changes', { detail: { changes } }));
      log('dispatched coop:changes', changes);
    } catch (e) {
      warn('dispatch failed', e);
    }
  }

  // Poll-Loop
  let timer = null;

  async function tick(){
    try{
      if (!isCoopActive()){
        schedule(1500);
        return;
      }

      const out = await doPoll();

      // Wenn poll() Daten liefert: entweder Array oder {changes:[...]}
      const changes = Array.isArray(out) ? out : (out && Array.isArray(out.changes) ? out.changes : []);
      if (changes && changes.length) fireChanges(changes);

      schedule(900);
    }catch(e){
      warn('tick failed', e);
      schedule(1500);
    }
  }

  function schedule(ms){
    clearTimeout(timer);
    timer = setTimeout(tick, ms);
  }

  // Start
  schedule(800);

  // Optional: bei Sichtbarkeit schneller prüfen
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') schedule(200);
  });
})();
