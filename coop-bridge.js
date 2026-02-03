// /coop-bridge.js (NEW COOP v1)  — Mirror server state into localStorage keys
(function(){
  'use strict';

  const POLL_MS = 900;          // schnell genug für "live", trotzdem stabil
  const MAP_KEY = 'sichtungMap';
  const DONE_KEY = 'ablage.done.v1';

  let lastRev = 0;
  let pollTimer = null;

  function Jparse(s,f){ try{return JSON.parse(s);}catch{return f;} }
  function Jget(k,f){ return Jparse(localStorage.getItem(k), f); }
  function Jset(k,v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch{} }

  function applyStateToLocal(state){
    if(!state) return;

    // 1) sichtungMap
    if(state.sichtungMap) Jset(MAP_KEY, state.sichtungMap);

    // 2) done (Ablage abgeschlossen) -> wird von ablage1.html weggefiltert
    if(Array.isArray(state.done)) Jset(DONE_KEY, state.done);

    // 3) T/B payloads als "sicht_patient12" etc.
    if(state.togglePayloads && typeof state.togglePayloads === 'object'){
      for(const [pid,payload] of Object.entries(state.togglePayloads)){
        try { localStorage.setItem('sicht_' + pid, JSON.stringify(payload)); } catch {}
      }
    }

    // UI informieren (ablage1 kann drauf reagieren)
    if (window.Coop?.emitChanged) window.Coop.emitChanged();
  }

  async function poll(){
    if(!window.Coop?.isActive?.()) return;
    const data = await window.Coop.getState(lastRev);
    if(!data || !data.ok) return;

    // rev/ts hochzählen, damit wir inkrementell pollen können
    if(typeof data.rev === 'number') lastRev = data.rev;

    applyStateToLocal(data.state);
  }

  function startPolling(){
    if(pollTimer) return;
    pollTimer = setInterval(poll, POLL_MS);
    poll(); // sofort
  }
  function stopPolling(){
    if(pollTimer){ clearInterval(pollTimer); pollTimer=null; }
  }

  // --- Hook 1: SKWriter.setSK => send to server (nur im Coop) ---
  function hookSKWriter(){
    // warten bis SKWriter existiert (script.js lädt defer)
    const tryHook = ()=>{
      const w = window.SKWriter;
      if(!w || typeof w.setSK !== 'function') return false;

      if(w.__coopHooked) return true;
      w.__coopHooked = true;

      const orig = w.setSK.bind(w);
      w.setSK = function(id, kat, opts){
        const changed = orig(id, kat, opts);
        if(changed && window.Coop?.isActive?.()){
          // Server soll die "Wahrheit" werden
          window.Coop.sendEvent('setSK', { id:String(id).toLowerCase(), kat:String(kat) })
            .catch(()=>{});
        }
        return changed;
      };
      return true;
    };

    if(tryHook()) return;
    const t = setInterval(()=>{ if(tryHook()) clearInterval(t); }, 120);
    setTimeout(()=>clearInterval(t), 8000);
  }

  // --- Hook 2: OrgL "Klinik zuweisen" => send done to server ---
  function hookAblageStop(){
    const tryHook = ()=>{
      const A = window.Ablage;
      if(!A || typeof A.stopPatient !== 'function') return false;

      if(A.__coopHooked) return true;
      A.__coopHooked = true;

      const orig = A.stopPatient.bind(A);
      A.stopPatient = function(id, ziel, idVal){
        const ok = orig(id, ziel, idVal);
        if(ok && window.Coop?.isActive?.()){
          window.Coop.sendEvent('donePatient', {
            id: String(id).toLowerCase(),
            ziel: ziel || '',
            idVal: idVal || ''
          }).catch(()=>{});
        }
        return ok;
      };
      return true;
    };

    if(tryHook()) return;
    const t = setInterval(()=>{ if(tryHook()) clearInterval(t); }, 120);
    setTimeout(()=>clearInterval(t), 8000);
  }

  // --- Start/Stop automatisch je nach Session ---
  function boot(){
    hookSKWriter();
    hookAblageStop();

    if(window.Coop?.isActive?.()) startPolling();
    else stopPolling();
  }

  // Session kann später gesetzt werden (join), also beobachten:
  window.addEventListener('storage', (e)=>{
    if(e && e.key === (window.Coop?.KEY || 'coop_session_v1')) boot();
  });

  // erster Start
  if(document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', boot, { once:true });
  else
    boot();
})();
