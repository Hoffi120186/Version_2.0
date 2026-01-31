// /coop-client.js
const COOP_API_BASE = '/api/coop_test';

const Coop = {
  getSession() {
    try { return JSON.parse(localStorage.getItem('coop_session') || 'null'); }
    catch { return null; }
  },
  setSession(s) { localStorage.setItem('coop_session', JSON.stringify(s)); },
  clearSession() { localStorage.removeItem('coop_session'); },
  isActive() { const s=this.getSession(); return !!(s && s.token && s.incident_id); },

  async createIncident(expires_hours = 12) {
    const r = await fetch(`${COOP_API_BASE}/create_incident.php`, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ expires_hours })
    });
    return r.json();
  },

  async join(join_code, role='rtw', label='') {
    const r = await fetch(`${COOP_API_BASE}/join_incident.php`, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ join_code, role, label })
    });
    const data = await r.json();

    // Dein System nutzt token in coop_test_members – wir erwarten "token" oder fallback-Felder
    const token = data.token || data.member_token || data.client_token || data.client_id;
    const incident_id = data.incident_id;

    if (data.ok && token && incident_id) {
      this.setSession({
        incident_id,
        token,
        role: data.role || role,
        label: data.label || label || '',
        joined_at: Date.now()
      });
    }
    return data;
  },

  // Sichtung senden: nutzt patch_patient.php (dein Backend)
  // Wir senden BEIDES: triage (rot/gelb/...) und sk (SK1/...) – patch_patient kann nehmen was es kennt.
  async sendSighting({ patient_id, sk, triage, location='', clinic_target='', clinic_status='' }) {
    const s = this.getSession();
    if (!s?.token) return { ok:false, error:'no_session' };

    const r = await fetch(`${COOP_API_BASE}/patch_patient.php`, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({
        incident_id: s.incident_id,
        token: s.token,
        patient_id,
        sk,
        triage,
        location,
        clinic_target,
        clinic_status
      })
    });
    return r.json();
  },

  // State holen: passt zu deinem state.php (changes + since-string)
  async getState({ since = '' } = {}) {
    const s = this.getSession();
    if (!s?.token) return { ok:false, error:'no_session' };

    const url = `${COOP_API_BASE}/state.php?incident_id=${encodeURIComponent(s.incident_id)}&token=${encodeURIComponent(s.token)}&since=${encodeURIComponent(since || '')}`;
    const r = await fetch(url, { cache:'no-store' });
    return r.json();
  }
};

window.Coop = Coop;
