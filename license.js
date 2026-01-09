// /assets/js/license.js
export function swReady() {
  return new Promise((resolve) => {
    if (navigator.serviceWorker?.controller) return resolve();
    navigator.serviceWorker?.ready.then(() => resolve());
  });
}

export async function getLicense() {
  await swReady();
  return new Promise((resolve) => {
    const onMsg = (ev) => {
      if (ev.data?.type === 'LICENSE_VALUE') {
        navigator.serviceWorker.removeEventListener('message', onMsg);
        resolve(ev.data.payload);
      }
    };
    navigator.serviceWorker.addEventListener('message', onMsg);
    navigator.serviceWorker.controller?.postMessage({ type: 'GET_LICENSE' });
    setTimeout(() => {
      navigator.serviceWorker.removeEventListener('message', onMsg);
      resolve(null);
    }, 1500);
  });
}

export async function setLicense(payload) {
  await swReady();
  navigator.serviceWorker.controller?.postMessage({ type: 'SET_LICENSE', payload });
}

/* =====================================================
   NEU: Server-Heartbeat – prüft regelmäßig, ob Lizenz
   noch gültig/aktiv ist (blockt sofort bei Sperrung)
   ===================================================== */
export async function heartbeatLoop(token, deviceId) {
  async function ping() {
    try {
      const res = await fetch('https://1rettungsmittel.de/license.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          action: 'heartbeat',
          token,
          device_id: deviceId
        })
      });
      const data = await res.json();

      // Wenn der Server "nicht ok" zurückgibt → sperren
      if (!data.ok) {
        alert('❌ Diese Lizenz ist gesperrt oder abgelaufen.\nBitte neu aktivieren.');
        // optional alles blockieren oder Startseite laden
        window.location.href = '/index.html';
      }
    } catch (err) {
      console.warn('Heartbeat-Fehler:', err);
    }
  }

  // Sofort prüfen + danach alle 90 Sekunden wiederholen
  await ping();
  setInterval(ping, 90 * 1000);
}
