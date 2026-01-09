// netlify/functions/push-messages-admin.js
const { getStore } = require('@netlify/blobs');

// --- Safe Store Helper ---
function store(name) {
  const opts = { name, consistency: 'strong' };
  if (process.env.NETLIFY_SITE_ID && process.env.NETLIFY_API_TOKEN) {
    opts.siteID = process.env.NETLIFY_SITE_ID;
    opts.token  = process.env.NETLIFY_API_TOKEN;
  }
  return getStore(opts);
}
const storeRef = store('push_messages');

function jsonRes(obj, status = 200) {
  return {
    statusCode: status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store, no-cache, must-revalidate, max-age=0'
    },
    body: JSON.stringify(obj)
  };
}

async function listMessages() {
  const all = await storeRef.list();
  const keys = (all.blobs || []).map(b => b.key).sort();
  const items = [];
  for (let i = keys.length - 1; i >= 0; i--) {
    const obj = await storeRef.get(keys[i], { type: 'json' });
    if (obj) items.push(obj);
  }
  return items;
}

exports.handler = async (event) => {
  const auth = event.headers.authorization || '';
  if (auth !== `Bearer ${process.env.ADMIN_BROADCAST_TOKEN}`) {
    return jsonRes({ ok: false, error: 'unauthorized' }, 401);
  }

  try {
    if (event.httpMethod === 'GET') {
      const items = await listMessages();
      return jsonRes({ ok: true, items });
    }

    if (event.httpMethod === 'DELETE') {
      const all = await storeRef.list();
      const keys = (all.blobs || []).map(b => b.key);
      await Promise.all(keys.map(k => storeRef.delete(k)));
      const items = await listMessages();
      return jsonRes({ ok: true, deleted: keys.length, items });
    }

    if (event.httpMethod === 'POST') {
      const data = JSON.parse(event.body || '{}');
      const msgs = Array.isArray(data.messages) ? data.messages.slice(0, 5) : [];
      const all = await storeRef.list();
      await Promise.all((all.blobs || []).map(b => storeRef.delete(b.key)));

      const baseTs = Date.now();
      for (let i = 0; i < msgs.length; i++) {
        const m = msgs[i] || {};
        const ts = baseTs + i;
        const id = String(ts);
        await storeRef.set(id, JSON.stringify({
          id, ts,
          title: m.title || '',
          body:  m.body  || '',
          url:   m.url   || '',
          segment: m.segment || '',
          appId: m.appId || 'prod',
          sent: 0, removed: 0, sender: 'seed'
        }));
      }
      const items = await listMessages();
      return jsonRes({ ok: true, count: msgs.length, items });
    }

    return jsonRes({ ok: false, error: 'method_not_allowed' }, 405);
  } catch (e) {
    return jsonRes({ ok: false, error: String(e?.message || e) }, 500);
  }
};
