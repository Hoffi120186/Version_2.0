// /coop-bridge-ablage.js  (v3: event-forward only, coop-client compatible)
// Zweck:
// - coop-client.js pollt selbst und feuert: coop:changes
// - optional feuert coop-client.js: coop:snapshot (list_patients)
// Diese Bridge reicht beides konsistent an deine Ablage-Logik weiter.

(function () {
  "use strict";

  const VER = "coop-bridge-ablage-v3";
  if (window.__COOP_BRIDGE_VER__ === VER) return;
  window.__COOP_BRIDGE_VER__ = VER;

  const DEBUG = true;
  const log  = (...a) => DEBUG && console.log("[COOP-BRIDGE]", ...a);
  const warn = (...a) => console.warn("[COOP-BRIDGE]", ...a);

  // Hilfs-Fire: wir schicken IMMER coop:changes weiter,
  // damit deine ablage.js / applyChanges-Logik nur EINEN Eingang hat.
  function forwardAsChanges(rows, source) {
    try {
      const changes = Array.isArray(rows) ? rows : [];
      if (!changes.length) return;
      window.dispatchEvent(new CustomEvent("coop:changes", { detail: { changes, source } }));
      log("forward -> coop:changes", source, changes.length);
    } catch (e) {
      warn("forward failed", e);
    }
  }

  // 1) Wenn coop-client Änderungen liefert:
  window.addEventListener("coop:changes", (ev) => {
    // Achtung: das ist bereits coop:changes.
    // Wir lassen es durch (oder duplizieren nicht).
    // Optional: Wenn du hier zusätzlich einen "Refresh" triggern willst:
    try {
      // Refresh-Hinweis an Ablage UI (optional)
      new BroadcastChannel("ablage").postMessage({ type: "refresh", reason: "coop_changes" });
    } catch {}
  });

  // 2) Snapshot aus coop-client (list_patients) -> in changes umwandeln
  window.addEventListener("coop:snapshot", (ev) => {
    const patients = ev?.detail?.patients || [];
    forwardAsChanges(patients, "snapshot");
    try {
      new BroadcastChannel("ablage").postMessage({ type: "refresh", reason: "coop_snapshot" });
    } catch {}
  });

  // 3) Optional: beim Restore/Join einmal Snapshot anstoßen (wenn coop-client es exportiert)
  async function trySnapshot(reason) {
    try {
      if (window.Coop && typeof window.Coop.fetchSnapshotOnce === "function") {
        await window.Coop.fetchSnapshotOnce();
        log("snapshot requested", reason);
      }
    } catch (e) {
      warn("snapshot request failed", reason, e);
    }
  }

  window.addEventListener("coop:created",  () => trySnapshot("created"));
  window.addEventListener("coop:joined",   () => trySnapshot("joined"));
  window.addEventListener("coop:restored", () => trySnapshot("restored"));

  // Beim Laden (falls Session schon da ist)
  window.addEventListener("load", () => trySnapshot("load"));
})();
