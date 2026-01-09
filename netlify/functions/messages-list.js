// netlify/functions/messages-list.js
const { getStore } = require('@netlify/blobs');

// --- Helper für Zugriff mit oder ohne ENV-Token ---
function getStoreWithEnv(name) {
  const opts = { name, consistency: 'strong' };
  if (process.env.NETLIFY_SITE_ID && process.env.NETLIFY_API_TOKEN) {
    opts.siteID = process.env.NETLIFY_SITE_ID;
    opts.token  = process.env.NETLIFY_API_TOKEN;
  }
  return getStore(opts);
}

// --- JSON Response Helper ---
function jsonRes(obj, status = 200) {
  return {
    statusCode: status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store, no-cache, must-revalidate, max-age=0',
      'pragma': 'no-cache',
      'expires': '0'
    },
    body: JSON.stringify(obj, null, 2)
  };
}

// --- Hauptfunktion ---
exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return jsonRes({ ok: false, error: 'method_not_allowed' }, 405);
  }

  try {
    const store = getStoreWithEnv('push_messages');
    const list  = await store.list();
    const blobs = list?.blobs || [];

    // --- Sortierung (neueste oben) ---
    const keys = blobs.map(b => b.key).sort(); // alt → neu
    const items = [];
    for (let i = keys.length - 1; i >= 0; i--) {
      const obj = await store.get(keys[i], { type: 'json' });
      if (obj) items.push(obj);
    }

    // --- Berechne unreadCount basierend auf LocalStorage-Kompatibilität ---
    // Hinweis: Der Client (nachrichten.html) nutzt localStorage für seen/hidden,
    // daher liefern wir hier nur den Rohinhalt + Count-Info
    const unreadCount = items.length; // Client filtert später selbst

    return jsonRes({ ok: true, items, unreadCount });
  } catch (err) {
    return jsonRes({ ok: false, error: String(err?.message || err) }, 500);
  }
};
