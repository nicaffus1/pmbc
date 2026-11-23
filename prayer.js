// PMBC Prayer Wall — real Cloud Firestore data, no sample requests.
import { db } from "./firebase.js";
import {
  collection, doc, addDoc, getDoc, setDoc, deleteDoc, updateDoc,
  serverTimestamp, increment, query, where, onSnapshot
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
let ownPrayerListeners = new Map();
let prayerRefreshTimer = null;
const PRAYER_COOLDOWN_MS = 60 * 60 * 1000;
function cooldownRemaining(id){
 const last=prayed.get(id);
 const millis=last?.toMillis?.();
 return millis===undefined?0:Math.max(0,millis+PRAYER_COOLDOWN_MS-Date.now());
}

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
 <p class="muted">Tap a name to read the request. Check the circle to record a prayer; it becomes available again after one hour.</p>
 <div id="prayerNotice" class="notice" hidden></div>
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
 </details>
 <section aria-label="Church prayer list">
   <h2>Church Prayer List</h2>
   <p class="prayer-list-guidance">A checkmark means you prayed within the past hour. You can record another prayer after one hour.</p>
   <div id="prayerList" aria-live="polite"><p class="muted">Loading requests…</p></div>
 </section>
 <section id="prayerDetail" aria-live="polite"></section>`;
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
   const canViewTotal=isAdmin();
   const waiting=cooldownRemaining(id)>0;
   const total=prayerTotals.get(id);
   return `<div class="prayer-list-row ${id===selectedPrayerId?"selected":""}">
     <button class="prayer-person" type="button" data-select-prayer="${esc(id)}"
       aria-pressed="${id===selectedPrayerId?"true":"false"}">
       <span class="prayer-person-name">${esc(prayerName(p))}</span>
       ${p.visibility==="leadership"?'<span class="pill warning">Private</span>':""}
       ${canViewTotal&&total!==undefined?`<span class="prayer-count">${total} prayers</span>`:""}
       <span class="prayer-person-arrow" aria-hidden="true">›</span>
     </button>
     <button class="prayer-check ${waiting?"prayed":""}" type="button" data-prayed="${esc(id)}"
       aria-label="${waiting?"Prayer recorded; available again in one hour for":"I prayed for"} ${esc(prayerName(p))}"
       title="${waiting?"Already recorded; available again one hour after your last prayer":"Tap to record a prayer"}"
       ${busy||waiting?"disabled":""}>${waiting?"✓":"○"}</button>
   </div>`;
 }).join("");
 if(!selectedPrayerId){
   details.innerHTML='';
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
   ${isAdmin()?`<p class="prayer-total">${total===undefined?"Loading prayer count…":total+" prayers recorded"}</p>`:""}
   ${canEdit?`<button class="button outline" type="button" data-edit-prayer="${esc(selectedPrayerId)}">Edit / Answer / Remove Request</button>`:""}
 </article>`;
 list.querySelector(".prayer-list-row.selected")?.append(details.firstElementChild);
}
function syncPrayed(){
 const active=new Set(requestsById.keys());
 for(const [id,stop] of ownPrayerListeners){
   if(active.has(id))continue;
   try{stop();}catch{}
   ownPrayerListeners.delete(id);
   prayed.delete(id);
 }
 for(const id of active){
   if(ownPrayerListeners.has(id))continue;
   const marker=session;
   // Only the current member's own timestamp is fetched, never anybody else's.
   const stop=onSnapshot(doc(db,"prayers",id,"prayedBy",currentUser.uid),snap=>{
     if(marker!==session)return;
     const timestamp=snap.exists()?(snap.data().lastPrayedAt||snap.data().createdAt):null;
     prayed.set(id,timestamp||null);
     drawList();
   },error=>{
     if(marker!==session)return;
     setNotice("Unable to check your prayer status ("+(error.code||"error")+").",true);
   });
   ownPrayerListeners.set(id,stop);
 }
}
function syncTotals(){
 const keep=new Set();
 for(const [id,p] of activeRequests()){
   if(!isAdmin())continue;
   keep.add(id);
   if(totalListeners.has(id))continue;
   const marker=session;
   const unsubscribe=onSnapshot(collection(db,"prayers",id,"prayedBy"),snapshot=>{
     if(marker!==session)return;
     const total=snapshot.docs.reduce((sum,d)=>sum+(Number.isInteger(d.data().count)?d.data().count:1),0);
     prayerTotals.set(id,total);
     drawList();
   },error=>{
     if(marker!==session)return;
     prayerTotals.delete(id);
     setNotice("Unable to load your prayer totals ("+(error.code||"error")+"). The updated Firestore rules may need publishing.",true);
   });
   totalListeners.set(id,unsubscribe);
 }
 for(const [id,stop] of totalListeners){
   if(keep.has(id))continue;
   try{stop();}catch{}
   totalListeners.delete(id);
   prayerTotals.delete(id);
 }
}
function updateFeed(feedName,snapshot,streams){
 const set=new Map(snapshot.docs.map(d=>[d.id,d.data()]));
 streams.set(feedName,set);
 requestsById=new Map();
 for(const entries of streams.values())for(const [id,p] of entries)requestsById.set(id,p);
 syncPrayed();
 syncTotals();
 drawList();
}
function watchFeed(){
 const streams=new Map();
 const jobs=isAdmin()
  ? [{name:"all",ref:query(collection(db,"prayers"),where("status","==","active"))}]
  : [
      {name:"members",ref:query(collection(db,"prayers"),
        where("visibility","==","members"),where("status","==","active"))},
      {name:"mine",ref:query(collection(db,"prayers"),
        where("authorId","==",currentUser.uid),where("status","==","active"))}
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
      errors.push(error.code==="failed-precondition"
        ?"A Firestore query index may be needed for the prayer list. Check the link in the Firebase error message."
        :"Cannot load prayer requests. Check that the updated Firestore rules are published ("+(error.code||"network error")+").");
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
 const subject=form.elements.namedItem("subjectName");
 subject.disabled=false;
 subject.required=true;
 form.elements.namedItem("text").required=true;
 form.elements.namedItem("text").placeholder="How can we pray?";
 subject.placeholder="Enter a name";
 form.elements.namedItem("status").value="active";
 currentRoot.querySelector("#savePrayer").textContent="Post Prayer Request";
 currentRoot.querySelector("#cancelPrayerEdit").hidden=true;
 currentRoot.querySelector("#prayerStatusSection").hidden=true;
 currentRoot.querySelector("#prayerComposer").open=false;
}
function toggleUnspoken(){
 const form=currentRoot?.querySelector("#prayerForm");
 if(!form)return;
 const input=form.elements.namedItem("subjectName");
 const checked=form.elements.namedItem("unspoken").checked;
 input.disabled=checked;
 input.required=!checked;
 const details=form.elements.namedItem("text");
 details.required=!checked;
 if(checked)input.value="";
 input.placeholder=checked?"Unspoken":"Enter a name";
 details.placeholder=checked?"Details optional for an unspoken request":"How can we pray?";
}
async function submitPrayer(e){
 e.preventDefault();
 if(!canSeePrivate()||busy)return;
 const f=e.currentTarget;
 const suppliedText=String(f.elements.namedItem("text").value).trim();
 const visibility=f.elements.namedItem("visibility").value;
 const status=f.elements.namedItem("status").value;
 const unspoken=f.elements.namedItem("unspoken").checked;
 const subjectName=unspoken?"Unspoken":String(f.elements.namedItem("subjectName").value).trim();
 const text=unspoken&&!suppliedText?"Unspoken prayer request.":suppliedText;
 if(subjectName.length<2||subjectName.length>80){
   setNotice("Enter a name or check Unspoken.",true);return;
 }
 if(text.length<3||text.length>2000){
   setNotice("Please enter a request between 3 and 2,000 characters.",true);return;
 }
 if(!["members","leadership"].includes(visibility)){
   setNotice("Choose who can view the request.",true);return;
 }
 if(activeEdit&&!["active","answered","removed"].includes(status)){
   setNotice("Choose a valid request status.",true);return;
 }
 busy=true;
 const btn=currentRoot.querySelector("#savePrayer");btn.disabled=true;
 try{
   if(activeEdit){
     await updateDoc(doc(db,"prayers",activeEdit),{
       text,subjectName,visibility,status,updatedAt:serverTimestamp()
     });
     resetEdit();
     setNotice(status==="active"?"Your prayer request was updated.":"Request removed from the active prayer list.");
   }else{
     await addDoc(collection(db,"prayers"),{
       text,subjectName,visibility,status:"active",authorId:currentUser.uid,
       authorName:currentProfile.displayName,
       createdAt:serverTimestamp(),updatedAt:serverTimestamp()
     });
     resetEdit();
     setNotice("Your prayer request was posted to the prayer list.");
   }
 }catch(err){
   setNotice("Couldn't save the request ("+(err.code||"unknown error")+
     "). Check your connection and Firestore rules.",true);
 }finally{busy=false;if(btn?.isConnected)btn.disabled=false;}
}
async function markPrayed(id){
 const request=requestsById.get(id);
 if(busy||request?.status!=="active"||!canSeePrivate())return;
 if(cooldownRemaining(id)>0){
   setNotice("You can record another prayer for this request one hour after your last one.");
   drawList();
   return;
 }
 busy=true;
 drawList();
 try{
   const vote=doc(db,"prayers",id,"prayedBy",currentUser.uid);
   const existing=await getDoc(vote);
   const last=existing.exists()?(existing.data().lastPrayedAt||existing.data().createdAt):null;
   if(last?.toMillis && last.toMillis()+PRAYER_COOLDOWN_MS>Date.now()){
     prayed.set(id,last);
     setNotice("This prayer has already been recorded. The check resets one hour after your last prayer.");
     return;
   }
   if(existing.exists()){
     // A legacy acknowledgement without a count starts at one.
     const value=Number.isInteger(existing.data().count)?increment(1):2;
     await updateDoc(vote,{count:value,lastPrayedAt:serverTimestamp()});
   }else{
     await setDoc(vote,{count:1,createdAt:serverTimestamp(),lastPrayedAt:serverTimestamp()});
   }
   setNotice("Prayer recorded. You can pray again in one hour.");
 }catch(err){
   setNotice(err.code==="permission-denied"
     ?"Prayer couldn't be recorded. You may still be within the one-hour limit, or the updated Firebase rules need publishing."
     :"Couldn't record your prayer ("+(err.code||"network error")+").",true);
 }finally{busy=false;drawList();}
}
function edit(id){
 const p=requestsById.get(id);
 if(!p||!(p.authorId===currentUser.uid||isAdmin()))return;
 activeEdit=id;
 const f=currentRoot.querySelector("#prayerForm");
 const name=p.subjectName||p.authorName||"Church Member";
 const unspoken=name==="Unspoken";
 f.elements.namedItem("unspoken").checked=unspoken;
 f.elements.namedItem("subjectName").value=unspoken?"":name;
 toggleUnspoken();
 f.elements.namedItem("text").value=p.text;
 f.elements.namedItem("visibility").value=p.visibility;
 f.elements.namedItem("status").value=p.status;
 currentRoot.querySelector("#savePrayer").textContent="Save Changes";
 currentRoot.querySelector("#cancelPrayerEdit").hidden=false;
 currentRoot.querySelector("#prayerStatusSection").hidden=false;
 currentRoot.querySelector("#prayerComposer").open=true;
 currentRoot.querySelector("#prayerComposer").scrollIntoView({behavior:"smooth",block:"start"});
}
function handleClick(e){
 const b=e.target.closest("button");if(!b)return;
 if(b.dataset.selectPrayer){
   selectedPrayerId=b.dataset.selectPrayer===selectedPrayerId?"":b.dataset.selectPrayer;
   drawList();
 }else if(b.dataset.prayed){
   markPrayed(b.dataset.prayed);
 }else if(b.dataset.editPrayer){
   edit(b.dataset.editPrayer);
 }else if(b.id==="cancelPrayerEdit"){
   resetEdit();setNotice("");
 }
}
export function unmountPrayer(){
 session++;
 for(const fn of cleanup){try{fn();}catch{}}
 for(const stop of totalListeners.values()){try{stop();}catch{}}
 for(const stop of ownPrayerListeners.values()){try{stop();}catch{}}
 if(prayerRefreshTimer!==null){clearInterval(prayerRefreshTimer);prayerRefreshTimer=null;}
 cleanup=[];requestsById=new Map();prayed=new Map();loaded=new Set();errors=[];
 totalListeners=new Map();ownPrayerListeners=new Map();prayerTotals=new Map();selectedPrayerId="";
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
 root.querySelector("#prayerUnspoken").addEventListener("change",toggleUnspoken);
 root.addEventListener("click",handleClick);
 // An open page automatically unlocks prayer checks when the hour expires.
 prayerRefreshTimer=setInterval(()=>{if(currentRoot)drawList();},15000);
 watchFeed();
}
