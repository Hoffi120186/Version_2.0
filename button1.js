// button1.js — robust (kein permanentes inline display:none, nach DOM laden)

(function () {
  if (window.__BTN1_WIRED) {
    console.warn('[button1] already wired');
    return;
  }
  window.__BTN1_WIRED = true;

  // ====== State ======
  const countdownIntervals = {};

  // ====== Helpers ======
  function getPatientIdSafe() {
    if (typeof window.__detectPatientIdFromPage === 'function') {
      const pid = window.__detectPatientIdFromPage();
      if (pid) return pid;
    }
    const n = (location.pathname.match(/\d{1,3}/) || [null])[0];
    return n ? ('patient' + n).toLowerCase() : null;
  }

  function normKat(v) {
    if (!v) return null;
    v = String(v).trim().toLowerCase();
    const map = {
      'sk1':'rot','sk 1':'rot','1':'rot','r':'rot','rot':'rot',
      'sk2':'gelb','sk 2':'gelb','2':'gelb','y':'gelb','gelb':'gelb',
      'sk3':'gruen','sk 3':'gruen','3':'gruen','g':'gruen','gruen':'gruen','grün':'gruen',
      'sk0':'schwarz','sk 0':'schwarz','0':'schwarz','b':'schwarz','schwarz':'schwarz','sk':'schwarz'
    };
    if (map[v]) return map[v];
    if (v.includes('grün')) v = v.replace('grün', 'gruen');
    return ['rot','gelb','gruen','schwarz'].includes(v) ? v : null;
  }

  // Show/Hide helpers — räumen inline display auf
  function showById(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('hidden');
    el.style.removeProperty('display'); // wichtig: inline display zurücknehmen
  }
  function hideById(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.add('hidden');
    // kein inline display setzen
  }

  // ====== Anzeige-Flow / Buttons ======
  function toggleButtons(currentButtonId, nextButtonId) {
    hideById(currentButtonId);
    showById(nextButtonId);
  }

  function startCountdown(buttonId, countdownId, nextButtonId, otherButtonId, seconds) {
    const btn    = document.getElementById(buttonId);
    const other  = document.getElementById(otherButtonId);
    const cEl    = document.getElementById(countdownId);

    if (!btn || !other || !cEl) return;

    let timeLeft = Number(seconds) || 0;
    cEl.style.visibility = 'visible';
    cEl.textContent = timeLeft;
    btn.disabled = true;
    other.disabled = true;

    // sofort fertig, wenn 0s
    if (timeLeft <= 0) {
      hideById(buttonId);
      hideById(otherButtonId);
      showById(nextButtonId);
      if (nextButtonId === 'btn4') {
        showById('sk-btns');
      }
      return;
    }

    countdownIntervals[buttonId] = setInterval(() => {
      timeLeft--;
      cEl.textContent = timeLeft;
      if (timeLeft <= 0) {
        clearInterval(countdownIntervals[buttonId]);
        hideById(buttonId);
        hideById(otherButtonId);
        showById(nextButtonId);
        if (nextButtonId === 'btn4') {
          showById('sk-btns');
        }
      }
    }, 1000);
  }

  function redirectToIndex() {
    window.location.href = '/status4.html';
  }

  function wireAfterDOM() {
    // ====== Event-Listener für die Text-/Flow-Buttons ======
    document.getElementById('btn1')?.addEventListener('click', () => {
      toggleButtons('btn1', 'btn2');
    });

    document.getElementById('btn2')?.addEventListener('click', () => {
      toggleButtons('btn2', 'btnCountdown1');
      showById('btnCountdown2');
      const modal = document.getElementById('modal');
      if (modal) modal.style.display = 'flex'; // Bild anzeigen
    });

    document.getElementById('btnCountdown1')?.addEventListener('click', () => {
      startCountdown('btnCountdown1', 'countdown1', 'btn3', 'btnCountdown2', 20);
    });

    document.getElementById('btnCountdown2')?.addEventListener('click', () => {
      startCountdown('btnCountdown2', 'countdown2', 'btnCustom', 'btnCountdown1', 0);
    });

    document.getElementById('btnCustom')?.addEventListener('click', function () {
      this.classList.add('hidden');
      showById('sk-btns');
      showById('btn4');
    });

    document.getElementById('btn3')?.addEventListener('click', () => {
      toggleButtons('btn3', 'btn4');
      showById('sk-btns');
    });

    // ====== QR-Scanner ======
    document.getElementById('btn4')?.addEventListener('click', async () => {
      const btn4 = document.getElementById('btn4');
      const videoElement = document.getElementById('video');
      if (!btn4 || !videoElement) return;

      try {
        btn4.style.display = 'none';

        if (!navigator.mediaDevices?.getUserMedia) {
          alert('Die Kamera-API wird von diesem Gerät nicht unterstützt.');
          return;
        }

        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        videoElement.srcObject = stream;
        videoElement.style.removeProperty('display');

        videoElement.onloadedmetadata = () => {
          videoElement.play();
          if (typeof jsQR !== 'function') {
            console.warn('[button1] jsQR nicht geladen – QR-Scan deaktiviert');
            return;
          }
          startQRCodeDetection();
        };
      } catch (error) {
        console.error('Kamera-Zugriff fehlgeschlagen:', error);
        alert('Kamera-Zugriff fehlgeschlagen. Bitte Berechtigungen prüfen.');
      }
    });

    function startQRCodeDetection() {
      const videoElement = document.getElementById('video');
      if (!videoElement) return;

      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');

      function scanQRCode() {
        if (videoElement.paused || videoElement.ended) return;

        canvas.width = videoElement.videoWidth || 640;
        canvas.height = videoElement.videoHeight || 360;
        context.drawImage(videoElement, 0, 0, canvas.width, canvas.height);

        try {
          const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(imageData.data, canvas.width, canvas.height);
          if (code?.data) {
            console.log('✅ QR-Code erkannt, Weiterleitung zu:', code.data);
            window.location.href = code.data;
            return;
          }
        } catch (e) {
          console.warn('[button1] QR-Scan Fehler:', e);
        }

        requestAnimationFrame(scanQRCode);
      }

      scanQRCode();
    }

    // ====== Modal schließen ======
    document.getElementById('closeModal')?.addEventListener('click', () => {
      const modal = document.getElementById('modal');
      if (modal) modal.style.display = 'none';
    });
    document.getElementById('modal')?.addEventListener('click', (e) => {
      const modal = document.getElementById('modal');
      if (e.target === modal) modal.style.display = 'none';
    });

    // ====== SK-Buttons: nur UI + zentraler Write via SKWriter ======
    (function wireSkButtonsOnce() {
      const pid = getPatientIdSafe();
      if (!pid) {
        console.warn('[button1] keine Patient-ID erkannt');
        return;
      }
      // 1) Scope nur auf SK-Container:
      const buttons = document.querySelectorAll('#sk-btns .sk-btn');
      if (!buttons.length) return;

      buttons.forEach(btn => {
        if (btn.__wired_btn1) return;
        btn.__wired_btn1 = true;

        // 2) Kein capture:
        btn.addEventListener('click', (ev) => {
          const raw =
            btn.getAttribute('data-sichtung') ||
            btn.getAttribute('data-sk') ||
            btn.getAttribute('data-category') ||
            btn.value ||
            btn.textContent;

          const k = (typeof SKWriter?.normKat === 'function') ? SKWriter.normKat(raw) : normKat(raw);
          if (!k) { console.warn('[button1] ungültige SK:', raw); return; }

          try { SKWriter?.setSK?.(pid, k); }
          catch (e) { console.warn('[button1] SKWriter.setSK fehlgeschlagen:', e); }

          document.querySelectorAll('#sk-btns .sk-btn').forEach(b => b.classList.remove('selected','is-active'));
          if (btn.classList.contains('sk-btn')) btn.classList.add('selected','is-active');

          // 3) Kein stopImmediatePropagation mehr
        });
      });
    })();
  } // wireAfterDOM

  // Nach DOM laden initialisieren
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireAfterDOM, { once: true });
  } else {
    wireAfterDOM();
  }
})();
