// /coop-bridge-ablage.js
(() => {
  const SINCE_KEY = 'coop_since_ablage1_v2'; // speichert "YYYY-mm-dd HH:ii:ss"

  function safeParse(s, f){ try{ return JSON.parse(s); }catch{ return f; } }
  function loadObj(k,f){ return safeParse(localStorage.getItem(k), f); }
  function saveObj(k,v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch{} }

  function skToCat(sk){
    sk = String(sk||'').toUpperCase();
    if(sk==='SK1') return 'rot';
    if(sk==='SK2') return 'gelb';
    if(sk==='SK3') return 'gruen';
    if(sk==='SK4') return 'schwarz';
    return null;
  }
  function triageToCat(t){
    t = String(t||'').trim().toLowerCase();
    t = t.replace('grün','gruen');
    if(['rot','gelb','gruen','schwarz'].includes(t)) return t;
    if(/^sk[1-4]$/.test(t.toUpperCase())) return skToCat(t.toUpperCase());
    return null;
  }
  function patientKeyFromId(n){
    const id = Number(n);
    if(!Number.isFinite(id) || id<1) return null;
    return `patient${id}`;
  }

  function emitStorageLike(key, newValue){
    // storage feuert normalerweise nur in anderen Tabs – wir simulieren es
    try{
      window.dispatchEvent(new StorageEvent('storage', { key, newValue }));
    }catch{
      window.dispatchEvent(new Event('storage'));
    }
  }

  function applyChangesToLocal(changes){
    const map = loadObj('sichtungMap', {});
    let changed = false;

    for(const row of (changes || [])){
      const pKey = patientKeyFromId(row.patient_id);
      if(!pKey) continue;

      const cat = triageToCat(row.triage) || skToCat(row.sk);
      if(!cat) continue;

      if(String(map[pKey] || '') !== cat){
        map[pKey] = cat;
        changed = true;
      }

      // Optional: T/B Flags — dein Ablage1 liest sicht_patientX payloads (t/b)
      // Dein Backend liefert dafür aktuell nichts -> wir lassen es weg (bleibt lokal).
      // Wenn du später location/clinic_status nutzen willst, können wir hier auch schreiben.
    }

    if(changed){
      saveObj('sichtungMap', map);
      emitStorageLike('sichtungMap', JSON.stringify(map));
    }
  }

  async function tick(){
    if(!window.Coop?.isActive()) return;

    const since = localStorage.getItem(SINCE_KEY) || '';
    const data = await Coop.getState({ since });
    if(!data.ok) return;

    const changes = data.changes || [];
    if(!changes.length) return;

    // anwenden -> deine bestehende Ablage1 reagiert darauf
    applyChangesToLocal(changes);

    // since auf letztes updated_at setzen (dein state sortiert ASC)
    const last = changes[changes.length - 1];
    if(last && last.updated_at) {
      localStorage.setItem(SINCE_KEY, String(last.updated_at));
    }

    // UI "snappy": hydrate nochmal sicher (dein storage-handler macht es i.d.R. auch)
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
