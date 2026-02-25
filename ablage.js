/* =========================================================
   1Rettungsmittel · ablage.js  (v10: Start nur beim Betreten)
   ========================================================= */
(function () {
  'use strict';

  // Storage Keys
  var LS_ACTIVE   = 'ablage.active.v1';
  var LS_HISTORY  = 'ablage.history.v1';
  var LS_SESSION  = 'ablage.sessionStart.v1';
  var LS_DONE     = 'ablage.done.v1';

  // Dynamik
  var LS_DYN      = 'ablage.dynamik.v1';
  var LS_DYN_PLAN = 'ablage.dynamik.plan.v1';

  // Utils
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

  // Dynamik Settings
  function getDyn(){
    return load(LS_DYN, {
      enabled:false,
      mode:'off',
      basis:'patient',
      random:{
        minMin:3,
        maxMin:5,
        count:3,
        minGapSec:60,
        maxSchwarz:2,
        allow:{sk1:true, sk2:true, sk3:true, sk4:false},
        toLowerOnly:true
      },
      fixed:[]
    });
  }
  function setDyn(v){ save(LS_DYN, v||{}); }
  function getDynPlan(){ return load(LS_DYN_PLAN, { createdAt:0, basis:'patient', mode:'off', events:[] }); }
  function setDynPlan(v){ save(LS_DYN_PLAN, v||{}); }

  function dynSignature(dyn){
    try{
      var clean = {
        enabled: !!(dyn && dyn.enabled),
        mode: String((dyn && dyn.mode) || 'off'),
        basis: String((dyn && dyn.basis) || 'patient'),
        random: dyn && dyn.random ? dyn.random : null,
        fixed: dyn && dyn.fixed ? dyn.fixed : null
      };
      return JSON.stringify(clean);
    }catch(_){ return ''; }
  }

  function skToCat(sk){
    var n = Number(String(sk).replace(/\D/g,'')) || 0;
    if(n===1) return 'rot';
    if(n===2) return 'gelb';
    if(n===3) return 'gruen';
    if(n===4) return 'schwarz';
    return '';
  }
  function catToSk(cat){
    var c = String(cat||'').toLowerCase().replace('grün','gruen');
    if(c==='rot') return 1;
    if(c==='gelb') return 2;
    if(c==='gruen') return 3;
    if(c==='schwarz') return 4;
    return 0;
  }
  function getSichtungMap(){
    try{ return JSON.parse(localStorage.getItem('sichtungMap')||'{}') || {}; }catch(_){ return {}; }
  }
  function setSichtungMap(m){
    try{ localStorage.setItem('sichtungMap', JSON.stringify(m||{})); }catch(_){}
  }

  function patientNumFromId(id){
    var n = Number(String(id||'').replace(/\D/g,'')) || 0;
    return n || 0;
  }

  function hasVXProfilesFor(id){
    try{
      if(!window.VX_MAP) return true;
      var n = patientNumFromId(id);
      if(!n) return false;
      var entry = window.VX_MAP[n];
      return Array.isArray(entry) && entry.length > 0;
    }catch(_){ return true; }
  }

  function randInt(min,max){
    min=Math.ceil(min); max=Math.floor(max);
    return Math.floor(Math.random()*(max-min+1))+min;
  }
  function shuffle(arr){
    for(var i=arr.length-1;i>0;i--){
      var j=Math.floor(Math.random()*(i+1));
      var t=arr[i]; arr[i]=arr[j]; arr[j]=t;
    }
    return arr;
  }

  function ensureRandomPlan(dyn){
    var plan = getDynPlan();
    var sessionStart = ensureSessionStart();
    var sig = dynSignature(dyn);

    if(plan && plan.createdAt && plan.sessionStart === sessionStart && plan.dynSig === sig && Array.isArray(plan.events) && plan.events.length){
      return plan;
    }

    var rnd = dyn.random || {};
    var allow = rnd.allow ? rnd.allow : {sk1:true,sk2:true,sk3:true,sk4:false};

    var count = Number(rnd.count || 3);
    count = Math.max(0, Math.min(20, count));

    var maxSchwarz = Number(rnd.maxSchwarz || 0);
    maxSchwarz = Math.max(0, Math.min(20, maxSchwarz));

    var allowSchwarz = !!allow.sk4;

    var a = getActive();
    var sMap = getSichtungMap();

    var candidates = [];
    for(var i=0;i<a.length;i++){
      var id = String(a[i].id||'');
      if(!id) continue;
      if(!hasVXProfilesFor(id)) continue;

      var cat = (sMap[id]||'').toString().toLowerCase().replace('grün','gruen');
      var sk = catToSk(cat);

      if(sk===1 && !allow.sk1) continue;
      if(sk===2 && !allow.sk2) continue;
      if(sk===3 && !allow.sk3) continue;
      if(sk===4) continue;

      candidates.push({ id:id, cat:cat, sk:sk });
    }
    shuffle(candidates);

    var minMin = Number(rnd.minMin || 3);
    var maxMin = Number(rnd.maxMin || 5);
    if(maxMin < minMin){ var tmp=minMin; minMin=maxMin; maxMin=tmp; }

    var minGapSec = Number(rnd.minGapSec || 60);
    minGapSec = Math.max(0, minGapSec);

    var events = [];
    var used = {};
    var lastAt = -1;

    var schwarzPlanned = 0;

    for(var k=0;k<candidates.length && events.length<count;k++){
      var cand = candidates[k];
      if(used[cand.id]) continue;

      var toSk = cand.sk;

      if(rnd.toLowerOnly){

        if(cand.sk > 1){
          toSk = cand.sk - 1;
        } else if(cand.sk === 1){

          if(!allowSchwarz) continue;
          if(schwarzPlanned >= maxSchwarz) continue;

          toSk = 4;
        }

      } else {

        var picks = [1,2,3,4].filter(function(x){ return x !== cand.sk; });

        if(!allowSchwarz){
          picks = picks.filter(function(x){ return x !== 4; });
        } else if(maxSchwarz <= 0){
          picks = picks.filter(function(x){ return x !== 4; });
        } else if(schwarzPlanned >= maxSchwarz){
          picks = picks.filter(function(x){ return x !== 4; });
        }

        if(!picks.length) continue;

        toSk = picks[randInt(0, picks.length-1)];
      }

      if(toSk === cand.sk) continue;

      var atSec = randInt(minMin*60, maxMin*60);

      if(lastAt>=0 && atSec < lastAt + minGapSec){
        atSec = lastAt + minGapSec;
      }
      lastAt = atSec;

      events.push({
        id: cand.id,
        atMs: atSec*1000,
        action: 'sk',
        from: cand.sk,
        to: toSk,
        done: false
      });

      if(toSk === 4) schwarzPlanned++;

      used[cand.id] = true;
    }

    plan = {
      createdAt: now(),
      sessionStart: sessionStart,
      dynSig: sig,
      basis: dyn.basis || 'patient',
      mode: 'random',
      events: events
    };
    setDynPlan(plan);
    return plan;
  }

  function ensureFixedPlan(dyn){
    var plan = getDynPlan();
    var sessionStart = ensureSessionStart();
    var sig = dynSignature(dyn);
    if(plan && plan.createdAt && plan.sessionStart === sessionStart && plan.dynSig === sig && plan.mode === 'fixed' && Array.isArray(plan.events)){
      return plan;
    }
    var events = asArray(dyn.fixed).map(function(x){
      var id = x && x.id ? String(x.id) : '';
      if(!id) return null;
      var to = Number(x.to || x.toSk || 0);
      var atMs = Number(x.atMs || 0);
      if(!atMs && x.afterMin != null) atMs = Number(x.afterMin)*60*1000;
      if(!atMs && x.afterSec != null) atMs = Number(x.afterSec)*1000;
      if(!to) to = Number(x.toSK || 0);
      return { id:id, atMs:Math.max(0,atMs), action:'sk', delta:(x && x.delta!=null)? Number(x.delta) : null, to:to, done:false };
    }).filter(Boolean);

    plan = { createdAt: now(), sessionStart: sessionStart, dynSig: sig, basis: dyn.basis || 'patient', mode:'fixed', events: events };
    setDynPlan(plan);
    return plan;
  }

  function applyDynEvent(ev){
    if(!ev || ev.done) return false;
    if(ev.action !== 'sk') return false;

    var id = String(ev.id||'');
    if(!id) return false;

    if(!hasVXProfilesFor(id)){
      ev.done = true;
      return false;
    }

    var sMap = getSichtungMap();
    var fromCat = (sMap[id]||'').toString().toLowerCase().replace('grün','gruen').trim();

    if(fromCat === 'schwarz'){
      ev.done = true;
      return false;
    }

    function nextWorseCat(cat){
      var c = String(cat||'').toLowerCase().replace('grün','gruen').trim();
      if(c === 'gruen') return 'gelb';
      if(c === 'gelb') return 'rot';
      if(c === 'rot') return 'schwarz';
      return '';
    }

    var profile = null;
    try{
      if(typeof window.VX_PICK_PROFILE === 'function'){
        profile = window.VX_PICK_PROFILE(String(id).replace(/\D/g,''));
      }
    }catch(_){ profile = null; }

    var toCat = '';

    if(profile && profile.neueKategorie){
      toCat = String(profile.neueKategorie).toLowerCase().replace('grün','gruen').trim();
    } else {
      var rawTo = ev.to;
      if(rawTo != null && rawTo !== ''){
        var n = Number(rawTo);
        if(isFinite(n) && n>=1 && n<=4){
          toCat = skToCat(n);
        } else {
          toCat = String(rawTo).toLowerCase().replace('grün','gruen').trim();
        }
      }

      if(ev.delta != null){
        var d = Number(ev.delta);
        if(!isFinite(d)) d = 0;
        var steps = Math.max(0, Math.round(Math.abs(d)));
        if(d < 0){
          var tmp = fromCat;
          for(var s=0;s<steps;s++){
            var nx = nextWorseCat(tmp);
            if(!nx) break;
            tmp = nx;
          }
          toCat = tmp;
        }
      }

      if(!toCat){
        toCat = nextWorseCat(fromCat);
      }
    }

    if(!toCat || toCat === fromCat){
      ev.done = true;
      return false;
    }

    sMap[id] = toCat;
    setSichtungMap(sMap);
    ev.done = true;

    if(profile && (profile.grund || profile.titel || profile.werte)){
      try{
        var active = getActive();
        for(var i=0;i<active.length;i++){
          if(String(active[i].id) === String(id)){
            if(profile.werte){
              if(profile.werte.af != null) active[i].af = profile.werte.af;
              if(profile.werte.puls != null) active[i].puls = profile.werte.puls;
            }
            active[i].verschlechterung = {
              key: profile.id || '',
              titel: profile.titel || '',
              grund: profile.grund || '',
              toCat: toCat,
              werte: profile.werte || null,
              zeit: Date.now()
            };
          }
        }
        setActive(active);
      }catch(_e){}
    }

    return {
      id: id,
      fromCat: fromCat,
      toCat: toCat,
      profile: profile
    };
  }

  function dynCheck(active, tNow){
    var dyn = getDyn();
    if(!dyn || !dyn.enabled) return;
    var mode = String(dyn.mode||'off');
    if(mode === 'off') return;

    var plan = null;
    if(mode === 'random') plan = ensureRandomPlan(dyn);
    else if(mode === 'fixed') plan = ensureFixedPlan(dyn);
    else return;

    if(!plan || !Array.isArray(plan.events) || !plan.events.length) return;

    var changed = false;

    var elapsedMap = {};
    for(var i=0;i<active.length;i++){
      var x=active[i]; if(!x) continue;
      var id=String(x.id||''); if(!id) continue;
      var st = (typeof x.startAt === 'number') ? x.startAt : null;
      var off = Number(x.offset || 0);
      if(st!=null){
        elapsedMap[id] = (tNow - st + off);
      }
    }

    var fired = [];
    var labelMap = {};
    for(var a=0;a<active.length;a++){
      var it = active[a];
      if(it && it.id){
        labelMap[String(it.id)] = it.label || it.id;
      }
    }

    for(var j=0;j<plan.events.length;j++){
      var ev = plan.events[j];
      if(!ev || ev.done) continue;
      var id2 = String(ev.id||'');
      var elapsed = elapsedMap[id2];
      if(elapsed == null) continue;
      if(elapsed >= Number(ev.atMs||0)){
        var info = applyDynEvent(ev);
        if(info){
          changed = true;
          info.label = labelMap[info.id] || info.id;
          info.afterMs = Number(ev.atMs||0);
          info.elapsedMs = elapsed;
          fired.push(info);
        }
      }
    }

    if(changed){
      setDynPlan(plan);
      try{ window.dispatchEvent(new CustomEvent('ablage:dynamik', { detail: plan })); }catch(_){
        try{ window.dispatchEvent(new Event('ablage:dynamik')); }catch(__){}
      }
      if(fired.length){
        try{ window.dispatchEvent(new CustomEvent('ablage:dynamik:fired', { detail: { fired: fired, plan: plan } })); }catch(_e){
          try{ window.dispatchEvent(new Event('ablage:dynamik:fired')); }catch(__e){}
        }
      }
    }
  }

  function ensureSessionStart(){
    var t = Number(localStorage.getItem(LS_SESSION) || 0);
    if(!t){
      t = now();
      try{ localStorage.setItem(LS_SESSION, String(t)); }catch(_){}
    }
    return t;
  }

  function fmt(ms){
    if(ms<0) ms=0;
    var s=Math.floor(ms/1000),
        hh=Math.floor(s/3600),
        mm=Math.floor((s%3600)/60),
        ss=s%60;
    var pad=function(n){ return String(n).padStart(2,'0'); };
    return hh>0 ? (pad(hh)+':'+pad(mm)+':'+pad(ss)) : (pad(mm)+':'+pad(ss));
  }

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
      startAt: null,
      offset: 0
    });
    setActive(a);
  }

  function stopPatient(id, ziel, idVal){
    var a = getActive(), idx = -1;
    for(var i=0;i<a.length;i++){ if(String(a[i].id)===String(id)){ idx=i; break; } }
    if(idx<0) return false;

    var p = a[idx], endedAt = now();

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

    a.splice(idx,1); setActive(a);
    var h = getHistory(); h.push(entry); setHistory(h);
    var d = getDone(); d.push(p.id); setDone(d);
    return true;
  }

  function resetAll(){
    setActive([]); setHistory([]); setDone([]);
    try{ localStorage.removeItem(LS_SESSION); }catch(_){}
  }

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
              try{ cardEl.remove(); }catch(_){ cardEl.parentNode && cardEl.parentNode.removeChild(cardEl); }
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

    var lastDynCheck = 0;
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

      if(now() - lastDynCheck >= 1000){
        lastDynCheck = now();
        try{ dynCheck(active, lastDynCheck); }catch(_){ }
      }
      state.rafId = requestAnimationFrame(step);
    }
    state.rafId = requestAnimationFrame(step);
  }

  window.Ablage = {
    hydrateCards, stopPatient, resetAll,
    startOnEnter: startTimersOnEntry,
    _getActive:getActive, _getHistory:getHistory, _getDone:getDone
  };

  function autoInit(){
    startTimersOnEntry();
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(autoInit, 0);
  } else {
    document.addEventListener('DOMContentLoaded', autoInit, { once:true });
  }

  window.addEventListener('pageshow', autoInit);

})();
