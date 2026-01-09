// netlify/functions/broadcast.js
const { getStore } = require('@netlify/blobs');
const webpush = require('web-push');

// --- Safe Store Helper ---
function store(name) {
  const opts = { name, consistency: 'strong' };
  if (process.env.NETLIFY_SITE_ID && process.env.NETLIFY_API_TOKEN) {
    opts.siteID = process.env.NETLIFY_SITE_ID;
    opts.token  = process.env.NETLIFY_API_TOKEN;
  }
  return getStore(opts);
}

const subsStore = store('push_subscriptions');
const msgStore  = store('push_messages');

// --- VAPID Keys ---
const vapidSubject = process.env.VAPID_SUBJECT || 'mailto:info@1rettungsmittel.de';
webpush.setVapidDetails(vapidSubject, process.env.VAPID_PUBLIC, process.env.VAPID_PRIVATE);

// --- Helper: kleine Hashfunktion für Geräte-Dedupe ---
function hashStr(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) + s.charCodeAt(i);
  return (h >>> 0).toString(36);
}
function endpointHost(endpoint) {
  try { return new URL(endpoint).host || ''; } catch { return ''; }
}

// --- Hauptfunktion ---
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST')
    return { statusCode: 405, body: 'Method Not Allowed' };

  const auth = event.headers.authorization || '';
  if (auth !== `Bearer ${process.env.ADMIN_BROADCAST_TOKEN}`)
    return { statusCode: 401, body: 'unauthorized' };

  let payload;
  try { payload = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, body: JSON.stringify({ ok: false, err: 'bad_json' }) }; }

  const { title = '', body: msg = '', url = '', segment = '', appId = 'prod' } = payload;
  const pushPayload = JSON.stringify({ title, body: msg, url });

  // --- ZUERST loggen (damit sie sofort sichtbar ist)
  const ts = Date.now();
  const id = String(ts);
  try {
    await msgStore.set(id, JSON.stringify({
      id, ts, title, body: msg, url, segment, appId,
      targets: 0, sent: 0, removed: 0, sender: '1Rettungsmittel'
    }));
  } catch {}

  // --- Subscriptions laden und deduplizieren ---
  const list = await subsStore.list();
  const blobs = list.blobs || [];

  const perDevice = new Map();
  for (const b of blobs) {
    const rec = await subsStore.get(b.key, { type: 'json' });
    const sub = rec?.subscription;
    if (!sub?.endpoint) continue;
    if (segment && rec?.profile?.licenseType !== segment) continue;
    if (rec?.appId && rec.appId !== appId) continue;

    const did = rec.deviceId ||
                rec?.profile?.deviceId ||
                hashStr((rec.ua || '') + '|' + endpointHost(sub.endpoint));

    const prev = perDevice.get(did);
    if (!prev || (rec.updatedAt || 0) > (prev.rec.updatedAt || 0)) {
      perDevice.set(did, { key: b.key, rec });
    }
  }

  const targets = perDevice.size;
  const pushOpts = { TTL: 0, urgency: 'high', contentEncoding: 'aes128gcm' };
  let sent = 0, removed = 0;
  const errors = [];

  // --- Push an jedes Ziel senden ---
  for (const { key, rec } of perDevice.values()) {
    try {
      await webpush.sendNotification(rec.subscription, pushPayload, pushOpts);
      sent++;
    } catch (err) {
      const code = err?.statusCode || err?.code || 'ERR';
      const emsg = err?.body || err?.message || String(err);
      errors.push({ code, message: emsg });
      if (code === 404 || code === 410) {
        try { await subsStore.delete(key); removed++; } catch {}
      }
    }
  }

  // --- Log-Eintrag aktualisieren + alte löschen ---
  try {
    const prev = await msgStore.get(id, { type: 'json' }) || {};
    await msgStore.set(id, JSON.stringify({
      ...prev,
      targets,
      sent,
      removed
    }));

    // nur letzte 5 Nachrichten behalten
    const all = await msgStore.list();
    const keys = (all.blobs || []).map(b => b.key).sort();
    const MAX = 5;
    if (keys.length > MAX) {
      const toDelete = keys.slice(0, keys.length - MAX);
      await Promise.all(toDelete.map(k => msgStore.delete(k)));
    }
  } catch (e) {
    errors.push({ code: 'STORE', message: 'msgStore failed: ' + (e?.message || e) });
  }

  // --- Antwort ---
  return {
    statusCode: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store, no-cache, must-revalidate, max-age=0',
      'pragma': 'no-cache',
      'expires': '0'
    },
    body: JSON.stringify({ ok: true, id, targets, sent, removed, errors })
  };
};
