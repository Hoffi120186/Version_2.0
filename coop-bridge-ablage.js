// /coop-bridge-ablage.js
(() => {
  const SINCE_KEY = 'coop_since_ablage1_dt_v1'; // speichert datetime-string

  function safeParse(s, f){ try{ return JSON.parse(s); }catch{ return f; } }
  function loadObj(k,f){ return safeParse(localStorage.getItem(k), f); }
  function saveObj(k,v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch{} }

  function normCat(t){
    t = String(t||'').trim().toLowerCase();
    t = t.replace('grün','gruen');
    return ['rot','gelb','gruen','schwarz'].includes(t) ? t : null;
  }
  function patientKey(id){
    const n = Number(id);
    if(!Number.isFinite(n) || n < 1) return null;
    return `patient${n}`;
  }

  // löst deinen bestehenden storage-listener aus (im selben Tab)
  function emitStorage(key, newValue){
    try{
      window.dispatchEvent(new StorageEvent('storage', { key, newValue }));
    }catch{
      window.dispatchEvent(new Event('storage'));
    }
  }

  function apply(changes){
    const map = loadObj('sichtungMap', {});
    let changed = false;

    for(const row of (changes || [])){
      const k = patientKey(row.patient_id);
      if(!k) continue;

      const cat = normCat(row.triage);
      if(!cat) continue;

      if(String(map[k] || '') !== cat){
        map[k] = cat;
        changed = true;
      }
    }

    if(changed){
      saveObj('sichtungMap', map);
      emitStorage('sichtungMap', JSON.stringify(map));
    }
  }

  async function tick(){
    if(!window.Coop?.isActive()) return;

    const since = localStorage.getItem(SINCE_KEY) || '';
    const data = await Coop.getState({ since });
    if(!data.ok) return;

    const changes = data.changes || [];
    if(!changes.length) return;

    apply(changes);

    // since = updated_at der letzten Änderung (ASC sortiert in deinem state.php)
    const last = changes[changes.length - 1];
    if(last?.updated_at){
      localStorage.setItem(SINCE_KEY, String(last.updated_at));
    }

    // optional: direkt hydrate (falls du "instant" willst)
    if(window.Ablage?.hydrateCards){
      window.Ablage.hydrateCards({
        containerSelector: '#list',
        cardSelector: '.card',
        placeTimer(card, timerEl){ (card.querySelector('h2')||card).appendChild(timerEl); },
        placeActions(card, actionsEl){ (card.querySelector('.actions')||card).appendChild(actionsEl); }
      });
    }
  }

  setInterval(tick, 3000);
  tick();

  document.addEventListener('visibilitychange', () => {
    if(!document.hidden) tick();
  });
})();
