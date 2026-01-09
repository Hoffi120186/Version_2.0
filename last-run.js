// last-run.js
const LAST_RUN_KEY = '1rm_last_run_v1';

// Snapshot speichern
function saveLastRunFromAssignments(assignments, meta = {}) {
  if (!Array.isArray(assignments)) return;

  const snapshot = {
    savedAt: new Date().toISOString(),
    total: assignments.length,
    meta,            // optional: Szenario-Name, Instruktor usw.
    assignments      // Array mit deinen Zuweisungs-Objekten
  };

  try {
    localStorage.setItem(LAST_RUN_KEY, JSON.stringify(snapshot));
  } catch (e) {
    console.error('Letzte Übung konnte nicht gespeichert werden', e);
  }
}

// Snapshot laden
function loadLastRun() {
  try {
    const raw = localStorage.getItem(LAST_RUN_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    console.error('Letzte Übung konnte nicht geladen werden', e);
    return null;
  }
}

// Snapshot löschen (z.B. wenn du mal aufräumen willst)
function clearLastRun() {
  try {
    localStorage.removeItem(LAST_RUN_KEY);
  } catch (e) {}
}
