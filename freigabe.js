// freigabe.js — FINAL SAFE VERSION 2025-11-22-RETRY
// Lizenz-Flow mit SW-Sync (token, device_id, valid_until) + Soft-Mode
// Server-API: https://1rettungsmittel.de/license.php

console.log("✅ freigabe.js aktiv");

// ===== Globaler Lizenz-Ready-Trigger =====
window.__licenseReady = new Promise((resolve) => {
  window.__resolveLicenseReady = resolve;
});
function finalizeLicenseState(ok, meta = {}) {
  try {
    localStorage.setItem('LICENSE_OK', ok ? '1' : '0');
    localStorage.setItem('LICENSE_META', JSON.stringify(meta));
  } catch {}

  if (window.__resolveLicenseReady) {
    window.__resolveLicenseReady({ ok, meta });
    window.__resolveLicenseReady = null;
  }
}

// ===== Server-Endpunkt =====
const LICENSE_API = "https://1rettungsmittel.de/license.php";

// ===== DEV-BYPASS =====
function isDevHost(){ const h=location.hostname.toLowerCase(); return h==='localhost'||h==='127.0.0.1'||h==='::1'; }
function hasDevParam(){ return new URLSearchParams(location.search).get('dev')==='1'; }
function hasDevFlag(){ try{ return localStorage.getItem('DEV_BYPASS')==='1'; }catch{ return false; } }
function showDevRibbon(){
  const s=document.createElement('div');
  s.textContent='DEV-MODUS (Lizenzprüfung übersprungen)';
  s.style.cssText='position:fixed;right:8px;bottom:8px;z-index:99999;padding:6px 10px;border-radius:10px;background:#222;color:#fff;font:12px;opacity:.85';
  document.addEventListener('DOMContentLoaded',()=>document.body.appendChild(s));
}
const DEV_BYPASS = isDevHost() || hasDevParam() || hasDevFlag();
if (DEV_BYPASS){
  try{ localStorage.setItem('hasLaunchedStandalone','1'); }catch{}
  console.log('[freigabe] DEV_BYPASS aktiv');
  showDevRibbon();
}

// ===== Browser-Modus =====
function allowBrowserMode(){ try{ return localStorage.getItem('ALLOW_BROWSER')==='1'; }catch{return false;} }
function enableBrowserMode(){ try{ localStorage.setItem('ALLOW_BROWSER','1'); }catch{} }
function disableBrowserMode(){ try{ localStorage.removeItem('ALLOW_BROWSER'); }catch{} }

// ===== Service Worker Helper =====
async function swReady(){
  if (!('serviceWorker' in navigator)) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg?.active || null;
}

async function swGetLicense(){
  const sw = await swReady(); if(!sw) return null;
  return await new Promise(res=>{
    const onMsg = e=>{
      if (e.data?.type === 'LICENSE_VALUE'){
        navigator.serviceWorker.removeEventListener('message', onMsg);
        res(e.data.payload || null);
      }
    };
    navigator.serviceWorker.addEventListener('message', onMsg);
    sw.postMessage({ type:'GET_LICENSE' });

    // 🔧 Timeout erhöht (kaltstart + SW-Update)
    setTimeout(()=>{
      navigator.serviceWorker.removeEventListener('message', onMsg);
      res(null);
    }, 3000);
  });
}

async function swSetLicense(payload){
  const sw=await swReady(); if(!sw) return;
  sw.postMessage({ type:'SET_LICENSE', payload });
}

// ===== Lokaler Spiegel =====
const KEY_GESPERRT="appGesperrt";
const KEY_BIS="freigabeBis";
const KEY_TOKEN="license_token";
const CACHE_NAME="freigabe-cache";
const CACHE_URL="/freigabe";

function parseMillis(v){
  if(v==null) return 0;
  if(typeof v==='number') return v;
  const s=String(v).trim();
  if(/^\d+$/.test(s)) return s.length<=10?Number(s)*1000:Number(s);
  const t=Date.parse(s);
  return Number.isFinite(t)?t:0;
}

