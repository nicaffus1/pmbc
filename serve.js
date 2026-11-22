// PMBC Serve — phase 1: real ministries, administrator-managed.
import { db } from "./firebase.js";
import {
  collection, addDoc, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js";

const escapeHTML = value => String(value ?? "").replace(/[&<>"']/g, c => ({
  "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
}[c]));

let root = null;
let activeUser = null;
let activeProfile = null;
let unsubscribe = null;
let generation = 0;

function isApproved() { return activeProfile?.status === "approved" && !!activeUser; }
function isAdmin() { return isApproved() && activeProfile?.role === "admin"; }

function showMessage(message, error=false) {
 const el=root?.querySelector("#serveMessage");
 if(!el)return;
 el.textContent=message;
 el.hidden=!message;
 el.className=error?"error":"notice";
}
function drawMinistries(snapshot) {
 const area=root?.querySelector("#ministriesList");
 if(!area)return;
 const records=snapshot.docs.map(d=>({id:d.id,...d.data()}))
   .filter(m=>m.active === true)
   .sort((a,b)=>a.name.localeCompare(b.name));
 if(!records.length){
   area.innerHTML='<div class="notice">No ministries have been added yet.</div>';
   return;
 }
 area.innerHTML=records.map(m=>`<article class="card ministry-item">
  <strong class="itemtitle">${escapeHTML(m.name)}</strong>
  ${m.description?`<p>${escapeHTML(m.description)}</p>`:""}
  <p class="section-note">Volunteer opportunities and shifts will be added in the next step.</p>
 </article>`).join("");
}
async function createMinistry(event) {
 event.preventDefault();
 if(!isAdmin())return;
 const form=event.currentTarget;
 const name=String(form.elements.ministryName.value).trim();
 const description=String(form.elements.ministryDescription.value).trim();
 if(name.length<2||name.length>80||description.length>500) {
   showMessage("Use a ministry name of 2–80 characters and a description of up to 500 characters.",true);return;
 }
 const btn=form.querySelector("button[type=submit]");
 btn.disabled=true;
 try {
   await addDoc(collection(db,"ministries"),{
     name,description,active:true,createdBy:activeUser.uid,
     createdAt:serverTimestamp()
   });
   form.reset();showMessage("Ministry added to PMBC.");
 }catch(err){
   showMessage("Couldn't save the ministry ("+(err.code||"unknown error")+"). Make sure the new Firestore rules have been published.",true);
 }finally {if(btn.isConnected)btn.disabled=false;}
}
export function unmountServe(){
 generation++;
 if(unsubscribe){unsubscribe();unsubscribe=null;}
 root=null;activeUser=null;activeProfile=null;
}
export function mountServe(container,user,profile){
 unmountServe();
 root=container;activeUser=user;activeProfile=profile;
 if(!root)return;
 if(!isApproved()){
   root.innerHTML=`<span class="eyebrow">Get involved</span><h1>Serve</h1>
   <p class="notice">${!activeUser?"Sign in through More to view ministries.":"Your membership must be approved to view ministries."}</p>`;
   return;
 }
 root.innerHTML=`<span class="eyebrow">Get involved</span><h1>Serve</h1>
 <p class="muted">Discover ways to serve our church and community.</p>
 <div id="serveMessage" hidden></div>
 ${isAdmin()?`<section class="card" id="ministryComposer">
 <h2>Create a Ministry</h2>
 <form id="ministryForm" class="stack">
  <label for="ministryName">Ministry name</label>
  <input class="field" id="ministryName" name="ministryName" maxlength="80" minlength="2" required placeholder="e.g. Children's Ministry">
  <label for="ministryDescription">Description (optional)</label>
  <textarea class="field" id="ministryDescription" name="ministryDescription" rows="3" maxlength="500" placeholder="What does this ministry do?"></textarea>
  <button class="button" type="submit">Add Ministry</button>
 </form>
 </section>`:""}
 <h2>Church Ministries</h2>
 <div id="ministriesList" aria-live="polite"><p class="muted">Loading ministries…</p></div>`;
 root.querySelector("#ministryForm")?.addEventListener("submit",createMinistry);
 const marker=generation;
 unsubscribe=onSnapshot(collection(db,"ministries"),
  snapshot=>{if(marker!==generation)return;drawMinistries(snapshot);},
  error=>{if(marker!==generation)return;
   const area=root?.querySelector("#ministriesList");
   if(area)area.innerHTML='<p class="error">Unable to load ministries ('+escapeHTML(error.code||"network error")+'). Check the published Firestore rules.</p>';
  });
}
