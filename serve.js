// PMBC Serve — ministry positions and member opt-in, backed by Firestore.
import { db } from "./firebase.js";
import {
  collection, doc, addDoc, setDoc, deleteDoc,
  onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js";

const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({
 "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
}[c]));

let root=null, account=null, profile=null, sequence=0;
let stops=[], ministries=new Map(), positions=new Map(), joined=new Map();
let knownPositionListeners=new Set(), pendingWrites=new Set();

const approved=()=>!!account && profile?.status==="approved";
const admin=()=>approved() && profile?.role==="admin";
const positionKey=(mid,pid)=>mid+"/"+pid;

function notice(message,isError=false){
 const el=root?.querySelector("#serveMessage");
 if(!el)return;
 el.hidden=!message;
 el.className=isError?"error":"notice";
 el.textContent=message;
}
function volunteerUI(mid,pid){
 const key=positionKey(mid,pid), isJoined=joined.get(key)===true;
 return `<button class="button ${isJoined?"outline":""}" type="button"
 data-toggle-signup data-mid="${esc(mid)}" data-pid="${esc(pid)}"
 ${pendingWrites.has(key)?"disabled":""}>${isJoined?"✓ Volunteering — Leave Position":"I'd Like to Serve"}</button>`;
}
function positionUI(mid,entry){
 const {id,...data}=entry;
 return `<div class="position-item">
  <strong>${esc(data.title)}</strong>
  ${data.description?`<p>${esc(data.description)}</p>`:""}
  <p class="section-note">Ongoing ministry interest · No shift assigned yet</p>
  ${volunteerUI(mid,id)}
 </div>`;
}
function ministryUI(entry){
 const {id,...data}=entry;
 const items=[...(positions.get(id)?.values()||[])].filter(p=>p.active)
   .sort((a,b)=>a.title.localeCompare(b.title));
 return `<article class="card ministry-item">
  <h2>${esc(data.name)}</h2>
  ${data.description?`<p>${esc(data.description)}</p>`:""}
  <h3 class="ministry-subtitle">Ways to Serve</h3>
  ${items.length?items.map(p=>positionUI(id,p)).join(""):'<p class="muted">No volunteer positions yet.</p>'}
  ${admin()?`<form class="stack position-form" data-position-form data-mid="${esc(id)}">
   <label>New volunteer position
    <input class="field" name="title" minlength="2" maxlength="80" required
     placeholder="e.g. Classroom Helper"></label>
   <label>Description (optional)
    <textarea class="field" name="description" maxlength="500" rows="2"
     placeholder="What will a volunteer do?"></textarea></label>
   <button class="button outline" type="submit">Add Position</button>
  </form>`:""}
 </article>`;
}
function draw(){
 const area=root?.querySelector("#ministriesList");if(!area)return;
 const entries=[...ministries.values()].filter(m=>m.active)
   .sort((a,b)=>a.name.localeCompare(b.name));
 if(!entries.length) {
   area.innerHTML='<div class="notice">No ministries have been added yet.</div>';return;
 }
 area.innerHTML=entries.map(ministryUI).join("");
}
function watchSignup(mid,pid,token){
 const key=positionKey(mid,pid);
 if(knownPositionListeners.has(key))return;
 knownPositionListeners.add(key);
 const ref=doc(db,"ministries",mid,"positions",pid,"signups",account.uid);
 const unsub=onSnapshot(ref,snap=>{
   if(sequence!==token)return;
   joined.set(key,snap.exists());draw();
 },err=>{
   if(sequence!==token)return;
   notice("Unable to check your sign-up status ("+(err.code||"network error")+").",true);
 });
 stops.push(unsub);
}
function watchPositions(mid,token){
 const unsub=onSnapshot(collection(db,"ministries",mid,"positions"),snap=>{
   if(sequence!==token)return;
   const records=new Map(snap.docs.map(d=>[d.id,{id:d.id,...d.data()}]));
   positions.set(mid,records);
   for(const p of records.values())if(p.active)watchSignup(mid,p.id,token);
   draw();
 },err=>{
   if(sequence!==token)return;
   notice("Unable to load volunteer positions ("+(err.code||"network error")+"). Check Firestore rules.",true);
 });
 stops.push(unsub);
}
async function addMinistry(event){
 event.preventDefault();if(!admin())return;
 const form=event.currentTarget;
 const name=String(form.elements.ministryName.value).trim();
 const description=String(form.elements.ministryDescription.value).trim();
 if(name.length<2||name.length>80||description.length>500){
   notice("Check the ministry name and description lengths.",true);return;
 }
 const button=form.querySelector("button[type=submit]");button.disabled=true;
 try{
   await addDoc(collection(db,"ministries"),{
     name,description,active:true,createdBy:account.uid,createdAt:serverTimestamp()
   });
   form.reset();notice("Ministry added.");
 }catch(err){notice("Couldn't add ministry ("+(err.code||"error")+").",true);}
 finally{if(button.isConnected)button.disabled=false;}
}
async function addPosition(event){
 const form=event.target.closest("[data-position-form]");
 if(!form||!admin())return;
 event.preventDefault();
 const mid=form.dataset.mid;
 if(!ministries.get(mid)?.active)return;
 const title=String(form.elements.title.value).trim();
 const description=String(form.elements.description.value).trim();
 if(title.length<2||title.length>80||description.length>500){
   notice("Check the position title and description lengths.",true);return;
 }
 const button=form.querySelector("button[type=submit]");button.disabled=true;
 try{
   await addDoc(collection(db,"ministries",mid,"positions"),{
     title,description,active:true,createdBy:account.uid,createdAt:serverTimestamp()
   });
   form.reset();notice("Volunteer position added.");
 }catch(err){notice("Couldn't add position ("+(err.code||"error")+"). Confirm the updated Firestore rules are published.",true);}
 finally{if(button.isConnected)button.disabled=false;}
}
async function toggleSignup(button){
 if(!approved())return;
 const mid=button.dataset.mid,pid=button.dataset.pid;
 const key=positionKey(mid,pid);
 if(pendingWrites.has(key)||!ministries.get(mid)?.active||!positions.get(mid)?.get(pid)?.active)return;
 pendingWrites.add(key);draw();
 const ref=doc(db,"ministries",mid,"positions",pid,"signups",account.uid);
 const wasJoined=joined.get(key)===true;
 try {
   if(wasJoined)await deleteDoc(ref);
   else await setDoc(ref,{
     memberId:account.uid,memberName:profile.displayName,createdAt:serverTimestamp()
   });
   joined.set(key,!wasJoined);
   notice(wasJoined?"You left this volunteer position.":"You're signed up as an interested volunteer.");
 }catch(err){notice("Couldn't update your signup ("+(err.code||"error")+"). Check Firestore rules.",true);}
 finally{pendingWrites.delete(key);draw();}
}
function onClick(event){
 const button=event.target.closest("[data-toggle-signup]");
 if(button)toggleSignup(button);
}
function onSubmit(event){
 if(event.target.matches("#ministryForm")){addMinistry(event);return;}
 if(event.target.matches("[data-position-form]"))addPosition(event);
}
export function unmountServe(){
 sequence++;
 for(const unsub of stops){try{unsub();}catch{}}
 stops=[];ministries=new Map();positions=new Map();joined=new Map();
 knownPositionListeners=new Set();pendingWrites=new Set();
 root=null;account=null;profile=null;
}
export function mountServe(container,user,userProfile){
 unmountServe();root=container;account=user;profile=userProfile;
 if(!root)return;
 if(!approved()){
   root.innerHTML=`<span class="eyebrow">Get involved</span><h1>Serve</h1>
    <p class="notice">${!account?"Sign in through More to view ministries.":"Your membership must be approved to view ministries."}</p>`;
   return;
 }
 root.innerHTML=`<span class="eyebrow">Get involved</span><h1>Serve</h1>
 <p class="muted">Find a ministry, and let the church know you'd like to help.</p>
 <div id="serveMessage" hidden></div>
 ${admin()?`<section class="card" id="ministryComposer">
  <h2>Create a Ministry</h2>
  <form id="ministryForm" class="stack">
   <label for="ministryName">Ministry name</label>
   <input class="field" id="ministryName" name="ministryName" minlength="2" maxlength="80" required>
   <label for="ministryDescription">Description (optional)</label>
   <textarea class="field" id="ministryDescription" name="ministryDescription" rows="3" maxlength="500"></textarea>
   <button class="button" type="submit">Add Ministry</button>
  </form>
 </section>`:""}
 <h2>Church Ministries</h2>
 <div id="ministriesList" aria-live="polite"><p class="muted">Loading ministries…</p></div>`;
 root.addEventListener("submit",onSubmit);
 root.addEventListener("click",onClick);
 const token=sequence;
 stops.push(onSnapshot(collection(db,"ministries"),snap=>{
   if(token!==sequence)return;
   for(const d of snap.docs){
     if(d.data().active && !ministries.has(d.id))watchPositions(d.id,token);
   }
   ministries=new Map(snap.docs.map(d=>[d.id,{id:d.id,...d.data()}]));
   draw();
 },err=>{
   if(token!==sequence)return;
   root.querySelector("#ministriesList").innerHTML=
    '<p class="error">Unable to load ministries ('+esc(err.code||"network error")+').</p>';
 }));
}