function getFreigabeBis(){ return parseMillis(localStorage.getItem(KEY_BIS)); }
function setFreigabe(bisMs){
  localStorage.setItem(KEY_GESPERRT,'false');
  localStorage.setItem(KEY_BIS,String(bisMs));
}
function getToken(){ try{ return localStorage.getItem(KEY_TOKEN)||''; }catch{ return ''; } }
function setToken(t){ try{ localStorage.setItem(KEY_TOKEN,t); }catch{} }

async function writeCache(obj){
  try{
    const c=await caches.open(CACHE_NAME);
    await c.put(CACHE_URL,new Response(JSON.stringify(obj),{
      headers:{'Content-Type':'application/json'}
    }));
  }catch{}
}
async function readCache(){
  try{
    const c=await caches.open(CACHE_NAME);
    const r=await c.match(CACHE_URL);
    return r?await r.json():null;
  }catch{ return null; }
}
async function clearCache(){
  try{
    const c=await caches.open(CACHE_NAME);
    await c.delete(CACHE_URL);
  }catch{}
}

// ===== Utilities =====
const RENEW_URL='https://1rettungsmittel.de/';
const CHECK_MS=30_000;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const isStandalone=()=> window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone===true;
function fmt(ts){ return ts? new Date(Number(ts)).toLocaleString(): '–'; }
function normToken(inp){ return (inp||'').toUpperCase().replace(/[^A-Z0-9]/g,''); }

// ===== DeviceID =====
async function deriveDeviceId(){
  const nav=navigator, scr=screen;
  const parts=[
    nav.userAgent||'', nav.platform||'',
    (nav.language||'')+'|'+(nav.languages||[]).join(','),
    String(nav.hardwareConcurrency||''), String(nav.deviceMemory||''),
    String(nav.maxTouchPoints||''), `${scr.width}x${scr.height}@${scr.colorDepth||scr.pixelDepth||''}`,
    String(new Date().getTimezoneOffset())
  ].join('§');
  const buf=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(parts));
  return Array.from(new Uint8Array(buf))
    .map(b=>b.toString(16).padStart(2,'0'))
    .join('')
    .slice(0,32);
}
async function getDeviceId(){
  let id=null;
  try{ id=localStorage.getItem('device_id')||null; }catch{}
  if(id) return id;
  id=await deriveDeviceId();
  try{ localStorage.setItem('device_id',id);}catch{}
  return id;
}

// ===== Soft-Mode für bestimmte Seiten =====
const PATH=location.pathname.toLowerCase();
const OPEN_PAGES=new Set(['/auswertung.html','/offline.html']);
function isOpenPage(){ return OPEN_PAGES.has(PATH); }

// ===== UI: Install-Overlay =====
let deferredInstallPrompt=null;
addEventListener('beforeinstallprompt',e=>{ e.preventDefault(); deferredInstallPrompt=e; });

