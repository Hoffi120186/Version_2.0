(function(){
  'use strict';

  var LS_ACTIVE  = 'ablage.active.v1';
  var LS_HISTORY = 'ablage.history.v1';
  var LS_DONE    = 'ablage.done.v1';
  var LS_SESSION = 'ablage.session.start.v1';

  function now(){ return Date.now(); }

  function read(key, fallback){
    try{
      var raw = localStorage.getItem(key);
      if(!raw) return fallback;
      return JSON.parse(raw);
    }catch(_){
      return fallback;
    }
  }
  function write(key, val){
    try{ localStorage.setItem(key, JSON.stringify(val)); }catch(_){}
  }

  function getActive(){ return read(LS_ACTIVE, []); }
  function setActive(list){ write(LS_ACTIVE, list || []); }

  function getHistory(){ return read(LS_HISTORY, []); }
  function setHistory(list){ write(LS_HISTORY, list || []); }

  function getDone(){ return read(LS_DONE, []); }
  function setDone(list){ write(LS_DONE, list || []); }

  function ensureSessionStart(){
    try{
      var st = parseInt(localStorage.getItem(LS_SESSION) || '0', 10);
      if(!st){ localStorage.setItem(LS_SESSION, String(now())); }
    }catch(_){}
  }

  function fmt(ms){
    ms = Math.max(0, Number(ms||0));
    var s = Math.floor(ms/1000);
    var hh=Math.floor(s/3600),
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

    try{
      var sess = JSON.parse(localStorage.getItem('coop_session_v1') || 'null');
      var base = (sess && sess.base) ? String(sess.base) : '';
      var incident_id = sess && sess.incident_id;
      var token = sess && sess.token;
      if(base && incident_id && token){
        fetch(base + '/incident/event', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-coop-incident': incident_id,
            'x-coop-token': token
          },
          body: JSON.stringify({ type: 'donePatient', payload: { id: String(id).toLowerCase() } })
        }).catch(function(){});
      }
    }catch(_){}

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

  window.Ablage = {
    hydrateCards: hydrateCards,
    stopPatient: stopPatient,
    resetAll: resetAll,
    _getActive: getActive,
    _getHistory: getHistory,
    _getDone: getDone
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
