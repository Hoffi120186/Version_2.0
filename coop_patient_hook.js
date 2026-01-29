/* =========================================================
   1Rettungsmittel · coop_patient_hook.js
   -> sendet Sichtung (triage) in den COOP, sobald SK-Button gedrückt wird
   -> optional: T/B Flags mitschicken (falls du willst)
   ========================================================= */
(function () {
  'use strict';

  function getPatientId() {
    const file = (location.pathname.split('/').pop() || '');
    const m = file.match(/patient(\d+)\.html/i);
    return m ? parseInt(m[1], 10) : 0;
  }

  function normCat(v) {
    v = String(v || '').trim().toLowerCase();
    if (v.includes('grün')) v = v.replace('grün', 'gruen');
    // auch sk1..sk4 zulassen
    if (v === 'sk1') return 'rot';
    if (v === 'sk2') return 'gelb';
    if (v === 'sk3') return 'gruen';
    if (v === 'sk4') return 'schwarz';
    return v;
  }

  function coopEnabled() {
    try {
      if (!window.Coop || typeof window.Coop.getState !== 'function') return false;
      const st = window.Coop.getState();
      return !!(st && st.enabled && st.incident_id && st.token);
    } catch (_) { return false; }
  }

  async function coopPatch(fields) {
    const pid = getPatientId();
    if (!pid) return;

    if (!coopEnabled()) return;

    // nur erlaubte keys schicken
    const payload = Object.assign({}, fields);

    // triage normalisieren
    if (payload.triage) payload.triage = normCat(payload.triage);

    // absichern
    if (payload.triage && !['rot', 'gelb', 'gruen', 'schwarz'].includes(payload.triage)) {
      return;
    }

    try {
      const res = await window.Coop.patchPatient(pid, payload);
      console.log('[COOP] patchPatient OK', pid, payload, res);
    } catch (e) {
      console.warn('[COOP] patchPatient FAIL', pid, payload, e);
    }
  }

  // ====== Klick-Hooks ======
  // 1) SK Buttons: <button class="sk-btn ..." data-sichtung="rot">
  document.addEventListener('click', function (e) {
    const skBtn = e.target.closest('.sk-btn[data-sichtung]');
    if (skBtn) {
      const triage = skBtn.getAttribute('data-sichtung');
      coopPatch({ triage });
      return;
    }

    // 2) (optional) Transportpriorität: #t-yes / #t-no -> merken in localStorage und ggf. coop patchen
    const tYes = e.target.closest('#t-yes');
    const tNo  = e.target.closest('#t-no');
    if (tYes || tNo) {
      const isT = !!tYes;
      // du nutzt das lokal ohnehin in sicht_patient payloads – hier nur optional
      try {
        const key = 'sicht_patient' + getPatientId();
        const old = JSON.parse(localStorage.getItem(key) || '{}');
        old.t = isT;
        localStorage.setItem(key, JSON.stringify(old));
      } catch (_) {}
      // wenn du das ins Backend willst, könntest du hier z.B. location/flags patchen
      // coopPatch({ location: isT ? 'T' : '' });
      return;
    }

    // 3) (optional) Betroffen: #b-yes / #b-no
    const bYes = e.target.closest('#b-yes');
    const bNo  = e.target.closest('#b-no');
    if (bYes || bNo) {
      const isB = !!bYes;
      try {
        const key = 'sicht_patient' + getPatientId();
        const old = JSON.parse(localStorage.getItem(key) || '{}');
        old.b = isB;
        localStorage.setItem(key, JSON.stringify(old));
      } catch (_) {}
      // coopPatch({ location: isB ? 'B' : '' });
      return;
    }
  }, { passive: true });

})();