function showInstallOverlay(){
  if (DEV_BYPASS) return;
  document.documentElement.classList.add('needs-install');
  const wrap=document.createElement('div');
  wrap.id='install-overlay';
  wrap.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.78);z-index:99999;display:flex;align-items:center;justify-content:center;';
  wrap.innerHTML=`
  <div style="background:#fff;color:#000;border-radius:14px;padding:22px;width:min(92vw,560px);box-shadow:0 10px 30px rgba(0,0,0,.4);">
    <h2 style="margin:0 0 8px">Bevor es losgeht</h2>
    <p style="margin:0 0 12px">Bitte installiere die App und starte sie <b>vom Homescreen</b>. Danach gib dein Passwort ein.</p>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin:10px 0 6px">
      <button id="installBtn" style="padding:10px 16px;border-radius:10px;border:none;background:#0B5FFF;color:#fff;cursor:pointer;">Jetzt installieren</button>
      <a href="${RENEW_URL}" style="align-self:center;text-decoration:underline;">Hilfe / Kaufen</a>
    </div>
    <div style="margin-top:10px;font-size:14px;opacity:.85">
      <details><summary><b>iOS (Safari)</b>: „Teilen“ → <i>Zum Home-Bildschirm</i></summary><div style="margin-top:6px">Starte danach die App vom neuen Icon aus.</div></details>
      <details style="margin-top:6px"><summary><b>Android (Chrome)</b>: Menü ⋮ → <i>App installieren</i></summary><div style="margin-top:6px">Nach Installation die App öffnen, dann Passwort eingeben.</div></details>
    </div>
    <hr style="margin:14px 0;border:none;border-top:1px solid #eee">
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <button id="browserBtn" style="padding:8px 12px;border-radius:10px;border:1px solid #ccc;background:#fff;color:#000;cursor:pointer;font-size:14px">Im Browser fortfahren</button>
      <span style="font-size:12px;opacity:.75">Nur für Desktop/Tests. Funktioniert ohne Homescreen-Icon.</span>
    </div>
  </div>`;
  document.body.appendChild(wrap);

  document.getElementById('installBtn')?.addEventListener('click', async ()=>{
    if (deferredInstallPrompt){
      deferredInstallPrompt.prompt();
      try{ await deferredInstallPrompt.userChoice; }catch{}
      deferredInstallPrompt=null;
    } else {
      alert('Auf iOS bitte über das Teilen-Menü „Zum Home-Bildschirm“ wählen.');
    }
  });

  document.getElementById('browserBtn')?.addEventListener('click', ()=>{
    const ok=confirm('Browser-Version verwenden?\n\nEmpfohlen ist die Installation als App.\nFortfahren im Browser?');
    if(!ok) return;
    enableBrowserMode();
    wrap.remove();
    lockUI(null);
  });
}

// ===== UI-Lock =====
let lockEl=null;
function lockUI(lic){
  if (DEV_BYPASS) return;
  if(lockEl) return;
  lockEl=document.createElement('div');
  lockEl.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.78);z-index:99998;display:flex;align-items:center;justify-content:center;';
  lockEl.innerHTML=`
    <div style="background:#fff;color:#000;border-radius:14px;padding:22px;width:min(92vw,520px);box-shadow:0 10px 30px rgba(0,0,0,.4);text-align:center;">
      <h2 style="margin:0 0 8px">App gesperrt</h2>
      <p style="margin:0 0 6px">Der Zeitraum ist abgelaufen oder noch nicht aktiviert.</p>
      <p style="margin:0 0 16px;font-size:14px;opacity:.8">Gültig bis: <b>${fmt(lic?.valid_until)}</b></p>
      <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">
        <input type="password" id="pwInput" placeholder="Passwort eingeben" style="flex:1 1 220px;padding:10px;border:1px solid #ccc;border-radius:10px;">
        <button id="pwBtn" style="padding:10px 16px;border-radius:10px;border:none;background:#0B5FFF;color:#fff;cursor:pointer;">Freischalten</button>
      </div>
      <div style="margin-top:14px;">
        <a id="renewLink" href="https://1rettungsmittel.de/shop.html" style="text-decoration:underline;">Jetzt kaufen / verlängern</a>
      </div>
    </div>
  `;
  document.body.appendChild(lockEl);
  document.getElementById('pwBtn')?.addEventListener('click', pruefePasswort);
}
function unlockUI(){ lockEl?.remove(); lockEl=null; }

// ===== Ablauf-Wächter =====
let expiryTimeoutId=null;
function scheduleExpiryAlarm(){
  if(expiryTimeoutId) clearTimeout(expiryTimeoutId);
  const bis=getFreigabeBis(); if(!bis) return;
  const delay=Math.max(0,bis-Date.now()+250);
  expiryTimeoutId=setTimeout(()=> enforce(),delay);
}

