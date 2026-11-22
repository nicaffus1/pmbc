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
const senderConfigured=()=>/^https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev\/?$/i.test(PUSH_SENDER_URL.trim());
async function sendPhonePush(id){
 if(!admin||!auth.currentUser)throw Error("An approved administrator must be signed in.");
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
 list.innerHTML=items.length?items.map(([id,n])=>{const read=reads.has(id);
  return '<article class="card notification-entry '+(read?"read":"unread")+'">'+
   '<div class="notification-label">'+esc(labels[n.kind]||"General")+
   (n.audience==="admins"?' · Admin only':n.audience==="person"?' · Personal reminder':"")+(read?"":" · New")+'</div>'+
   '<strong>'+esc(n.title)+'</strong><p>'+esc(n.body)+'</p>'+
   '<div class="notification-actions">'+(!read?
    '<button type="button" class="button outline" data-mark-read="'+esc(id)+'">Mark as read</button>':
    '<span class="section-note">Read</span>')+
   (n.linkTab?'<button type="button" class="button outline" data-notification-tab="'+esc(n.linkTab)+'">Open '+esc(n.linkTab)+'</button>':"")+
   (admin&&n.createdBy===uid?'<button type="button" class="button outline" data-notification-send="'+esc(id)+'">'+
    (senderConfigured()?'Send phone alert':'Phone sender not connected')+'</button>':"")+
   (admin?'<button type="button" class="button outline notification-remove" data-notification-remove="'+esc(id)+'">Remove</button>':"")+
   '</div></article>';
 }).join(""):'<div class="card empty-update"><p>No notifications yet.</p></div>';
 const badge=document.querySelector("#notificationBell .notification-dot");
 if(badge)badge.hidden=!items.some(([id])=>!reads.has(id));
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
    setMessage("Published to inbox. Phone push: "+report.sent+" accepted, "+report.failed+" failed of "+report.total+" registered devices.");
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
  setMessage(result.message);
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
  if(btn)btn.disabled=!result.ready;
 }).catch(()=>{});
}
function click(event){
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
 streams=new Map();message="";error=false;waiting=false;deviceToken="";
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
 root.innerHTML='<span class="eyebrow">PMBC Community</span><h1>Notifications</h1>'+
  '<p class="muted">Announcements and reminders sent to your church inbox.</p>'+
  '<div id="notificationMessage" hidden></div>'+
  (admin?'<details class="card notification-composer"><summary>+ Send notification</summary>'+
   '<form class="stack" id="notificationForm">'+
   '<label>Title<input class="field" name="title" minlength="2" maxlength="100" required></label>'+
   '<label>Message<textarea class="field" name="body" rows="3" minlength="3" maxlength="500" required></textarea></label>'+
   '<label>Audience<select class="field" name="audience"><option value="members">All approved members (including admins)</option>'+
   '<option value="admins">Administrators only</option></select></label>'+
   '<label>Category<select class="field" name="kind"><option value="general">General</option>'+
   '<option value="event">Upcoming event</option><option value="prayer">Prayer reminder</option>'+
   '<option value="serve">Serve opportunity</option><option value="admin">Administration</option></select></label>'+
   '<label>Open page (optional)<select class="field" name="linkTab">'+
   '<option value="">No link</option><option value="home">Home</option>'+
   '<option value="prayer">Prayer</option><option value="serve">Serve</option>'+
   '<option value="more">More</option></select></label>'+
   '<button class="button" type="submit">'+(senderConfigured()?'Publish & Send Phone Alerts':'Publish to Inbox')+'</button>'+
   '<p class="section-note">'+(senderConfigured()?'Phone pushes go to opted-in devices through the secure Cloudflare Worker.':'Cloudflare phone sender is not connected. This will publish to the inbox only.')+'</p>'+
   '</form></details>':"")+
  '<section class="card push-permission"><h2>Phone Alerts</h2>'+
  '<p id="pushSetupStatus" class="section-note">Checking push support…</p>'+
  '<button class="button outline" type="button" id="enablePush" disabled>Enable Phone Alerts</button>'+
  '<p class="section-note">On iPhone: open PMBC from its Home Screen icon to allow notifications. This is optional.</p>'+
  '<div id="pushTokenPanel" class="push-token-panel" hidden>'+
   '<label for="pushDeviceToken">Your device registration token (keep private)</label>'+
   '<textarea class="field" id="pushDeviceToken" rows="3" readonly></textarea>'+
   '<button class="button outline" type="button" id="copyPushToken">Copy my device token</button>'+
   '<p class="section-note">Use this token in Firebase Messaging > Send test message. Each phone has its own token; never publish token lists on the church website.</p>'+
  '</div></section>'+
  '<h2>Inbox</h2><div id="notification-items" aria-live="polite"><p class="muted">Loading…</p></div>'+
  '<p class="section-note">Manual administrator phone push uses Cloudflare after setup. Scheduled reminders remain disabled.</p>'+
  (admin?'<div class="card manual-push-admin"><strong>Send a phone notification</strong>'+
   '<p class="section-note">'+(senderConfigured()?'Phone alerts are connected. Publish a notice above to send to registered devices.':'Deploy the free Cloudflare Worker and set its URL in push-sender-config.js to enable phone alerts here.')+'</p>'+
   '<a class="button outline" href="https://console.firebase.google.com/project/pmbc-d6d17/messaging" target="_blank" rel="noopener noreferrer">Open Firebase Messaging</a>'+
   '<p class="section-note">Create a notification campaign, or choose Send test message and paste a member\'s device token.</p></div>':"");
 root.addEventListener("click",click);
 checkPushSupport();
 root.querySelector("#notificationForm")?.addEventListener("submit",submit);
 const token=seq;
 const jobs=admin?[["all",collection(db,"notifications")]]:
  [["members",query(collection(db,"notifications"),where("audience","==","members"))],
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
