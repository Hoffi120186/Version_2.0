// /coop-client.js (SHIM) – lädt die echte Engine /coop.js nach
(function(){
  "use strict";
  if (window.Coop && typeof window.Coop.enable === "function") return;

  const s = document.createElement("script");
  s.src = "/coop.js?v=2026-01-31-A";
  s.defer = true;
  s.onload = () => {
    try { window.dispatchEvent(new CustomEvent("coop:shim_loaded")); } catch {}
  };
  s.onerror = () => console.warn("[COOP] shim could not load /coop.js");
  document.head.appendChild(s);
})();