// ===== KERNPRÜFUNG =====
async function enforce(){
  const jetzt=Date.now();
  const bis=getFreigabeBis();
  const hatFlag=localStorage.getItem(KEY_GESPERRT);
  let token=getToken();

  // ======================================================
  // 🔥 TOKEN / VALID_UNTIL AUS SW RESTAURIEREN (mit Retry)
  // ======================================================
  if (!token){
    const tries = [0, 500, 1200]; // ms Backoff
    for (const waitMs of tries){
      if (waitMs) await sleep(waitMs);

      const swLic = await swGetLicense(); // {token, valid_until}
      if (swLic?.token){
        const vs = parseMillis(swLic.valid_until);
        if (vs && Date.now() <= vs){
          console.log("[freigabe] 🔄 Restore Token aus SW (wait=", waitMs, "):", swLic.token);
          setToken(swLic.token);
          setFreigabe(vs);
          await writeCache({ appGesperrt:false, freigabeBis:vs });
          token = swLic.token;
          break;
        } else {
          await swSetLicense(null);
        }
      }
      if (token) break;
    }
  }

  // ===== Nach Restore checken =====
  if (!token){
    localStorage.setItem(KEY_GESPERRT,'true');
    localStorage.setItem(KEY_BIS,'0');
    await clearCache();
    await swSetLicense(null);

    if(!isOpenPage()) lockUI(null); else unlockUI();
    finalizeLicenseState(false,{reason:"no_token"});
    return false;
  }

  // ===== Cache-Wiederherstellung =====
  const shouldTryRestore=(!bis||hatFlag===null||hatFlag==='true');
  if(shouldTryRestore){
    const cached=await readCache();
    if(cached){
      const cachedBis=parseMillis(cached.freigabeBis);
      if(cached.appGesperrt===false && cachedBis && jetzt<=cachedBis){
        setFreigabe(cachedBis);
        scheduleExpiryAlarm();
        const dev=await getDeviceId();
        await swSetLicense({token,device_id:dev,valid_until:cachedBis});
      } else {
        await clearCache();
      }
    }
  }

  const bis2=getFreigabeBis();
  const gesperrt=localStorage.getItem(KEY_GESPERRT)==='true';

  // ===== Lokal abgelaufen =====
  if(gesperrt || (bis2 && Date.now()>bis2)){
    localStorage.setItem(KEY_GESPERRT,'true');
    localStorage.removeItem(KEY_BIS);
    await clearCache();
    await swSetLicense(null);

    if(!isOpenPage()){
      lockUI(await swGetLicense());
      finalizeLicenseState(false,{reason:"local_expired",valid_until:bis2||0});
      return false;
    } else {
      console.warn("[freigabe] Soft-Mode: Lizenz abgelaufen – Auswertung bleibt sichtbar.");
      unlockUI();
      finalizeLicenseState(true,{soft_mode:true,valid_until:bis2||0});
      return true;
    }
  }

  // ===== Servercheck =====
  try{
    const deviceId=await getDeviceId();
    const form=new URLSearchParams();
    form.set('action','check');
    form.set('token',token);
    form.set('device_id',deviceId);

    const r=await fetch(LICENSE_API,{
      method:'POST',
      headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:form,
      cache:'no-store'
    });

    if(r.ok){
      const data=await r.json();
      const vs=parseMillis(data?.valid_until);

      if(!data.ok || !vs || vs<=Date.now()){
        await sperreLokal();
        await swSetLicense(null);
        if(!isOpenPage()) lockUI(null); else unlockUI();
        finalizeLicenseState(false,{reason:data?.reason||"server_invalid",valid_until:vs||0});
        return false;
      } else {
        if(vs !== bis2){
          setFreigabe(vs);
          await writeCache({appGesperrt:false,freigabeBis:vs});
        }
        await swSetLicense({
          token,
          device_id:deviceId,
          valid_until:vs,
          license_version:(data?.license_version??0)
        });
      }
    }
  }catch{
    // offline -> lokale Gültigkeit reicht
  }

  scheduleExpiryAlarm();
  const dev2=await getDeviceId();
  await swSetLicense({token,device_id:dev2,valid_until:getFreigabeBis()});
  unlockUI();

  finalizeLicenseState(true,{token:getToken(),valid_until:getFreigabeBis()});
  return true;
}

