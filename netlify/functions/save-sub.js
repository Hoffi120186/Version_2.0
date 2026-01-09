// netlify/functions/save-sub.js
const { getStore } = require('@netlify/blobs');

// Store-Init (läuft mit/ohne aktivierte Blobs-UI)
function store(name) {
  const opts = { name, consistency: 'strong' };
  if (process.env.NETLIFY_SITE_ID && process.env.NETLIFY_API_TOKEN) {
    opts.siteID = process.env.NETLIFY_SITE_ID;
    opts.token  = process.env.NETLIFY_API_TOKEN;
  }
  return getStore(opts);
}

const subsStore = store('push_subscriptions');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  let body = {};
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, body: JSON.stringify({ ok:false, err:'bad_json' }) }; }

  const { subscription, profile = {}, appId = 'prod', deviceId } = body;
  if (!subscription?.endpoint) {
    return { statusCode: 400, body: JSON.stringify({ ok:false, err:'missing_subscription' }) };
  }

  // feste Schlüsselstrategie (deterministisch!)
  const p256 = subscription?.keys?.p256dh;
  const key = deviceId
    ? `dev:${appId}:${deviceId}`
    : (p256 ? `p256:${appId}:${p256}` : `ep:${appId}:${subscription.endpoint}`);

  const now = Date.now();

  // Altlasten im selben appId-Scope löschen:
  // - gleicher deviceId-Schlüssel ODER
  // - gleicher endpoint ODER
  // - gleicher p256dh
  const all = await subsStore.list();
  const dels = [];
  for (const b of (all.blobs || [])) {
    const rec = await subsStore.get(b.key, { type:'json' });
    if (!rec) continue;
    const sameScope = (rec.appId || 'prod') === appId;

    const recDev  = rec.deviceId || rec.profile?.deviceId;
    const recP256 = rec.subscription?.keys?.p256dh;
    const recEp   = rec.subscription?.endpoint;

    const clash =
      (deviceId && sameScope && recDev === deviceId) ||
      (p256 && sameScope && recP256 === p256) ||
      (sameScope && recEp === subscription.endpoint);

    if (clash && b.key !== key) dels.push(subsStore.delete(b.key));
  }

  // speichern (deterministischer Key)
  await subsStore.set(key, JSON.stringify({
    appId,
    deviceId: deviceId || profile.deviceId || null,
    subscription,
    profile,
    ua: (event.headers['user-agent'] || ''),
    updatedAt: now
  }));

  await Promise.allSettled(dels);

  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ ok: true, key })
  };
};
