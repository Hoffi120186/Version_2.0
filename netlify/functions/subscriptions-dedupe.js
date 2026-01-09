// netlify/functions/subscriptions-dedupe.js
const { getStore } = require('@netlify/blobs');

function getStoreWithEnv(name) {
  const opts = { name, consistency: 'strong' };
  if (process.env.NETLIFY_SITE_ID && process.env.NETLIFY_API_TOKEN) {
    opts.siteID = process.env.NETLIFY_SITE_ID;
    opts.token  = process.env.NETLIFY_API_TOKEN;
  }
  return getStore(opts);
}

module.exports.handler = async (event) => {          // ⬅️ WICHTIG: module.exports.handler
  const auth = event.headers.authorization || '';
  if (auth !== `Bearer ${process.env.ADMIN_BROADCAST_TOKEN}`) {
    return { statusCode: 401, body: 'unauthorized' };
  }

  const store = getStoreWithEnv('push_subscriptions');
  const all = await store.list();
  const byEndpoint = new Map();
  const dupKeys = [];

  for (const b of (all.blobs || [])) {
    const rec = await store.get(b.key, { type: 'json' });
    const ep = rec?.subscription?.endpoint;
    if (!ep) continue;
    if (byEndpoint.has(ep)) dupKeys.push(b.key);
    else byEndpoint.set(ep, b.key);
  }

  await Promise.all(dupKeys.map(k => store.delete(k)));

  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control':'no-store' },
    body: JSON.stringify({ ok: true, removed: dupKeys.length, kept: byEndpoint.size })
  };
};
