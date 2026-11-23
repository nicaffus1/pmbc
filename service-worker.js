const CACHE='pmbc-bulletin-v60';const ASSETS=['./','./index.html','./styles.css','./app.js','./features.css','./bulletin.js','./manifest.webmanifest','./firebase.js','./prayer.js','./serve.js','./home-updates.js','./notifications.js','./push-client.js','./push-config.js','./push-sender-config.js','./videos.js','./verse-of-day.js','./facebook-posts.js'];self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));self.addEventListener('fetch',e=>{if(e.request.method!=='GET'||new URL(e.request.url).origin!==self.location.origin)return;e.respondWith(fetch(e.request).then(r=>{if(r.ok){const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy))}return r}).catch(()=>caches.match(e.request).then(r=>r||((e.request.mode==='navigate')?caches.match('./index.html'):undefined))))});
/* Push notifications arrive even if the PMBC tab is closed. The server sends
   data-only Firebase Cloud Messaging payloads, so this worker displays each alert. */
self.addEventListener('push',event=>{
 let payload={};
 try{payload=event.data?.json()||{};}catch{return;}
 const data=payload.data||payload;
 const title=String(data.title||payload.notification?.title||"PMBC").slice(0,100);
 const body=String(data.body||payload.notification?.body||"You have a church notification.").slice(0,500);
 const raw=String(data.url||'./#notifications');
 const url=new URL(raw,self.registration.scope);
 const base=new URL(self.registration.scope);
 if(url.origin!==base.origin||!url.pathname.startsWith(base.pathname))return;
 event.waitUntil(self.registration.showNotification(title,{
  body,icon:'./assets/icon-192.png',badge:'./assets/icon-192.png',
  tag:'pmbc-'+String(data.notificationId||Date.now()),
  data:{url:url.href}
 }));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();
 const requested=event.notification.data?.url||self.registration.scope+'#notifications';
 const url=new URL(requested,self.registration.scope);
 const base=new URL(self.registration.scope);
 if(url.origin!==base.origin||!url.pathname.startsWith(base.pathname))return;
 event.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(async windows=>{
  const existing=windows.find(c=>c.url.startsWith(base.href));
  if(existing){await existing.navigate(url.href);return existing.focus();}
  return clients.openWindow(url.href);
 }));
});
