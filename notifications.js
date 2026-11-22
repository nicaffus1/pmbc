// PMBC Notifications — in-app inbox and administrator notices.
// Device push delivery and scheduled reminder jobs require a trusted backend.
import { db } from "./firebase.js";
import { enablePush,pushSupport } from "./push-client.js";
import {
 collection,doc,addDoc,setDoc,onSnapshot,serverTimestamp,updateDoc,query,where
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js";

const esc=x=>String(x??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
let root=null,uid="",admin=false,approved=false,seq=0,stops=[];
let notices=new Map(),reads=new Map(),streams=new Map(),message="",error=false,waiting=false;
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
  await addDoc(collection(db,"notifications"),{
   title,body,audience,kind,linkTab,active:true,createdBy:uid,createdAt:serverTimestamp()
  });
  f.reset();f.closest("details").open=false;
  setMessage("Notification published to the inbox. Enabled devices receive push after backend deployment.");
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
 try{setMessage(await enablePush(uid));}
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
 if(event.target.closest("#enablePush")){registerDevice();return;}
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
 streams=new Map();message="";error=false;waiting=false;
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
   '<button class="button" type="submit">Publish to inbox</button>'+
   '<p class="section-note">Publishes to the inbox; also sends device alerts once Firebase Cloud Functions are deployed.</p>'+
   '</form></details>':"")+
  '<section class="card push-permission"><h2>Phone Alerts</h2>'+
  '<p id="pushSetupStatus" class="section-note">Checking push support…</p>'+
  '<button class="button outline" type="button" id="enablePush" disabled>Enable Phone Alerts</button>'+
  '<p class="section-note">On iPhone: open PMBC from its Home Screen icon to allow notifications. This is optional.</p></section>'+
  '<h2>Inbox</h2><div id="notification-items" aria-live="polite"><p class="muted">Loading…</p></div>'+
  '<p class="section-note">Automatic event, prayer, and Serve reminders are not scheduled yet.</p>';
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
