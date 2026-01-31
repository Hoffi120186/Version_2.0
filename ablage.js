/* =========================================================
   1Rettungsmittel · ablage.js  (v11.1: Coop Patch FIX + Outbox)
   ========================================================= */
(function () {
  'use strict';

  // ----- Storage Keys
  var LS_ACTIVE   = 'ablage.active.v1';
  var LS_HISTORY  = 'ablage.history.v1';
  var LS_SESSION  = 'ablage.sessionStart.v1';
  var LS_DONE     = 'ablage.done.v1';

  // ----- COOP Outbox
  var LS_COOP_OUTBOX = 'coop_outbox_v1';

  // ----- Utils
  function now(){ return Date.now(); }
  function safeParse(s,f){ try{ return JSON.parse(s); }catch(_){ return f; } }
  function load(k,f){ return safeParse(localStorage.getItem(k), f); }
  function save(k,v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(_){ } }
  function asArray(x){ return Array.isArray(x) ? x : []; }

  function getActive(){  return asArray(load(LS_ACTIVE,  [])); }
  function getHistory(){ return asArray(load(LS_HISTORY, [])); }
  function getDone(){    return asArray(load(LS_DONE,    [])); }
  function setActive(a){  save(LS_ACTIVE,  asArray(a)); }
  function setHistory(h){ save(LS_HISTORY, asArray(h)); }
  function setDone(d){    save(LS_DONE,    asArray(d)); }

  // Session-Start (einmal pro Einsatz, falls noch nicht vorhanden)
  function ensureSessionStart(){
    var t = Number(localStorage.getItem(LS_SESSION) || 0);
    if(!t){
      t = now();
      try{ localStorage.setItem(LS_SESSION, String(t)); }catch(_){}
    }
    return t;
  }

  // Zeitformat
  function fmt(ms){
    if(ms<0) ms=0;
    var s=Math.floor(ms/1000),
        hh=Math.floor(s/3600),
        mm=Math.floor((s%3600)/60),
        ss=s%60;
    var pad=function(n){ return String(n).padStart(2,'0'); };
    return hh>0 ? (pad(hh)+':'+pad(mm)+':'+pad(ss)) : (pad(mm)+':'+pad(ss));
  }

  // Migration alter Schemata
  function migrateActive(list){
    var changed = false;
    for (var i=0;i<list.length;i++){
      var it = list[i]; if(!it || typeof it !== 'object') continue;
      if (typeof it.addedAt === 'number') { it.queuedAt = it.addedAt; delete it.addedAt; changed = true; }
      if (typeof it.queuedAt !== 'number') { it.queuedAt = now(); changed = true; }
      if (typeof it.startedAt === 'number' && typeof it.startAt !== 'number') {
        it.startAt = it.startedAt; delete it.startedAt; changed = true;
      }
      if (typeof it.offset !== 'number') { it.offset = 0; changed = true; }
    }
    return changed;
  }

  // ---- WICHTIG: Start NUR beim Betreten dieser Seite
  function startTimersOnEntry(){
    ensureSessionStart();
    var a = getActive();
    var changed = false;

    if (migrateActive(a)) changed = true;

    var t = now();
    for (var i=0;i<a.length;i++){
      var it = a[i]; if(!it) continue;
      if (it.startAt == null) { it.startAt = t; changed = true; }
    }
    if (changed) setActive(a);
  }

  // ----- Patienten-Management (legt nur vor, startet NICHT)
  function ensurePatient(id, name, prio){
    if(!id) return;
    if(getDone().includes(id)) return;
    var a = getActive();
    for(var i=0;i<a.length;i++){ if(String(a[i].id)===String(id)) return; }
    a.push({
      id: id,
      name: name || ("Patient "+String(id).replace(/\D/g,'')),
      prio: prio || '',
      queuedAt: now(),
      startAt: null,  // Start passiert ausschließlich in startTimersOnEntry()
      offset: 0
    });
    setActive(a);
  }

  // =========================================================
  // COOP Helpers
  // =========================================================
  function coopGetState(){
    try{
      if (window.Coop && typeof window.Coop.getState === 'function'){
        var st = window.Coop.getState();
        if (st && st.incident_id && st.token) return st;
      }
    }catch(_){}

    // Fallback: direkte LS-Keys (je nach Version)
    try{
      var raw = localStorage.getItem('coop_state_v1') || localStorage.getItem('coop_state') || '';
      if (!raw) return null;
      var st2 = JSON.parse(raw);
      if (st2 && st2.incident_id && st2.token) return st2;
    }catch(_){}
    return null;
  }

  function coopEnabled(){
    var st = coopGetState();
    return !!(st && st.incident_id && st.token);
  }

  function patientIdToNumber(id){
    var n = parseInt(String(id||'').replace(/\D/g,''), 10);
    return (isFinite(n) && n>0) ? n : 0;
  }

  function coopOutboxGet(){ return asArray(load(LS_COOP_OUTBOX, [])); }
  function coopOutboxSet(list){ save(LS_COOP_OUTBOX, asArray(list)); }

  function coopOutboxPush(item){
    var list = coopOutboxGet();
    list.push(item);
    coopOutboxSet(list);
  }

  // ✅ FIX: coopPatch korrekt (Signatur + Endpoint)
  async function coopPatch(payload){
    // payload erwartet: { patient_id, ...fields }
    var pid = Number(payload && payload.patient_id);
    if(!pid) throw new Error('missing_patient_id');

    // Patch-Felder ohne patient_id
    var patch = Object.assign({}, payload);
    delete patch.patient_id;

    // Wenn coop.js verfügbar ist: korrekte Signatur nutzen
    if (window.Coop && typeof window.Coop.patchPatient === 'function'){
      return window.Coop.patchPatient(pid, patch);
    }

    // Fallback: direkt fetchen (nur wenn coop state existiert)
    var st = coopGetState();
    if(!st) throw new Error('coop_not_active');

    var API = (st.apiBase) || 'https://www.1rettungsmittel.de/api/coop_test';
    var url = API.replace(/\/$/,'') + '/patch_patient.php';

    var body = Object.assign({}, patch, {
      patient_id: pid,
      incident_id: st.incident_id,
      token: st.token
    });

    var r = await fetch(url, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify(body)
    });
    var j = await r.json().catch(function(){ return null; });
    if (!j || !j.ok) throw new Error((j && j.error) ? j.error : 'coop_patch_failed');
    return j;
  }

  async function coopFlushOutbox(){
    if(!coopEnabled()) return;
    if(!navigator.onLine) return;

    var list = coopOutboxGet();
    if(!list.length) return;

    var keep = [];
    for (var i=0;i<list.length;i++){
      var job = list[i];
      try{
        await coopPatch(job.payload);
      }catch(e){
        keep.push(job);
      }
    }
    coopOutboxSet(keep);
  }

  // regelmäßig versuchen, Outbox zu senden (leicht)
  var __flushTimer = 0;
  function startOutboxPump(){
    if(__flushTimer) return;
    __flushTimer = setInterval(function(){
      coopFlushOutbox().catch(function(){});
    }, 2500);
    window.addEventListener('online', function(){
      coopFlushOutbox().catch(function(){});
    });
    document.addEventListener('visibilitychange', function(){
      if (document.visibilityState === 'visible') coopFlushOutbox().catch(function(){});
    });
  }

  // =========================================================
  // ----- Stop / Abschluss (inkl. Coop Klinik Patch)
  // =========================================================
  function stopPatient(id, ziel, idVal){
    var a = getActive(), idx = -1;
    for(var i=0;i<a.length;i++){ if(String(a[i].id)===String(id)){ idx=i; break; } }
    if(idx<0) return false;

    var p = a[idx], endedAt = now();

    // Migration falls nötig
    if (typeof p.startedAt === 'number' && typeof p.startAt !== 'number') {
      p.startAt = p.startedAt; delete p.startedAt;
    }
    var startAt = Number(p.startAt || now());
    var offset  = Number(p.offset || 0);

    var entry = {
      id: p.id,
      name: idVal || p.name || p.id,
      prio: p.prio || '',
      startedAt: startAt,
      endedAt: endedAt,
      dauerMs: Math.max(0, (endedAt - startAt) + offset),
      ziel: ziel || ''
    };

    // ✅ LOKAL: aus Active raus / History+Done
    a.splice(idx,1); setActive(a);
    var h = getHistory(); h.push(entry); setHistory(h);
    var d = getDone(); d.push(p.id); setDone(d);

    // ✅ COOP: Klinikzuweisung patchen (wenn aktiv)
    try{
      if (coopEnabled()){
        startOutboxPump();

        var pid = patientIdToNumber(p.id);
        if(pid){
          var payload = {
            patient_id: pid,
            clinic_target: ziel || '',
            clinic_status: 'assigned'
          };

          coopPatch(payload).catch(function(err){
            coopOutboxPush({
              ts: Date.now(),
              kind: 'clinic_assign',
              payload: payload,
              err: String(err && err.message ? err.message : err)
            });
          });
        }
      }
    }catch(_){}

    return true;
  }

  function resetAll(){
    setActive([]); setHistory([]); setDone([]);
    try{ localStorage.removeItem(LS_SESSION); }catch(_){}
  }

  // ----- Timer-Rendering
  var tickers = new WeakMap();

  function hydrateCards(opts){
    opts = opts || {};
    var root = document.querySelector(opts.containerSelector || '');
    if(!root) return;

    var cards = root.querySelectorAll(opts.cardSelector || '.card');
    for(var i=0;i<cards.length;i++){
      var card = cards[i];
      var id   = card.getAttribute('data-patient-id') || card.getAttribute('data-id');
      if(!id) continue;
      if(getDone().includes(id)){ try{ card.remove(); }catch(_){} continue; }

      var name = card.getAttribute('data-name') || ("Patient "+String(id).replace(/\D/g,''));
      var prio = card.getAttribute('data-prio') || '';
      ensurePatient(id,name,prio);

      if(!card.querySelector('.ablage-timer')){
        var tEl=document.createElement('span');
        tEl.className='ablage-timer';
        tEl.textContent='00:00';
        if(typeof opts.placeTimer==='function') opts.placeTimer(card,tEl);
        else (card.querySelector('h2')||card).appendChild(tEl);
      }

      if(!card.querySelector('.ablage-actions')){
        var wrap=document.createElement('div');
        wrap.className='ablage-actions';
        wrap.style.display="flex"; wrap.style.flexWrap="wrap"; wrap.style.gap="6px"; wrap.style.marginTop="8px";
        wrap.innerHTML =
          '<input type="text" class="ablage-id" placeholder="Patienten-ID" '+
          'style="flex:1 1 120px;padding:.5rem;border-radius:8px;border:1px solid #334155;'+
          'background:#0b1220;color:#e5e7eb;" />'+
          '<select class="ablage-ziel" style="flex:1 1 140px;padding:.5rem;border-radius:8px;'+
          'border:1px solid #334155;background:#0b1220;color:#e5e7eb;">'+
            '<option value="">Ziel wählen…</option>'+
            '<option>Traumazentrum</option>'+
            '<option>Grundversorger</option>'+
            '<option>Maximalversorger</option>'+
            '<option>Verbleib am Einsatzort</option>'+
            '<option>Sonstige</option>'+
          '</select>'+
          '<button type="button" class="btn btn-zuweisen" '+
          'style="flex:1 1 120px;">Klinik zuweisen</button>';

        if(typeof opts.placeActions==='function') opts.placeActions(card,wrap);
        else (card.querySelector('.actions')||card).appendChild(wrap);

        (function (cardEl, btnEl) {
          btnEl.addEventListener('click', function (ev) {
            ev.preventDefault(); ev.stopPropagation();
            var idInput = cardEl.querySelector('.ablage-id');
            var idVal = idInput ? idInput.value.trim() : '';
            if(!idVal){ alert('Bitte Patienten-ID eingeben!'); return; }
            var zielSel = cardEl.querySelector('.ablage-ziel');
            var ziel = zielSel ? (zielSel.value||'') : '';
            if(!ziel && !window.confirm('Ohne Ziel zuweisen?')) return;
            var cid = cardEl.getAttribute('data-patient-id') || cardEl.getAttribute('data-id');

            if(cid && stopPatient(cid, ziel, idVal)){
              try{ cardEl.remove(); }catch(_){
                cardEl.parentNode && cardEl.parentNode.removeChild(cardEl);
              }
            }
          }, { passive:false });
        })(card, wrap.querySelector('.btn-zuweisen'));
      }
    }

    if(!tickers.get(root)){
      tickers.set(root,{running:true,rafId:0});
      startTick(root, opts);
    }
  }

  function startTick(root, opts){
    var state=tickers.get(root);
    if(!state || !state.running) return;

    function step(){
      var active = getActive();
      var startMap = {};
      for(var i=0;i<active.length;i++){
        var x=active[i];
        if (typeof x.startedAt === 'number' && typeof x.startAt !== 'number') {
          x.startAt = x.startedAt; delete x.startedAt; setActive(active);
        }
        var st = (typeof x.startAt === 'number') ? x.startAt : null;
        var off = Number(x.offset || 0);
        startMap[String(x.id)] = st!=null ? (now() - st + off) : 0;
      }

      var cards = root.querySelectorAll(opts.cardSelector || '.card');
      for(var j=0;j<cards.length;j++){
        var c=cards[j];
        var id = c.getAttribute('data-patient-id') || c.getAttribute('data-id');
        if(!id) continue;
        var tEl=c.querySelector('.ablage-timer'); if(!tEl) continue;
        var ms = startMap[String(id)] || 0;
        tEl.textContent = fmt(ms);
        c.classList.toggle('waiting', ms===0);
      }
      state.rafId = requestAnimationFrame(step);
    }
    state.rafId = requestAnimationFrame(step);
  }

  // ---------- Public API ----------
  window.Ablage = {
    hydrateCards, stopPatient, resetAll,
    _getActive:getActive, _getHistory:getHistory, _getDone:getDone
  };

  // ----- Auto-Init: Start nur beim Betreten
  function autoInit(){
    startTimersOnEntry();

    // Coop Outbox (falls Coop aktiv)
    if (coopEnabled()){
      startOutboxPump();
      coopFlushOutbox().catch(function(){});
    }
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(autoInit, 0);
  } else {
    document.addEventListener('DOMContentLoaded', autoInit, { once:true });
  }
  window.addEventListener('pageshow', autoInit);

})();
// === COOP: Änderungen -> localStorage Ablage updaten + UI refresh ===
(function(){
  function normKat(v){
    if (!v) return null;
    let x = String(v).trim().toLowerCase();
    if (x.includes("grün")) x = x.replace("grün","gruen");
    const map = { sk1:"rot", sk2:"gelb", sk3:"gruen", sk0:"schwarz" };
    if (map[x]) x = map[x];
    return ["rot","gelb","gruen","schwarz"].includes(x) ? x : null;
  }

  function upsertAblage(id, kat){
    const ABL_KEY = "ablage.active.v1";
    const now = Date.now();

    let list = [];
    try { list = JSON.parse(localStorage.getItem(ABL_KEY) || "[]"); } catch {}
    if (!Array.isArray(list)) list = [];

    const i = list.findIndex(e => e && e.id === id);
    if (i >= 0) list[i] = { ...list[i], id, sk: kat, lastUpdate: now, start: list[i].start ?? now };
    else list.push({ id, sk: kat, start: now, lastUpdate: now });

    try { localStorage.setItem(ABL_KEY, JSON.stringify(list)); } catch {}

    // Kompat-Schlüssel (falls deine Ablage so liest)
    try { localStorage.setItem("ablage", JSON.stringify(list)); } catch {}
    try { localStorage.setItem("ablage_ids", JSON.stringify(list.map(x => x.id))); } catch {}
    try { localStorage.setItem("ablage_patient_" + id, kat); } catch {}
  }

  function applyChanges(changes){
    if (!Array.isArray(changes) || !changes.length) return;

    for (const row of changes){
      const n = parseInt(row?.patient_id, 10);
      if (!Number.isFinite(n) || n <= 0) continue;

      const id  = ("patient" + n).toLowerCase();
      const kat = normKat(row?.triage);
      if (!kat) continue;

      upsertAblage(id, kat);
    }

    // ✅ HIER: deine Ablage neu zeichnen
    // Falls du eine Render-Funktion hast:
    if (typeof window.renderAblage === "function") window.renderAblage();

    // Falls du BroadcastChannel nutzt:
    try { new BroadcastChannel("ablage").postMessage({ type:"refresh" }); } catch {}
  }

  window.addEventListener("coop:changes", (ev)=>{
    const changes = ev?.detail?.changes || [];
    applyChanges(changes);
  });
})();


