// freigabe.js – ADMIN/BYPASS Version (nur für deine Netlify-Spiegelung)
// Zweck: keine Key-Abfrage, App läuft "scharf" lokal/offline.

console.log("✅ freigabe.js ADMIN-BYPASS aktiv");

(function () {
  const now = Date.now();

  // 1) LocalStorage-Fallbacks (falls irgendwo abgefragt)
  try {
    localStorage.setItem("license_key", "ADMIN-NETLIFY");
    localStorage.setItem("lizenz", "ADMIN-NETLIFY");
    localStorage.setItem("license", "ADMIN-NETLIFY");
    localStorage.setItem("license_valid", "true");
    localStorage.setItem("freigabe_ok", "true");

    // optional: sehr lang gültig
    localStorage.setItem("license_expires", String(now + 1000 * 60 * 60 * 24 * 365 * 10)); // 10 Jahre
  } catch (e) {}

  // 2) IndexedDB/Store-Bypass: wir "simulieren" eine gespeicherte Lizenz
  // Falls dein Service Worker per postMessage oder Cache DB erwartet:
  try {
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: "LICENSE_SET",
        license: {
          key: "ADMIN-NETLIFY",
          status: "active",
          expires: now + 1000 * 60 * 60 * 24 * 365 * 10,
          source: "admin-bypass"
        }
      });
    }
  } catch (e) {}

  // 3) Optional: Wenn dein freigabe.js normalerweise ein Modal/Prompt öffnet,
  // sorgen wir dafür, dass nichts aufpoppt, indem wir ein globales Flag setzen:
  window.__LICENSE_BYPASS__ = true;
})();