// ===== Lokale Vollsperre =====
async function sperreLokal(){
  localStorage.setItem(KEY_GESPERRT,'true');
  localStorage.removeItem(KEY_BIS);
  await clearCache();
}

// ===== Passwortprüfung =====
async function pruefePasswort(){
  const eingabe=document.getElementById('pwInput')?.value||'';
  const t=normToken(eingabe);
  if(!t) return alert("Bitte einen Lizenzschlüssel eingeben.");
  if(!navigator.onLine){ alert("Keine Internetverbindung."); return; }

  try{
    const deviceId=await getDeviceId();
    const form=new URLSearchParams();
    form.set('action','check');
    form.set('token',t);
    form.set('device_id',deviceId);

    const res=await fetch(LICENSE_API,{
      method:'POST',
      headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:form,
      cache:'no-store'
    });

    if(!res.ok) throw new Error("HTTP "+res.status);

    const data=await res.json();
    if(data && data.ok && data.valid_until){
      const bis=parseMillis(data.valid_until);
      if(!bis || bis<=Date.now()) return alert("❌ Lizenz abgelaufen.");

      setToken(t);
      setFreigabe(bis);
      await writeCache({appGesperrt:false,freigabeBis:bis});
      await swSetLicense({
        token:t,
        device_id:deviceId,
        valid_until:bis,
        license_version:(data?.license_version??0)
      });
      scheduleExpiryAlarm();
      alert("✅ Freigabe erfolgreich!");
      location.reload();
      return;
    }

    if(data?.reason==="bound_elsewhere") alert("❌ Lizenz ist an ein anderes Gerät gebunden.");
    else if(data?.reason==="expired") alert("❌ Lizenz abgelaufen.");
    else if(data?.reason==="not_found") alert("❌ Lizenz nicht gefunden.");
    else alert("❌ Lizenz ungültig.");
  }catch(err){
    console.error(err);
    alert("Fehler bei der Serververbindung.");
  }
}

// ===== App-Install =====
addEventListener('appinstalled',()=>{ try{ localStorage.setItem('hasLaunchedStandalone','1'); }catch{} location.reload(); });

// ===== INIT =====
(function init(){
  if(DEV_BYPASS){
    unlockUI();
    finalizeLicenseState(true,{dev_bypass:true});
    return;
  }

  const url=new URL(location.href);
  const urlToken=normToken(url.searchParams.get('token'));
  const standalone=isStandalone();

  if(!standalone && !allowBrowserMode() && localStorage.getItem(KEY_GESPERRT)!=='false'){
    if(urlToken){
      try{ localStorage.setItem('pendingToken',urlToken);}catch{}
      url.searchParams.delete('token');
      history.replaceState({},'',url.toString());
    }
    showInstallOverlay();
    finalizeLicenseState(false,{reason:"needs_install"});
    return;
  }

  if(standalone){
    try{ localStorage.setItem('hasLaunchedStandalone','1'); }catch{}
    const prefill=urlToken||localStorage.getItem('pendingToken');
    if(prefill){
      localStorage.removeItem('pendingToken');
      const iv=setInterval(()=>{
        const inp=document.getElementById('pwInput');
        if(inp){ inp.value=prefill; inp.select(); clearInterval(iv);}
      },100);
      const u=new URL(location.href); u.searchParams.delete('token'); history.replaceState({},'',u.toString());
    }
  }

  enforce();
  setInterval(()=> enforce(), CHECK_MS);
  document.addEventListener('visibilitychange',()=>{ if(!document.hidden) enforce(); });
  window.addEventListener('pageshow',()=> enforce());
  window.addEventListener('focus',()=> enforce());
  ['click','touchstart','pointerdown','keydown','scroll']
    .forEach(evt=>window.addEventListener(evt,()=> enforce(),{passive:true}));

  window.__FREIGABE_OK__=true;
})();
