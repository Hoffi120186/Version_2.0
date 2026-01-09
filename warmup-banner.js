// /warmup-banner.js
(function () {
  if (window.__warmupBannerInit) return;
  window.__warmupBannerInit = true;

  // ------- Styles einhängen -------
  const css = `
  .warmup-banner{
    position: fixed; inset: auto 0 12px 0;
    display: grid; place-items: center;
    pointer-events: none; z-index: 99999;
  }
  .warmup-banner .warmup-card{
    pointer-events: auto;
    width: min(92vw, 560px);
    border-radius: 14px;
    background: rgba(11,15,26,.9);
    color: #fff;
    border: 1px solid rgba(255,255,255,.12);
    box-shadow: 0 14px 36px rgba(0,0,0,.45);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    transform: translateY(12px);
    opacity: 0;
    transition: transform .18s ease, opacity .18s ease;
  }
  .warmup-banner.open .warmup-card{
    transform: translateY(0);
    opacity: 1;
  }
  .warmup-head{
    display:flex; align-items:center; justify-content:space-between;
    padding: 10px 12px; border-bottom: 1px solid rgba(255,255,255,.08);
  }
  .warmup-close{
    background: rgba(229,57,53,.95);
    color:#fff; border:0; border-radius:10px;
    font-size:18px; width:32px; height:32px; cursor:pointer;
    box-shadow: 0 6px 14px rgba(0,0,0,.25);
  }
  .warmup-body{ padding: 10px 12px 12px; }
  .warmup-line{
    display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;
    font-weight:700;
  }
  .warmup-bar{
    height:10px; border-radius:999px; overflow:hidden;
    background: rgba(255,255,255,.18); border:1px solid rgba(255,255,255,.12);
  }
  .warmup-bar-fill{
    height:100%;
    background: linear-gradient(135deg, #ff0000, #b30000);
    width:0%;
    transition: width .15s ease;
  }
  .warmup-note{ margin-top:8px; font-size:13px; opacity:.9; }
  `;

  const style = document.createElement('style');
  style.textContent = css;

  // ------- DOM einhängen -------
  const banner = document.createElement('div');
  banner.id = 'warmupBanner';
  banner.className = 'warmup-banner';
  banner.hidden = true;
  banner.setAttribute('aria-live', 'polite');

  banner.innerHTML = `
    <div class="warmup-card">
      <div class="warmup-head">
        <strong>App wird für Offline-Nutzung vorbereitet…</strong>
        <button type="button" class="warmup-close" data-wu-close aria-label="Hinweis schließen">×</button>
      </div>
      <div class="warmup-body">
        <div class="warmup-line">
          <span data-wu-phase>Vorbereitung</span>
          <span data-wu-count>0 / 0</span>
        </div>
        <div class="warmup-bar"><div class="warmup-bar-fill" style="width:0%"></div></div>
        <div class="warmup-note">Du kannst die App währenddessen normal benutzen.</div>
      </div>
    </div>
  `;

  function mount() {
    if (!document.head || !document.body) {
      document.addEventListener('DOMContentLoaded', mount, { once: true });
      return;
    }
    document.head.appendChild(style);
    document.body.appendChild(banner);
    wireUp();
  }

  // ------- Logik & Events -------
  function warmupDoneInSession() {
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith('WARMUP_DONE_') && sessionStorage.getItem(k)) return true;
    }
    return false;
  }

  function wireUp() {
    const bar   = banner.querySelector('.warmup-bar-fill');
    const count = banner.querySelector('[data-wu-count]');
    const phase = banner.querySelector('[data-wu-phase]');
    const close = banner.querySelector('[data-wu-close]');

    function show() {
      if (banner.hidden) {
        banner.hidden = false;
        requestAnimationFrame(() => banner.classList.add('open'));
      }
    }
    function hide() {
      banner.classList.remove('open');
      setTimeout(() => (banner.hidden = true), 200);
    }

    close.addEventListener('click', hide);

    // SW signalisiert: Grund-Precache fertig
    navigator.serviceWorker?.addEventListener?.('message', (ev) => {
      if (ev?.data?.type === 'PRECACHE_DONE') {
        phase.textContent = 'Basis geladen – lade Inhalte';
      }
    });

    // Warmup Fortschritt
    window.addEventListener('warmup:progress', (ev) => {
      if (warmupDoneInSession()) return;
      const d = ev.detail || {};
      const done  = Number(d.done || 0);
      const total = Math.max(1, Number(d.total || 0));
      const pct   = Math.min(100, Math.round((done / total) * 100));
      show();
      count.textContent = `${done} / ${total}`;
      bar.style.width = pct + '%';
    });

    // Warmup beendet
    window.addEventListener('warmup:done', () => {
      phase.textContent = 'Bereit für Offline';
      bar.style.width = '100%';
      setTimeout(hide, 800);
    });

    // Falls schon fertig → gar nicht anzeigen
    if (warmupDoneInSession()) {
      banner.remove();
    }
  }

  mount();
})();
