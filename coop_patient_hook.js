/* =========================================================
   1Rettungsmittel · coop_patient_hook.js
   -> sendet Sichtung (triage) in den COOP, sobald SK-Button gedrückt wird
   -> T/B Flags bleiben lokal (für Anzeige "SK1 · T" / "SK3 · B")
   ========================================================= */
(function () {
  'use strict';

  function getPatientNumber() {
    const file = (location.pathname.split('/').pop() || '');
    const m = file.match(/patient(\d+)\.html/i);
    return m ? parseInt(m[1], 10) : 0;
  }

  function getPatientLocalId() {
    const n = getPatientNumber();
    return n ? ('patient' + n) : '';
  }

  function normCat(v) {
    v = String(v || '').trim().toLowerCase();
    if (v.includes('grün')) v = v.replace('grün', 'gruen');

    // sk1..sk4 zulassen
    if (v === 'sk1') return 'rot';
    if (v === 'sk2') return 'gelb';
    if (v === 'sk3') return 'gruen';
    if (v === 'sk4') return 'schwarz';

    // wenn Buttontext "SK1" usw. kommt
    if (v === 'sk') return 'schwarz'; // falls du den schwarzen Button nur "SK" nennst

    return v;
  }

  function coopEnabled() {
    try {
      const st = window.Coop?.getState?.();
      return !!(st && st.enabled && st.incident_id && st.token && st.apiBase);
    } catch (_) { return false; }
  }

  async function coopPatch(fields) {
    const pid = getPatientNumber();
    if (!pid) return;
    if (!coopEnabled()) return;

    const payload = Object.assign({}, fields);

    if (payload.triage) payload.triage = normCat(payload.triage);

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

  // Lokale Flags im selben Format wie deine Ablage erwartet:
  // -> localStorage key: "sicht_" + "patientX"
  function setLocalFlag(flagKey, value) {
    const id = getPatientLocalId(); // z.B. patient1
    if (!id) return;
    const key = 'sicht_' + id;      // z.B. sicht_patient1

    try {
      const old = JSON.parse(localStorage.getItem(key) || '{}');
      old[flagKey] = !!value;
      localStorage.setItem(key, JSON.stringify(old));
    } catch (_) {}
  }

  // ====== Klick-Hooks ======
  document.addEventListener('click', function (e) {
    // 1) SK Buttons: bevorzugt data-sichtung, fallback Buttontext
    const skBtn = e.target.closest('.sk-btn');
    if (skBtn) {
      const triageAttr = skBtn.getAttribute('data-sichtung');
      const triageText = (skBtn.textContent || '').trim();
      const triage = triageAttr || triageText; // z.B. "rot" oder "SK1"

      coopPatch({ triage });
      return;
    }

    // 2) Transportpriorität: #t-yes / #t-no  -> lokal speichern (T)
    const tYes = e.target.closest('#t-yes');
    const tNo  = e.target.closest('#t-no');
    if (tYes || tNo) {
      setLocalFlag('t', !!tYes);
      return;
    }

    // 3) Betroffen: #b-yes / #b-no -> lokal speichern (B)
    const bYes = e.target.closest('#b-yes');
    const bNo  = e.target.closest('#b-no');
    if (bYes || bNo) {
      setLocalFlag('b', !!bYes);
      return;
    }
  }, { passive: true });

})();
