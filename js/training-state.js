// /js/training-state.js
const TS_KEY = 'TRAINING_STATE_V1';

function load(){ try{ return JSON.parse(localStorage.getItem(TS_KEY))||{} }catch{ return {} } }
function save(s){ localStorage.setItem(TS_KEY, JSON.stringify(s)) }

export function ts_startSession(enabledPatientIds = [], opts = {}) {
  const s = load();
  s.session = {
    id: opts.sessionId || `S${Date.now()}`,
    startedAt: Date.now(),
    enabled: enabledPatientIds.map(x=>String(x).toLowerCase())
  };
  save(s);
  return s.session;
}
export function ts_getEnabledPatients() {
  const s = load();
  return s.session?.enabled || [];
}
