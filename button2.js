/* button2.js — FINAL (pending commit on btn4)
   Verhalten:
   - SK + Toggles bleiben sichtbar, bis btn4 geklickt wird
   - SK/Transport/B kann jederzeit geändert werden
   - Gespeichert wird erst beim Klick auf btn4 (letzte Auswahl zählt)
*/

(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  // -------- Pending State (wird erst bei btn4 gespeichert) --------
  let pendingPatientId = null;
  let pendingSichtung = null;        // "rot" | "gelb" | "grün" | "schwarz"
  let pendingTransportPrio = null;   // "ja" | "nein" | null
  let pendingNurBetroffen = null;    // "ja" | "nein" | null

  // ---------- Helpers ----------
  function hardHide(el) {
    if (!el) return;
    el.classList.add("hidden");
    el.style.display = "none";
  }

  function show(el) {
    if (!el) return;
    el.classList.remove("hidden");
    el.style.display = ""; // zurück zu CSS
  }

  function clearSelected(selector) {
    $$(selector).forEach((b) => b.classList.remove("selected"));
  }

  function hideFlowButtonsOnly() {
    // Nur die großen "Flow"-Buttons verstecken (SK + Toggles bleiben extra steuerbar)
    $$(".btn").forEach(hardHide);
  }

  function toggleButtons(currentId, nextId) {
    // Flow wechseln
    hideFlowButtonsOnly();

    const next = $(nextId);
    if (!next) {
      console.warn("toggleButtons: next element not found:", nextId);
      return;
    }
    show(next);

    // Sobald btn4 sichtbar ist: SK-Buttons sichtbar lassen
    if (nextId === "btn4") {
      show($("sk-btns"));
      // Toggles entsprechend der (aktuellen) pendingSichtung setzen:
      renderTogglesForPending();
      renderToggleSelectedUI();
    }
  }

  // ---------- Countdown ----------
  const countdownIntervals = {};

  function startCountdown(buttonId, countdownId, nextButtonId, seconds) {
    const btn = $(buttonId);
    const countdownElement = $(countdownId);

    if (!btn || !countdownElement) {
      console.warn("startCountdown: missing elements", { buttonId, countdownId });
      return;
    }

    if (countdownIntervals[buttonId]) {
      clearInterval(countdownIntervals[buttonId]);
      delete countdownIntervals[buttonId];
    }

    let timeLeft = Number(seconds);
    countdownElement.style.visibility = "visible";
    countdownElement.innerText = String(timeLeft);
    btn.disabled = true;

    countdownIntervals[buttonId] = setInterval(() => {
      timeLeft -= 1;
      countdownElement.innerText = String(timeLeft);

      if (timeLeft <= 0) {
        clearInterval(countdownIntervals[buttonId]);
        delete countdownIntervals[buttonId];
        btn.disabled = false;
        toggleButtons(buttonId, nextButtonId);
      }
    }, 1000);
  }

  // ---------- Modal ----------
  function openModal() {
    const modal = $("modal");
    if (modal) modal.style.display = "flex";
  }

  function closeModal() {
    const modal = $("modal");
    if (modal) modal.style.display = "none";
  }

  // ---------- QR Scan ----------
  async function startCameraAndScan() {
    const btn4 = $("btn4");
    const videoElement = $("video");

    if (btn4) btn4.style.display = "none";

    if (!navigator.mediaDevices?.getUserMedia) {
      alert("Die Kamera-API wird von diesem Gerät nicht unterstützt.");
      return;
    }
    if (!videoElement) {
      alert("Video-Element nicht gefunden.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" }
      });

      videoElement.srcObject = stream;
      videoElement.style.display = "block";

      videoElement.onloadedmetadata = () => {
        videoElement.play().catch(() => {});
        startQRCodeDetection(videoElement);
      };
    } catch (error) {
      console.error("Kamera-Zugriff fehlgeschlagen:", error);
      alert("Kamera-Zugriff fehlgeschlagen. Bitte Berechtigungen prüfen.");
    }
  }

  function startQRCodeDetection(videoElement) {
    if (typeof window.jsQR !== "function") {
      console.warn("jsQR nicht gefunden. QR-Scan startet nicht.");
      return;
    }

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    function scan() {
      if (!videoElement || videoElement.paused || videoElement.ended) return;

      const vw = videoElement.videoWidth;
      const vh = videoElement.videoHeight;
      if (!vw || !vh) return requestAnimationFrame(scan);

      canvas.width = vw;
      canvas.height = vh;
      ctx.drawImage(videoElement, 0, 0, vw, vh);

      const imageData = ctx.getImageData(0, 0, vw, vh);
      const code = window.jsQR(imageData.data, vw, vh);

      if (code?.data) {
        window.location.href = code.data;
        return;
      }

      requestAnimationFrame(scan);
    }

    scan();
  }

  // ---------- Toggles render / UI ----------
  function renderTogglesForPending() {
    const transportToggle = $("transportToggle");
    const affectedToggle = $("affectedToggle");

    // Standard: aus
    hardHide(transportToggle);
    hardHide(affectedToggle);

    if (pendingSichtung === "rot") {
      show(transportToggle);
      // Wenn man zu rot wechselt, "Nur Betroffen" resetten
      pendingNurBetroffen = null;
      clearSelected("#affectedToggle .sk-btn");
    } else if (pendingSichtung === "grün" || pendingSichtung === "gruen") {
      show(affectedToggle);
      // Wenn man zu grün wechselt, Transportprio resetten
      pendingTransportPrio = null;
      clearSelected("#transportToggle .sk-btn");
    } else {
      // gelb/schwarz => beides resetten
      pendingTransportPrio = null;
      pendingNurBetroffen = null;
      clearSelected("#transportToggle .sk-btn");
      clearSelected("#affectedToggle .sk-btn");
    }
  }

  function renderToggleSelectedUI() {
    // Markiere die Toggle-Buttons je nach pending state (falls du .selected nutzt)
    const tYes = $("t-yes");
    const tNo = $("t-no");
    const bYes = $("b-yes");
    const bNo = $("b-no");

    if (tYes && tNo) {
      tYes.classList.toggle("selected", pendingTransportPrio === "ja");
      tNo.classList.toggle("selected", pendingTransportPrio === "nein");
    }
    if (bYes && bNo) {
      bYes.classList.toggle("selected", pendingNurBetroffen === "ja");
      bNo.classList.toggle("selected", pendingNurBetroffen === "nein");
    }
  }

  // ---------- Commit (erst bei btn4) ----------
  function commitSelectionToStorage() {
    if (!pendingPatientId || !pendingSichtung) {
      // Wenn noch keine SK gewählt wurde, speichern wir nichts
      return;
    }

    // SK
    localStorage.setItem(`sichtung_${pendingPatientId}`, pendingSichtung);
    localStorage.setItem("sichtung", pendingSichtung);

    // Transport / Betroffen nur speichern, wenn relevant gesetzt
    // (Optional: auch pro Patient speichern – das ist meist sinnvoll)
    if (pendingSichtung === "rot") {
      if (pendingTransportPrio) {
        localStorage.setItem(`transportprio_${pendingPatientId}`, pendingTransportPrio);
      } else {
        localStorage.removeItem(`transportprio_${pendingPatientId}`);
      }
      // grün-relevante entfernen
      localStorage.removeItem(`nur_betroffen_${pendingPatientId}`);
    } else if (pendingSichtung === "grün" || pendingSichtung === "gruen") {
      if (pendingNurBetroffen) {
        localStorage.setItem(`nur_betroffen_${pendingPatientId}`, pendingNurBetroffen);
      } else {
        localStorage.removeItem(`nur_betroffen_${pendingPatientId}`);
      }
      // rot-relevante entfernen
      localStorage.removeItem(`transportprio_${pendingPatientId}`);
    } else {
      // gelb/schwarz -> beides weg
      localStorage.removeItem(`transportprio_${pendingPatientId}`);
      localStorage.removeItem(`nur_betroffen_${pendingPatientId}`);
    }
  }

  // ---------- SK + Toggle Binding ----------
  function bindSkAndToggles() {
    const skWrap = $("sk-btns");
    if (!skWrap) return;

    // Nur echte SK-Buttons (mit data-sichtung)
    const skButtons = $$("#sk-btns .sk-btn[data-sichtung]");
    if (!skButtons.length) return;

    // SK Buttons: nur pending setzen + UI/Toggle aktualisieren
    skButtons.forEach((button) => {
      button.addEventListener("click", function () {
        skButtons.forEach((b) => b.classList.remove("selected"));
        this.classList.add("selected");

        const raw = (this.getAttribute("data-sichtung") || "").toLowerCase();
        pendingSichtung = raw === "gruen" ? "grün" : raw;

        // patientId einmalig ermitteln/merken
        const pid = window.location.pathname.replace(/\D/g, "");
        pendingPatientId = pid || null;

        renderTogglesForPending();
        renderToggleSelectedUI();
      });
    });

    // Toggle Buttons: nur pending setzen
    $("t-yes")?.addEventListener("click", () => {
      pendingTransportPrio = "ja";
      renderToggleSelectedUI();
    });
    $("t-no")?.addEventListener("click", () => {
      pendingTransportPrio = "nein";
      renderToggleSelectedUI();
    });

    $("b-yes")?.addEventListener("click", () => {
      pendingNurBetroffen = "ja";
      renderToggleSelectedUI();
    });
    $("b-no")?.addEventListener("click", () => {
      pendingNurBetroffen = "nein";
      renderToggleSelectedUI();
    });
  }

  // ---------- Boot ----------
  document.addEventListener("DOMContentLoaded", () => {
    // PatientId initialisieren
    const pid = window.location.pathname.replace(/\D/g, "");
    pendingPatientId = pid || null;

    // Startzustand: hidden Elemente wirklich unsichtbar
    $$(".btn.hidden, #sk-btns.hidden, #transportToggle.hidden, #affectedToggle.hidden").forEach((el) => {
      el.style.display = "none";
    });

    const btn1 = $("btn1");
    const btn2 = $("btn2");
    const btnC1 = $("btnCountdown1");
    const btnC2 = $("btnCountdown2");
    const btnC3 = $("btnCountdown3");
    const btn3 = $("btn3");
    const btnCustom = $("btnCustom");
    const btn4 = $("btn4");

    if (!btn1 || !btn2) {
      console.warn("button2.js: btn1/btn2 nicht gefunden – IDs/HTML prüfen.");
      return;
    }

    // Flow
    btn1.addEventListener("click", () => toggleButtons("btn1", "btn2"));

    btn2.addEventListener("click", () => {
      toggleButtons("btn2", "btnCountdown1");
      show(btnC2);
      show(btnC3);
      openModal();
    });

    btnC1?.addEventListener("click", () => startCountdown("btnCountdown1", "countdown1", "btn3", 40));
    btnC2?.addEventListener("click", () => startCountdown("btnCountdown2", "countdown2", "btn3", 20));
    btnC3?.addEventListener("click", () => startCountdown("btnCountdown3", "countdown3", "btnCustom", 1));

    btn3?.addEventListener("click", () => toggleButtons("btn3", "btn4"));
    btnCustom?.addEventListener("click", () => toggleButtons("btnCustom", "btn4"));

    // Btninstruktor optional
    const container = $("button-container");
    if (container) {
      fetch("Btninstruktor.html")
        .then((r) => (r.ok ? r.text() : Promise.reject(r.status)))
        .then((html) => (container.innerHTML = html))
        .catch(() => {});
    }

    // Modal Close
    $("closeModal")?.addEventListener("click", closeModal);
    $("modal")?.addEventListener("click", (e) => {
      if (e.target === $("modal")) closeModal();
    });

    // SK/Toggles binden
    bindSkAndToggles();

    // btn4: ✅ erst COMMIT, dann Kamera/QR
    btn4?.addEventListener("click", () => {
      commitSelectionToStorage();
      startCameraAndScan();
    });
  });
})();
