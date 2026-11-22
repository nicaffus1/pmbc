// PMBC Prayer Wall — real Cloud Firestore data, no sample requests.
import { db } from "./firebase.js";
import {
  collection, doc, addDoc, getDoc, setDoc, deleteDoc, updateDoc,
  serverTimestamp, query, where, onSnapshot
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js";

const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({
  "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
}[char]));

let cleanup = [];
let session = 0;
let requestsById = new Map();
let prayed = new Map();
let currentRoot = null;
let currentUser = null;
let currentProfile = null;
let activeEdit = null;
let busy = false;
let errors = [];
let loaded = new Set();
let selectedPrayerId = "";
let prayerTotals = new Map();
let totalListeners = new Map();

function canSeePrivate(){return currentUser && currentProfile?.status === "approved";}
function isAdmin(){return canSeePrivate() && currentProfile.role === "admin";}
function setNotice(message, error = false){
 const el = currentRoot?.querySelector("#prayerNotice");
 if(el){el.hidden = !message;el.className = error ? "error" : "notice";el.textContent = message;}
}
function formatDate(timestamp){
 if(!timestamp?.toDate)return "Just now";
 return timestamp.toDate().toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"});
}
function escapeRequestText(text){return esc(text).replace(/\n/g,"<br>");}

function baseScreen(){
 return `<span class="eyebrow">PMBC Community</span><h1>Prayer List</h1>
 <p class="muted">Choose someone to pray for, or tap the check beside their name when you've prayed.</p>
 <div id="prayerNotice" class="notice" hidden></div>
 <section aria-label="Church prayer list">
   <h2>Church Prayer List</h2>
   <div id="prayerList" aria-live="polite"><p class="muted">Loading requests…</p></div>
 </section>
 <section id="prayerDetail" aria-live="polite"></section>
 <details class="card prayer-composer" id="prayerComposer">
   <summary>+ Submit a Prayer Request</summary>
   <form id="prayerForm" class="stack">
     <label for="prayerSubject">Name of person to pray for</label>
     <input class="field" id="prayerSubject" name="subjectName" minlength="2" maxlength="80" required placeholder="Enter a name">
     <label class="prayer-unspoken-label"><input type="checkbox" id="prayerUnspoken" name="unspoken"> Unspoken request (no name shown)</label>
     <label for="requestText">Prayer request</label>
     <textarea class="field prayer-textarea" name="text" id="requestText" maxlength="2000" minlength="3"
       rows="4" placeholder="How can we pray?" required></textarea>
     <label for="requestVisibility">Who can see this request?</label>
     <select class="field" name="visibility" id="requestVisibility">
       <option value="members">Approved church members</option>
       <option value="leadership">Church administrators only</option>
     </select>
     <p class="section-note">Leadership-only names and requests are visible only to you and church administrators.</p>
     <div id="prayerStatusSection" hidden>
       <label for="requestStatus">Request status</label>
       <select class="field" name="status" id="requestStatus">
         <option value="active">Prayer needed (keep on list)</option>
         <option value="answered">Answered (remove from active list)</option>
         <option value="removed">Remove from prayer list</option>
       </select>
     </div>
     <div class="button-row">
       <button class="button" id="savePrayer" type="submit">Post Prayer Request</button>
       <button class="button outline" id="cancelPrayerEdit" type="button" hidden>Cancel Editing</button>
     </div>
   </form>
 </details>`;
}
function activeRequests(){
 return [...requestsById.entries()]
   .filter(([,p])=>p.status==="active")
   .sort((a,b)=>(b[1].createdAt?.toMillis?.()||0)-(a[1].createdAt?.toMillis?.()||0));
}
function prayerName(p){return p.subjectName||p.authorName||"Church Member";}
function drawList(){
 const list=currentRoot?.querySelector("#prayerList");
 const details=currentRoot?.querySelector("#prayerDetail");
 if(!list||!details)return;
 if(errors.length){
   list.innerHTML=`<p role="alert" class="error">${esc(errors.join(" "))}</p>`;
   details.innerHTML="";
   return;
 }
 if(loaded.size===0){
   list.innerHTML='<p class="muted">Loading prayer requests…</p>';
   return;
 }
 const visible=activeRequests();
 if(!visible.some(([id])=>id===selectedPrayerId))selectedPrayerId="";
 if(visible.length===0){
   list.innerHTML='<div class="notice">There are no active prayer requests yet.</div>';
   details.innerHTML="";
   return;
 }
 list.innerHTML=visible.map(([id,p])=>{
   const mine=p.authorId===currentUser.uid;
   const canViewTotal=mine||isAdmin();
   const hasPrayed=prayed.get(id)===true;
   const total=prayerTotals.get(id);
   return `<div class="prayer-list-row ${id===selectedPrayerId?"selected":""}">
     <button class="prayer-person" type="button" data-select-prayer="${esc(id)}"
       aria-pressed="${id===selectedPrayerId?"true":"false"}">
       <span class="prayer-person-name">${esc(prayerName(p))}</span>
       ${p.visibility==="leadership"?'<span class="pill warning">Private</span>':""}
       ${canViewTotal&&total!==undefined?`<span class="prayer-count">${total} prayers</span>`:""}
       <span class="prayer-person-arrow" aria-hidden="true">›</span>
     </button>
     <button class="prayer-check ${hasPrayed?"prayed":""}" type="button" data-prayed="${esc(id)}"
       aria-label="I prayed for ${esc(prayerName(p))}" title="Mark that you prayed"
       ${busy?"disabled":""}>${hasPrayed?"✓":"○"}</button>
   </div>`;
 }).join("");
 if(!selectedPrayerId){
   details.innerHTML='<p class="prayer-detail-hint">Tap a name above to read the prayer request.</p>';
   return;
 }
 const p=requestsById.get(selectedPrayerId);
 if(!p){details.innerHTML="";return;}
 const canEdit=p.authorId===currentUser.uid||isAdmin();
 const total=prayerTotals.get(selectedPrayerId);
 details.innerHTML=`<article class="card prayer-selected-detail">
   <div class="row"><h2>${esc(prayerName(p))}</h2>
     <span class="pill ${p.visibility==="leadership"?"warning":""}">${p.visibility==="leadership"?"Private":"Church Members"}</span></div>
   <p class="section-note">Shared ${formatDate(p.createdAt)}${canEdit?" by "+esc(p.authorName):""}</p>
   <p class="prayer-body">${escapeRequestText(p.text)}</p>
   ${canEdit?`<p class="prayer-total">${total===undefined?"Loading prayer count…":total+" prayers recorded"}</p>
     <button class="button outline" type="button" data-edit-prayer="${esc(selectedPrayerId)}">Edit / Answer / Remove Request</button>`:""}
 </article>`;
}
function syncPrayed(){
 const active=new Set(requestsById.keys());
 for(const key of [...prayed.keys()]) if(!active.has(key)) prayed.delete(key);
 for(const key of active){
   if(prayed.has(key))continue;
   prayed.set(key,false);
   const marker=session;
   // Each member may read their own acknowledgement, but never other voters.
   getDoc(doc(db,"prayers",key,"prayedBy",currentUser.uid)).then(s=>{
     if(marker!==session||!currentRoot)return;
     prayed.set(key,s.exists());drawList();
   }).catch(()=>{});
 }
}
function updateFeed(feedName,snapshot,streams){
 const set=new Map(snapshot.docs.map(d=>[d.id,d.data()]));
 streams.set(feedName,set);
 requestsById=new Map();
 for(const entries of streams.values())for(const [id,p] of entries)requestsById.set(id,p);
 syncPrayed();
 drawList();
}
function watchFeed(){
 const streams=new Map();
 const jobs=isAdmin()
  ? [{name:"all",ref:collection(db,"prayers")}]
  : [
      {name:"members",ref:query(collection(db,"prayers"),where("visibility","==","members"))},
      {name:"mine",ref:query(collection(db,"prayers"),where("authorId","==",currentUser.uid))}
    ];
 const marker=session;
 for(const job of jobs){
   const unsubscribe=onSnapshot(job.ref,
    snap=>{
      if(marker!==session)return;
      loaded.add(job.name);updateFeed(job.name,snap,streams);
    },
    error=>{
      if(marker!==session)return;
      loaded.add(job.name);
      errors.push("Cannot load prayer requests. Check that the updated Firestore rules are published ("+(error.code||"network error")+").");
      drawList();
    }
   );
   cleanup.push(unsubscribe);
 }
}

