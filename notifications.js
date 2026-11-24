// PMBC Notifications — in-app inbox and administrator notices.
// Device push delivery and scheduled reminder jobs require a trusted backend.
import { auth,db } from "./firebase.js";
import { PUSH_SENDER_URL } from "./push-sender-config.js";
import { enablePush,pushSupport } from "./push-client.js";
import {
 collection,doc,addDoc,setDoc,onSnapshot,serverTimestamp,updateDoc,query,where
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js";

const esc=x=>String(x??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
let root=null,uid="",admin=false,approved=false,seq=0,stops=[];
let notices=new Map(),reads=new Map(),streams=new Map(),message="",error=false,waiting=false;
let deviceToken="";
let inboxFilter="all";
const senderConfigured=()=>/^https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev\/?$/i.test(PUSH_SENDER_URL.trim());
export async function sendPhonePush(id){
 if(!auth.currentUser)throw Error("An approved administrator must be signed in.");
 if(!senderConfigured())throw Error("Phone sender is not connected yet. Follow PUSH_SENDER_SETUP.md to deploy it.");
 const idToken=await auth.currentUser.getIdToken();
 let offset=0,sent=0,failed=0,total=0,attempts=0;
 do{
  const res=await fetch(PUSH_SENDER_URL.replace(/\/$/,"")+"/send",{
   method:"POST",headers:{"Authorization":"Bearer "+idToken,"content-type":"application/json"},
   body:JSON.stringify({notificationId:id,offset})
  });
  const data=await res.json().catch(()=>({}));
  if(!res.ok)throw Error(data.error||"Phone sender request failed ("+res.status+").");
  sent+=Number(data.sent||0);failed+=Number(data.failed||0);total=Number(data.total||0);
  if(data.done||data.nextOffset==null)break;
  if(++attempts>=20)throw Error("Too many delivery batches.");
  offset=data.nextOffset;
 }while(true);
 return {sent,failed,total};
}
async function sendExisting(id){
 if(waiting||!admin)return;
 waiting=true;
 try{
  const report=await sendPhonePush(id);
  setMessage("Phone delivery requested: "+report.sent+" accepted, "+report.failed+" failed of "+report.total+" registered devices.");
 }catch(e){setMessage("Phone alert not completed: "+(e.message||"Unknown error"),true);}
 finally{waiting=false;}
}

const labels={general:"General",event:"Event",prayer:"Prayer",serve:"Serve",admin:"Administration"};
function visibleRecords(){
 const merged=new Map();
 for(const stream of streams.values())for(const [id,item] of stream)merged.set(id,item);
 notices=merged;
 return [...merged.entries()].filter(([,v])=>v.active!==false)
  .sort((a,b)=>(b[1].createdAt?.toMillis?.()||0)-(a[1].createdAt?.toMillis?.()||0));
}
function render(){
 if(!root)return;
 const list=root.querySelector("#notification-items");
 if(!list)return;
 const items=visibleRecords();
 const unread=items.filter(([id])=>!reads.has(id)).length;
 const count=root.querySelector("#notificationCount");if(count)count.textContent=unread?unread+" unread":"All caught up";
 root.querySelectorAll("[data-notification-filter]").forEach(b=>{let active=b.dataset.notificationFilter===inboxFilter;b.classList.toggle("selected",active);b.setAttribute("aria-pressed",String(active));});
 const showing=inboxFilter==="unread"?items.filter(([id])=>!reads.has(id)):items;
 list.innerHTML=showing.length?showing.map(([id,n])=>{const read=reads.has(id);
  return '<article class="card notification-entry '+(read?"read":"unread")+'">'+
   '<div class="notification-label">'+esc(labels[n.kind]||"General")+
   (n.audience==="targeted"?" · Member message":n.audience==="admins"?' · Admin only':n.audience==="person"?' · Personal reminder':"")+(read?"":" · New")+'</div>'+
   '<strong>'+esc(n.title)+'</strong><p>'+esc(n.body)+'</p>'+
   '<div class="notification-actions">'+(!read?
    '<button type="button" class="button outline" data-mark-read="'+esc(id)+'">Mark as read</button>':
    '<span class="section-note">Read</span>')+
   (n.linkTab?'<button type="button" class="button outline" data-notification-tab="'+esc(n.linkTab)+'">Open '+esc(n.linkTab)+'</button>':"")+
   (admin?'<details class="notification-manage"><summary>Manage</summary>'+
    '<button type="button" class="button outline notification-remove" data-notification-remove="'+esc(id)+'">Remove</button></details>':"")+
   '</div></article>';
 }).join(""):'<div class="card empty-update"><p>'+(inboxFilter==="unread"?"No unread notifications.":"No notifications yet.")+'</p></div>';
 const badge=document.querySelector("#notificationBell .notification-dot");
 if(badge)badge.hidden=unread===0;
 const box=root.querySelector("#notificationMessage");
 if(box){box.textContent=message;box.className=error?"error":"notice";box.hidden=!message;}
}
function setMessage(value,isError=false){message=value;error=isError;render();}
function allowedTab(tab){return ["home","prayer","serve","more"].includes(tab);}
async function submit(event){
 event.preventDefault();if(!admin||waiting)return;
 const f=event.target, title=String(f.elements.namedItem("title").value).trim();
 const body=String(f.elements.namedItem("body").value).trim();
 const audience=f.elements.namedItem("audience").value;
 const kind=f.elements.namedItem("kind").value;
 const linkTab=f.elements.namedItem("linkTab").value;
 if(title.length<2||title.length>100||body.length<3||body.length>500||
 !["members","admins"].includes(audience)||!Object.hasOwn(labels,kind)||
 (linkTab&&!allowedTab(linkTab))){setMessage("Please check the notification details.",true);return;}
 if(kind==="prayer"&&audience==="members"&&!window.confirm(
  "Do not include private prayer details in a church-wide notification. Continue?"
 ))return;
 const btn=f.querySelector('[type="submit"]');waiting=true;btn.disabled=true;
 try{
  const newNotice=await addDoc(collection(db,"notifications"),{
   title,body,audience,kind,linkTab,active:true,createdBy:uid,createdAt:serverTimestamp()
  });
  f.reset();f.closest("details").open=false;
  if(senderConfigured()){
   try{
    const report=await sendPhonePush(newNotice.id);
    setMessage("Notification sent. "+report.sent+" phone"+(report.sent===1?"":"s")+" accepted the alert"+(report.failed?"; "+report.failed+" failed":"")+".");
   }catch(pushError){
    setMessage("Saved to inbox, but phone delivery didn't finish: "+pushError.message,true);
   }
  }else setMessage("Saved to inbox. Phone alerts are not connected yet; configure your Cloudflare Worker.");
 }catch(e){setMessage("Could not publish notification ("+(e.code||"error")+"). Publish the updated Firebase rules.",true);}
 finally{waiting=false;if(btn.isConnected)btn.disabled=false;}
}
async function markRead(id){
 if(!approved||waiting||!notices.has(id)||reads.has(id))return;
 waiting=true;
 try{
  await setDoc(doc(db,"users",uid,"notificationReads",id),{readAt:serverTimestamp()});
  reads.set(id,true);render();
 }catch(e){setMessage("Could not mark notification as read ("+(e.code||"error")+").",true);}
 finally{waiting=false;}
}
async function remove(id){
 if(!admin||waiting||!notices.has(id))return;
 if(!window.confirm("Remove this notification from active inboxes?"))return;
 waiting=true;
 try{
  await updateDoc(doc(db,"notifications",id),{active:false});
  setMessage("Notification removed from inboxes.");
 }catch(e){setMessage("Could not remove notification ("+(e.code||"error")+").",true);}
 finally{waiting=false;}
}
async function registerDevice(){
 const btn=root?.querySelector("#enablePush");
 if(!btn||waiting||!approved)return;
 waiting=true;btn.disabled=true;
 try{
  const result=await enablePush(uid);
  deviceToken=result.token;
  const panel=root?.querySelector("#pushTokenPanel");
  if(panel)panel.hidden=false;
  const tokenField=root?.querySelector("#pushDeviceToken");
  if(tokenField)tokenField.value=deviceToken;
  const status=root?.querySelector("#pushSetupStatus");if(status)status.textContent="Phone alerts are enabled on this device.";
  if(btn)btn.textContent="Refresh phone alerts";
  setMessage("Phone alerts are enabled on this device.");
 }
 catch(e){setMessage(e.message||"Unable to register for phone alerts.",true);}
 finally{waiting=false;if(btn.isConnected)btn.disabled=false;}
}
function checkPushSupport(){
 const current=seq;
 pushSupport().then(result=>{
  if(current!==seq||!root)return;
  const status=root.querySelector("#pushSetupStatus");
  if(status)status.textContent=result.reason;
  const btn=root.querySelector("#enablePush");
  if(btn){btn.disabled=!result.ready;btn.textContent=Notification.permission==="granted"?"Refresh phone alerts":"Enable phone alerts on this device";}
 }).catch(()=>{});
}
function click(event){
 const filter=event.target.closest("[data-notification-filter]");if(filter){inboxFilter=filter.dataset.notificationFilter;render();return;}
 const phone=event.target.closest("[data-notification-send]");
 if(phone){sendExisting(phone.dataset.notificationSend);return;}
 if(event.target.closest("#enablePush")){registerDevice();return;}
 if(event.target.closest("#copyPushToken")){
  const value=root?.querySelector("#pushDeviceToken")?.value;
  if(!value)return;
  navigator.clipboard.writeText(value).then(()=>setMessage("Device token copied. Paste it into Firebase Messaging > Send test message."))
    .catch(()=>setMessage("Could not copy automatically. Select and copy the token from the field.",true));
  return;
 }
 const read=event.target.closest("[data-mark-read]");
 if(read){markRead(read.dataset.markRead);return;}
 const removeBtn=event.target.closest("[data-notification-remove]");
 if(removeBtn){remove(removeBtn.dataset.notificationRemove);return;}
 const go=event.target.closest("[data-notification-tab]");
 if(go&&allowedTab(go.dataset.notificationTab))window.location.hash=go.dataset.notificationTab;
}
export function unmountNotifications(){
 seq++;
 for(const stop of stops){try{stop();}catch{}}
 stops=[];root=null;uid="";approved=false;admin=false;notices=new Map();reads=new Map();
 streams=new Map();message="";error=false;waiting=false;deviceToken="";inboxFilter="all";
}
export function mountNotifications(container,user,profile){
 unmountNotifications();root=container;uid=user?.uid||"";
 approved=Boolean(uid&&profile?.status==="approved");
 admin=approved&&profile.role==="admin";
 if(!root)return;
 if(!approved){
  root.innerHTML='<span class="eyebrow">PMBC Community</span><h1>Notifications</h1>'+
   '<p class="notice">Sign in with an approved church account to see notifications.</p>';
  return;
 }
 root.innerHTML='<h1>Notifications</h1>'+
  '<p class="muted">Updates from your church, all in one place.</p>'+
  '<div id="notificationMessage" hidden></div>'+
  (admin?'<details class="card notification-composer"><summary>+ New notification</summary>'+
   '<form class="stack" id="notificationForm">'+
   '<label>Title<input class="field" name="title" minlength="2" maxlength="100" placeholder="e.g. Church fellowship this Sunday" required></label>'+
   '<label>Message<textarea class="field" name="body" rows="3" minlength="3" maxlength="500" placeholder="What would you like everyone to know?" required></textarea></label>'+
   '<label>Send to<select class="field" name="audience"><option value="members">All approved members</option>'+
   '<option value="admins">Administrators only</option></select></label>'+
   '<details class="notification-more-options"><summary>More options</summary><label>Category<select class="field" name="kind"><option value="general">General</option>'+
   '<option value="event">Upcoming event</option><option value="prayer">Prayer reminder</option>'+
   '<option value="serve">Serve opportunity</option><option value="admin">Administration</option></select></label>'+
   '<label>Open page (optional)<select class="field" name="linkTab">'+
   '<option value="">No link</option><option value="home">Home</option>'+
   '<option value="prayer">Prayer</option><option value="serve">Serve</option>'+
   '<option value="more">More</option></select></label></details>'+
   '<button class="button" type="submit">'+(senderConfigured()?'Send notification':'Post to inbox')+'</button>'+
   (!senderConfigured()?'<p class="section-note">Phone delivery is unavailable. This will be saved to the inbox only.</p>':'')+
   '</form></details>':"")+
  '<section class="notification-inbox-section"><div class="notification-inbox-heading"><div><h2>Inbox</h2><p id="notificationCount" class="section-note">Loading…</p></div>'+
  '<div class="notification-filter" role="group" aria-label="Filter notifications">'+
  '<button type="button" class="selected" data-notification-filter="all" aria-pressed="true">All</button>'+
  '<button type="button" data-notification-filter="unread" aria-pressed="false">Unread</button></div></div>'+
  '<div id="notification-items" aria-live="polite"><p class="muted">Loading notifications…</p></div></section>'+
  '<details class="card notification-preferences"><summary>Phone notification settings</summary>'+
  '<div class="notification-preferences-body"><p id="pushSetupStatus" class="section-note">Checking this device…</p>'+
  '<button class="button outline" type="button" id="enablePush" disabled>Enable phone alerts on this device</button>'+
  '<p class="section-note">On iPhone, open PMBC from its Home Screen icon to allow notifications.</p>'+
  '<details class="notification-more-options"><summary>Advanced: device token</summary>'+
  '<div id="pushTokenPanel" class="push-token-panel" hidden>'+
  '<label for="pushDeviceToken">Private device registration token</label>'+
  '<textarea class="field" id="pushDeviceToken" rows="3" readonly></textarea>'+
  '<button class="button outline" type="button" id="copyPushToken">Copy device token</button></div>'+
  '<p class="section-note">For troubleshooting only. Keep this token private.</p></details>'+
  '</div></details>';
 root.addEventListener("click",click);
 checkPushSupport();
 root.querySelector("#notificationForm")?.addEventListener("submit",submit);
 const token=seq;
 const jobs=admin?[["all",collection(db,"notifications")]]:
  [["members",query(collection(db,"notifications"),where("audience","==","members"))],
   ["targeted",query(collection(db,"notifications"),where("recipientIds","array-contains",uid))],
   ["personal",query(collection(db,"notifications"),where("recipientId","==",uid))]];
 for(const [key,ref] of jobs){
  stops.push(onSnapshot(ref,snap=>{
   if(token!==seq)return;
   streams.set(key,new Map(snap.docs.map(d=>[d.id,{id:d.id,...d.data()}])));
   render();
  },e=>{if(token===seq)setMessage("Could not load notifications ("+(e.code||"error")+").",true);}));
 }
 stops.push(onSnapshot(collection(db,"users",uid,"notificationReads"),snap=>{
  if(token!==seq)return;
  reads=new Map(snap.docs.map(d=>[d.id,d.data()]));render();
 },e=>{if(token===seq)setMessage("Could not load read status ("+(e.code||"error")+").",true);}));
}
