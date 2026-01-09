const { getStore } = require('@netlify/blobs');

function getStoreWithEnv(name){
  const o={ name, consistency:'strong' };
  if(process.env.NETLIFY_SITE_ID && process.env.NETLIFY_API_TOKEN){ o.siteID=process.env.NETLIFY_SITE_ID; o.token=process.env.NETLIFY_API_TOKEN; }
  return getStore(o);
}

module.exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode:405, body:'Method Not Allowed' };

  let data={}; try{ data=JSON.parse(event.body||'{}'); }catch{}
  const { subscription, profile={}, ts=Date.now() } = data;
  if (!subscription?.endpoint) return { statusCode:400, body:JSON.stringify({ok:false,error:'missing_subscription'}) };

  const store = getStoreWithEnv('push_subscriptions');

  // gleicher Schlüssel wie im Broadcast
  const deviceId = profile.deviceId;
  const p256 = subscription?.keys?.p256dh;
  const keyFor = (rec) => rec?.profile?.deviceId ? 'dev:'+rec.profile.deviceId :
                       (rec?.subscription?.keys?.p256dh ? 'p256:'+rec.subscription.keys.p256dh
                                                         : 'ep:'+rec?.subscription?.endpoint);

  const myKey = deviceId ? 'dev:'+deviceId : (p256 ? 'p256:'+p256 : 'ep:'+subscription.endpoint);

  // ältere Einträge gleichen Schlüssels entfernen
  const all = await store.list();
  for(const b of (all.blobs||[])){
    const rec = await store.get(b.key, { type:'json' });
    if(!rec) continue;
    if (keyFor(rec) === myKey && (rec.ts||0) < ts){
      try{ await store.delete(b.key); }catch{}
    }
  }

  const id = String(ts)+'_'+Math.random().toString(36).slice(2,7);
  await store.set(id, JSON.stringify({ subscription, profile, ts }));
  return { statusCode:200, headers:{'content-type':'application/json'}, body: JSON.stringify({ ok:true, id }) };
};