function resetEdit(){
 activeEdit=null;
 const form=currentRoot?.querySelector("#prayerForm");
 if(!form)return;
 form.reset();
 form.querySelector("[name=status]").value="active";
 currentRoot.querySelector("#prayerFormTitle").textContent="Share a Prayer Request";
 currentRoot.querySelector("#savePrayer").textContent="Post Prayer Request";
 currentRoot.querySelector("#cancelPrayerEdit").hidden=true;
 currentRoot.querySelector("#prayerStatusSection").hidden=true;
}
async function submitPrayer(e){
 e.preventDefault();
 if(!canSeePrivate()||busy)return;
 const f=e.currentTarget;
 const text=String(f.elements.text.value).trim();
 const visibility=f.elements.visibility.value;
 const status=f.elements.status.value;
 if(text.length<3||text.length>2000){setNotice("Please enter a request between 3 and 2,000 characters.",true);return;}
 if(!["members","leadership"].includes(visibility)){setNotice("Choose who can view the request.",true);return;}
 busy=true;
 const btn=currentRoot.querySelector("#savePrayer");btn.disabled=true;
 try{
   if(activeEdit){
     await updateDoc(doc(db,"prayers",activeEdit),{
       text,visibility,status,updatedAt:serverTimestamp()
     });
     resetEdit();setNotice("Your prayer request was updated.");
   }else{
     await addDoc(collection(db,"prayers"),{
       text,visibility,status:"active",authorId:currentUser.uid,
       authorName:currentProfile.displayName,
       createdAt:serverTimestamp(),updatedAt:serverTimestamp()
     });
     resetEdit();setNotice("Your prayer request was posted.");
   }
 }catch(err){setNotice("Couldn't save the request ("+(err.code||"unknown error")+"). Check your connection and Firestore rules.",true);}
 finally{busy=false;if(btn?.isConnected)btn.disabled=false;}
}
async function markPrayed(id){
 if(busy||!requestsById.has(id)||!canSeePrivate())return;
 busy=true;
 const previous=Boolean(prayed.get(id));
 prayed.set(id,!previous);drawList();
 try{
   const vote=doc(db,"prayers",id,"prayedBy",currentUser.uid);
   if(previous)await deleteDoc(vote);
   else await setDoc(vote,{createdAt:serverTimestamp()});
 }catch(err){prayed.set(id,previous);setNotice("Couldn't update your prayer acknowledgement ("+(err.code||"network error")+").",true);}
 finally{busy=false;drawList();}
}
function edit(id){
 const p=requestsById.get(id);
 if(!p||!(p.authorId===currentUser.uid||isAdmin()))return;
 activeEdit=id;
 const f=currentRoot.querySelector("#prayerForm");
 f.elements.text.value=p.text;
 f.elements.visibility.value=p.visibility;
 f.elements.status.value=p.status;
 currentRoot.querySelector("#prayerFormTitle").textContent="Update Prayer Request";
 currentRoot.querySelector("#savePrayer").textContent="Save Changes";
 currentRoot.querySelector("#cancelPrayerEdit").hidden=false;
 currentRoot.querySelector("#prayerStatusSection").hidden=false;
 currentRoot.querySelector("#prayerComposer").scrollIntoView({behavior:"smooth",block:"start"});
}
function handleClick(e){
 const b=e.target.closest("button");if(!b)return;
 if(b.dataset.prayed){markPrayed(b.dataset.prayed);}
 else if(b.dataset.editPrayer){edit(b.dataset.editPrayer);}
 else if(b.id==="cancelPrayerEdit"){resetEdit();setNotice("");}
}
export function unmountPrayer(){
 session++;
 for(const fn of cleanup){try{fn();}catch{}}
 cleanup=[];requestsById=new Map();prayed=new Map();loaded=new Set();errors=[];
 currentRoot=null;currentUser=null;currentProfile=null;activeEdit=null;busy=false;
}
export function mountPrayer(root,user,profile){
 unmountPrayer();
 currentRoot=root;currentUser=user;currentProfile=profile;
 if(!root)return;
 if(!canSeePrivate()){
   root.innerHTML=`<span class="eyebrow">Community</span><h1>Prayer Wall</h1>
   <p class="notice">${!user?"Sign in through More to view member prayer requests.":"Your membership must be approved before you can access prayer requests."}</p>`;
   return;
 }
 root.innerHTML=baseScreen();
 root.querySelector("#prayerForm").addEventListener("submit",submitPrayer);
 root.addEventListener("click",handleClick);
 watchFeed();
}
