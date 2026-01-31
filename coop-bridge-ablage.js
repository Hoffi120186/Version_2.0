// /coop-bridge-ablage.js  (v2: robust active-check + poll loop)
// Zweck: Holt Coop-Änderungen regelmäßig vom Server (über coop.js poll)
//        und feuert "coop:changes", damit script.js / SKWriter das in localStorage/Ablage schreibt.

(function () {
  'use strict';

  const VER = 'coop-bridge-ablage-v2';
  if (window.__COOP_BRIDGE_VER__ === VER) return;
  window.__COOP_BRIDGE_VER__ = VER;

  const DEBUG = true;

  function log(...a){ if (DEBUG) console.log('[COOP-BRIDGE]', ...a); }
  function warn(...a){ console.warn('[COOP-BRIDGE]', ...a); }

  function getSession(){
    try { return JSON.parse(localStorage.getItem('coop_session_v1') || 'null'); }
    catch { return null; }
  }

  function isCoopActive(){
    try {
      if (window.Coop && typeof window.Coop.getStatus === 'function') {
        const st = window.Coop.getStatus();
        return !!(st && st.active && st.incident_id && st.token);
      }
    } catch {}

    // fallback: session vorhanden
    const s = getSession();
    return !!(s && s.incident_id && s.token);
  }

  async function doPoll(){
    if (!window.Coop || typeof window.Coop.poll !== 'function') {
      // coop.js noch nicht da oder ohne poll
      return null;
    }
    try {
      const res = await window.Coop.poll();
      return res || null;
    } catch (e) {
      warn('poll failed', e);
      return null;
    }
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
    if (!isCoopActive()) return;

    const out = await doPoll();

    // coop.js kann entweder {changes:[...]} zurückgeben oder direkt array
    const changes = Array.isArray(out) ? out : (out && Array.isArray(out.changes) ? out.changes : []);

    if (changes && changes.length) fireChanges(changes);
  }

  function start(){
    if (timer) return;
    log('start');
    timer = setInterval(tick, 1500); // 1.5s reicht
    tick();
  }

  function stop(){
    if (!timer) return;
    clearInterval(timer);
    timer = null;
    log('stop');
  }

  // automatisch starten wenn coop aktiv ist
  window.addEventListener('load', start);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') start();
  });
  window.addEventListener('online', start);

  // falls coop.js Events feuert, sofort starten
  window.addEventListener('coop:created', start);
  window.addEventListener('coop:joined', start);
  window.addEventListener('coop:restored', start);

  // bei reset/ended stoppen
  window.addEventListener('coop:reset', stop);
  window.addEventListener('coop:ended', stop);
  window.addEventListener('coop:disabled', stop);

  start();
})();
