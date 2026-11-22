// PMBC: honest empty states until the live Firebase services are connected.
// No simulated prayer requests, events, members, or volunteer sign-ups.
const screen=document.getElementById('screen');
const tabs=[...document.querySelectorAll('[data-tab]')];
function card(title,body){return `<article class="card"><div class="row"><span class="itemtitle">${title}</span></div><p>${body}</p></article>`}
const views={
home:()=>`<section class="card hero"><span class="eyebrow">PMBC</span><h1>Welcome to PMBC</h1><p>Worship. Pray. Connect. Serve.</p></section><div class="grid"><button class="tile" data-go="prayer"><span class="emoji">♡</span><strong>Prayer</strong></button><button class="tile" data-go="serve"><span class="emoji">♧</span><strong>Serve</strong></button><button class="tile" data-go="more"><span class="emoji">▣</span><strong>Announcements</strong></button><button class="tile" data-go="more"><span class="emoji">▤</span><strong>Church Information</strong></button></div><h2>Announcements</h2>${card('No announcements available','Church announcements will appear here when the administrator adds them.')}<h2>Events</h2>${card('No events available','Church events will appear here when events are published.')}`,
prayer:()=>`<span class="eyebrow">Community</span><h1>Prayer Wall</h1><div class="notice">Prayer requests are not available until secure member accounts and Firebase permissions are enabled. Please do not submit private prayer information yet.</div>`,
serve:()=>`<span class="eyebrow">Get involved</span><h1>Serve</h1><p class="muted">Events, ministries, and volunteer shifts.</p><div class="notice">No serving opportunities are available yet. Sign-ups will open after secure member accounts and scheduling are connected.</div>`,
more:()=>`<span class="eyebrow">Church community</span><h1>More</h1>${card('Member Access','Registration will be available once the member database and approval permissions are configured.')}${card('Church Information','Service times and the giving link have not been entered yet.')}`
};
function show(tab){if(!views[tab])tab='home';screen.innerHTML=views[tab]();tabs.forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));screen.querySelectorAll('[data-go]').forEach(b=>b.addEventListener('click',()=>{location.hash=b.dataset.go}));document.title=`PMBC — ${tab.charAt(0).toUpperCase()+tab.slice(1)}`;window.scrollTo(0,0)}
window.addEventListener('hashchange',()=>show(location.hash.slice(1)));
tabs.forEach(b=>b.addEventListener('click',()=>location.hash=b.dataset.tab));show(location.hash.slice(1)||'home');
if('serviceWorker' in navigator){window.addEventListener('load',()=>navigator.serviceWorker.register('./service-worker.js').catch(console.warn))}
