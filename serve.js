// PMBC Serve — ministry positions and member opt-in, backed by Firestore.
import { db } from "./firebase.js";
import {
  collection, doc, addDoc, setDoc, deleteDoc, updateDoc,
  onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js";

const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({
 "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
}[c]));

let root=null, account=null, profile=null, sequence=0;
let stops=[], ministries=new Map(), positions=new Map();
let shifts=new Map(), shiftJoined=new Map(), shiftRosters=new Map();
let rosterSubscriptions=new Map();
let knownPositionListeners=new Set(), knownShiftListeners=new Set(), pendingWrites=new Set();
let watchedMinistries=new Set();
let selectedMinistryId="", expandedPanels=new Set(), selectedPositionByMinistry=new Map();

const approved=()=>!!account && profile?.status==="approved";
const admin=()=>approved() && profile?.role==="admin";
const positionKey=(mid,pid)=>mid+"/"+pid;
const shiftKey=(mid,pid,sid)=>mid+"/"+pid+"/"+sid;

function notice(message,isError=false){
 const el=root?.querySelector("#serveMessage");
 if(!el)return;
 el.hidden=!message;
 el.className=isError?"error":"notice";
 el.textContent=message;
}

function chicagoNow(){
 const fields={};
 for(const part of new Intl.DateTimeFormat("en-US",{timeZone:"America/Chicago",
  year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",
  minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date()))fields[part.type]=part.value;
 return fields.year+"-"+fields.month+"-"+fields.day+"T"+fields.hour+":"+fields.minute;
}
function showShiftTime(value){
 const date=value?.slice(0,10), time=value?.slice(11);
 if(!date||!time)return esc(value);
 const [y,m,d]=date.split("-").map(Number);
 const [h,min]=time.split(":").map(Number);
 return esc(new Date(y,m-1,d).toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"})
 +" · "+new Date(2000,0,1,h,min).toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"}));
}
function shiftList(mid,pid){
 const list=[...(shifts.get(positionKey(mid,pid))?.values()||[])].filter(x=>x.active)
   .sort((a,b)=>a.startsAt.localeCompare(b.startsAt));
 const rows=list.map(x=>{
  const key=shiftKey(mid,pid,x.id), signed=shiftJoined.get(key)===true;
  const past=x.endsAt<chicagoNow();
  const visibility=x.rosterVisibility||"members";
  const audienceAllowed=admin()||visibility==="members";
  const roster=shiftRosters.get(key);
  const rosterMarkup=audienceAllowed?
    `<div class="shift-roster">
      <strong>Volunteers (${roster?.length??"…"})</strong>
      ${!roster?'<p class="muted">Loading volunteers…</p>':
        roster.length?`<ul>${roster.map(m=>"<li>"+esc(m.memberName||"Church Member")+"</li>").join("")}</ul>`:
        '<p class="muted">No volunteers signed up yet.</p>'}
    </div>`:
    '<p class="section-note">Volunteer names are currently restricted to administrators.</p>';
  return `<div class="shift-entry">
    <strong>${showShiftTime(x.startsAt)} to ${showShiftTime(x.endsAt).split(" · ").pop()} CT</strong>
    ${x.notes?`<p>${esc(x.notes)}</p>`:""}
    ${rosterMarkup}
    <div class="shift-primary-actions">
      <button class="button ${signed?"outline":""}" type="button" data-toggle-shift
        data-mid="${esc(mid)}" data-pid="${esc(pid)}" data-sid="${esc(x.id)}"
        ${pendingWrites.has("shift:"+key)||(!signed&&past)?"disabled":""}>
        ${signed?"✓ Signed Up — Cancel Shift":past?"Shift Ended":"Sign Up for Shift"}
      </button>
    </div>
    ${admin()?`<details class="manage-menu" data-panel="manage-shift:${esc(mid)}:${esc(pid)}:${esc(x.id)}">
      <summary>Manage this shift</summary>
      <div class="manage-menu-body">
        ${visibility!=="members"?`<button type="button" class="button outline roster-share"
          data-share-roster data-mid="${esc(mid)}" data-pid="${esc(pid)}" data-sid="${esc(x.id)}">
          Share volunteer names with members</button>`:""}
        <button type="button" class="button outline remove-control"
          data-archive-item="shift" data-mid="${esc(mid)}" data-pid="${esc(pid)}" data-sid="${esc(x.id)}">
          Remove this shift</button>
      </div>
    </details>`:""}
  </div>`;
 }).join("");
 return `<div class="shift-list"><h4>Scheduled Shifts</h4>
  ${rows||'<p class="muted">No scheduled shifts yet.</p>'}
  ${admin()?`<details class="admin-expander add-shift-control" data-panel="shift:${esc(mid)}:${esc(pid)}"><summary>+ Add a shift</summary>
  <form class="stack shift-form" data-shift-form data-mid="${esc(mid)}" data-pid="${esc(pid)}">
    <label>Shift date<input class="field" name="date" type="date" required></label>
    <div class="shift-time-row">
      <label>Start time<input class="field" name="start" type="time" required></label>
      <label>End time<input class="field" name="end" type="time" required></label>
    </div>
    <label>Notes (optional)<input class="field" name="notes" maxlength="300"></label>
    <p class="section-note">Volunteer names are visible to all approved members and administrators.</p>
    <p class="section-note">Times are Central Time. Each shift starts and ends on the same day.</p>
    <button class="button outline" type="submit">Save Shift</button>
  </form></details>`:""}
  ${admin()?archivedShiftsUI(mid,pid):""}
 </div>`;
}
function watchShiftRoster(mid,pid,shift,token){
 const key=shiftKey(mid,pid,shift.id);
 const allowed=admin()||!shift.rosterVisibility||shift.rosterVisibility==="members";
 const subscribed=rosterSubscriptions.get(key);
 if(!allowed){
   if(subscribed){subscribed();rosterSubscriptions.delete(key);}
   shiftRosters.delete(key);
   return;
 }
 if(subscribed)return;
 const unsub=onSnapshot(collection(db,"ministries",mid,"positions",pid,"shifts",shift.id,"signups"),snapshot=>{
   if(token!==sequence)return;
   shiftRosters.set(key,snapshot.docs.map(d=>({id:d.id,...d.data()}))
     .sort((a,b)=>(a.memberName||"").localeCompare(b.memberName||"")));
   draw();
 },error=>{
   if(token!==sequence)return;
   notice("Couldn't load the volunteer roster ("+(error.code||"error")+").",true);
 });
 rosterSubscriptions.set(key,unsub);
}

function watchShiftSignup(mid,pid,sid,token){
 const key=shiftKey(mid,pid,sid);
 if(knownShiftListeners.has("signup:"+key))return;
 knownShiftListeners.add("signup:"+key);
 stops.push(onSnapshot(doc(db,"ministries",mid,"positions",pid,"shifts",sid,"signups",account.uid),snap=>{
   if(token!==sequence)return;
   shiftJoined.set(key,snap.exists());draw();
 },error=>{
   if(token===sequence)notice("Unable to check shift signup ("+(error.code||"error")+").",true);
 }));
}
function watchShifts(mid,pid,token){
 const key=positionKey(mid,pid);
 if(knownShiftListeners.has("shifts:"+key))return;
 knownShiftListeners.add("shifts:"+key);
 stops.push(onSnapshot(collection(db,"ministries",mid,"positions",pid,"shifts"),snap=>{
   if(token!==sequence)return;
   shifts.set(key,new Map(snap.docs.map(d=>[d.id,{id:d.id,...d.data()}])));
   for(const item of shifts.get(key).values()){
     if(item.active){
       watchShiftSignup(mid,pid,item.id,token);
       watchShiftRoster(mid,pid,item,token);
     }
   }
   draw();
 },error=>{
   if(token===sequence)notice("Unable to load shifts ("+(error.code||"error")+"). Check the published Firebase rules.",true);
 }));
}

function archivedShiftsUI(mid,pid){
 const archived=[...(shifts.get(positionKey(mid,pid))?.values()||[])]
  .filter(item=>item.active===false)
  .sort((a,b)=>b.startsAt.localeCompare(a.startsAt));
 if(!archived.length)return "";
 return `<details class="archive-list" data-panel="archived-shifts:${esc(mid)}:${esc(pid)}">
 <summary>Removed Shifts (${archived.length})</summary>
 ${archived.map(item=>`<div class="archive-row"><span>${showShiftTime(item.startsAt)}</span>
  <button type="button" class="button outline" data-restore-item="shift"
   data-mid="${esc(mid)}" data-pid="${esc(pid)}" data-sid="${esc(item.id)}">Restore</button></div>`).join("")}
 </details>`;
}
function archivedPositionsUI(mid){
 const archived=[...(positions.get(mid)?.values()||[])].filter(item=>item.active===false)
  .sort((a,b)=>a.title.localeCompare(b.title));
 if(!archived.length)return "";
 return `<details class="archive-list" data-panel="archived-positions:${esc(mid)}">
 <summary>Removed Positions (${archived.length})</summary>
 ${archived.map(item=>`<div class="archive-row"><span>${esc(item.title)}</span>
 <button type="button" class="button outline" data-restore-item="position"
  data-mid="${esc(mid)}" data-pid="${esc(item.id)}">Restore</button></div>`).join("")}
 </details>`;
}
function archivedMinistriesUI(){
 const archived=[...ministries.values()].filter(item=>item.active===false)
  .sort((a,b)=>a.name.localeCompare(b.name));
 if(!archived.length)return "";
 return `<details class="archive-list archived-ministries" data-panel="archived-ministries">
 <summary>Removed Ministries (${archived.length})</summary>
 ${archived.map(item=>`<div class="archive-row"><span>${esc(item.name)}</span>
 <button type="button" class="button outline" data-restore-item="ministry"
  data-mid="${esc(item.id)}">Restore</button></div>`).join("")}
 </details>`;
}

function positionUI(mid,entry){
 const {id,...data}=entry;
 return `<section class="position-detail" aria-label="Selected volunteer position">
  ${data.description?`<p class="position-description">${esc(data.description)}</p>`:""}
  ${shiftList(mid,id)}
  ${admin()?`<details class="manage-menu position-manage" data-panel="manage-position:${esc(mid)}:${esc(id)}">
   <summary>Manage this position</summary>
   <div class="manage-menu-body">
    <button type="button" class="button outline remove-control"
     data-archive-item="position" data-mid="${esc(mid)}" data-pid="${esc(id)}">Remove this position</button>
   </div>
  </details>`:""}
 </section>`;
}
function ministryUI(entry){
 const {id,...data}=entry;
 const items=[...(positions.get(id)?.values()||[])].filter(p=>p.active)
   .sort((a,b)=>a.title.localeCompare(b.title));
 const current=selectedPositionByMinistry.get(id);
 const selected=items.some(p=>p.id===current)?current:(items[0]?.id||"");
 selectedPositionByMinistry.set(id,selected);
 const chosen=items.find(p=>p.id===selected);
 return `<article class="card ministry-item compact-ministry">
  <label class="position-picker-label" for="positionPicker">Select a Volunteer Position</label>
  <select class="field position-picker" id="positionPicker" aria-label="Select a Volunteer Position"
   ${items.length?"":"disabled"}>
   ${items.length?items.map(p=>`<option value="${esc(p.id)}" ${p.id===selected?"selected":""}>${esc(p.title)}</option>`).join(""):
      '<option value="">No volunteer positions yet</option>'}
  </select>
  ${chosen?positionUI(id,chosen):'<p class="muted position-empty">No active volunteer positions in this ministry.</p>'}
  ${admin()?`<section class="ministry-admin-tools" aria-label="Ministry administration">
    <div class="admin-tools-heading">Ministry Administration</div>
    <details class="admin-expander" data-panel="position:${esc(id)}">
      <summary>Add a volunteer position</summary>
      <form class="stack position-form" data-position-form data-mid="${esc(id)}">
        <label>Position name
          <input class="field" name="title" minlength="2" maxlength="80" required
            placeholder="e.g. Classroom Helper"></label>
        <label>Description (optional)
          <textarea class="field" name="description" maxlength="500" rows="2"
            placeholder="What will a volunteer do?"></textarea></label>
        <button class="button" type="submit">Save Position</button>
      </form>
    </details>
    <details class="manage-menu ministry-manage" data-panel="manage-ministry:${esc(id)}">
      <summary>Manage this ministry</summary>
      <div class="manage-menu-body">
        <p class="section-note">Removing a ministry hides its positions and shifts. All records are preserved.</p>
        <button type="button" class="button outline remove-control"
          data-archive-item="ministry" data-mid="${esc(id)}">Remove this ministry</button>
      </div>
    </details>
    ${archivedPositionsUI(id)}
  </section>`:""}
 </article>`;
}
function draw(){
 const area=root?.querySelector("#ministriesList");if(!area)return;
 // Snapshot updates must not collapse an administrator's open form.
 for(const panel of area.querySelectorAll("details[data-panel]")){
   const id=panel.dataset.panel;
   if(panel.open)expandedPanels.add(id);
   else expandedPanels.delete(id);
 }
 const entries=[...ministries.values()].filter(m=>m.active)
   .sort((a,b)=>a.name.localeCompare(b.name));
 const picker=root.querySelector("#ministryPicker");
 if(picker){
   const choices=entries.map(m=>m.id);
   if(!choices.includes(selectedMinistryId))selectedMinistryId=choices[0]||"";
   const desired=choices.join("|");
   if(picker.dataset.options!==desired){
     picker.innerHTML=entries.length?
       entries.map(m=>'<option value="'+esc(m.id)+'">'+esc(m.name)+'</option>').join(""):
       '<option value="">No ministries yet</option>';
     picker.dataset.options=desired;
   }
   picker.value=selectedMinistryId;
 }
 const chosen=entries.find(m=>m.id===selectedMinistryId);
 area.innerHTML=(chosen?ministryUI(chosen):
   '<div class="notice">No active ministries. An administrator can create or restore one.</div>')+
   (admin()?archivedMinistriesUI():"");
 for(const panel of area.querySelectorAll("details[data-panel]")){
   panel.open=expandedPanels.has(panel.dataset.panel);
 }
}
function watchPositions(mid,token){
 if(watchedMinistries.has(mid))return;
 watchedMinistries.add(mid);
 const unsub=onSnapshot(collection(db,"ministries",mid,"positions"),snap=>{
   if(sequence!==token)return;
   const records=new Map(snap.docs.map(d=>[d.id,{id:d.id,...d.data()}]));
   positions.set(mid,records);
   for(const p of records.values())if(p.active)watchShifts(mid,p.id,token);
   draw();
 },err=>{
   if(sequence!==token)return;
   notice("Unable to load volunteer positions ("+(err.code||"network error")+"). Check Firestore rules.",true);
 });
 stops.push(unsub);
}
async function addMinistry(event){
 event.preventDefault();if(!admin())return;
 const form=event.target.closest("#ministryForm");
 if(!form)return;
 const name=String(form.elements.namedItem("ministryName").value).trim();
 const description=String(form.elements.namedItem("ministryDescription").value).trim();
 if(name.length<2||name.length>80||description.length>500){
   notice("Check the ministry name and description lengths.",true);return;
 }
 const button=form.querySelector("button[type=submit]");button.disabled=true;
 try{
   const created=await addDoc(collection(db,"ministries"),{
     name,description,active:true,createdBy:account.uid,createdAt:serverTimestamp()
   });
   selectedMinistryId=created.id;
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
 const title=String(form.elements.namedItem("title").value).trim();
 const description=String(form.elements.namedItem("description").value).trim();
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
async function addShift(event){
 event.preventDefault();
 const form=event.target.closest("[data-shift-form]");
 if(!form||!admin())return;
 const mid=form.dataset.mid,pid=form.dataset.pid;
 if(!ministries.get(mid)?.active||!positions.get(mid)?.get(pid)?.active)return;
 const date=form.elements.namedItem("date").value;
 const start=form.elements.namedItem("start").value;
 const end=form.elements.namedItem("end").value;
 const notes=form.elements.namedItem("notes").value.trim();
 const startsAt=date+"T"+start, endsAt=date+"T"+end;
 const validDateTime=new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}$");
 if(!validDateTime.test(startsAt)||!validDateTime.test(endsAt)
   ||endsAt<=startsAt||notes.length>300){
   notice("Enter a valid date and a later end time on the same day.",true);return;
 }
 const button=form.querySelector("[type=submit]");button.disabled=true;
 try{
   await addDoc(collection(db,"ministries",mid,"positions",pid,"shifts"),{
     startsAt,endsAt,timeZone:"America/Chicago",notes,active:true,
     rosterVisibility:"members",
     createdBy:account.uid,createdAt:serverTimestamp()
   });
   form.reset();notice("Scheduled shift added.");
 }catch(error){
   notice("Couldn't add shift ("+(error.code||"error")+"). Check the new Firebase rules.",true);
 }finally{if(button.isConnected)button.disabled=false;}
}
async function toggleShift(button){
 if(!approved())return;
 const mid=button.dataset.mid,pid=button.dataset.pid,sid=button.dataset.sid;
 const key=shiftKey(mid,pid,sid), lock="shift:"+key;
 const item=shifts.get(positionKey(mid,pid))?.get(sid);
 if(pendingWrites.has(lock)||!ministries.get(mid)?.active
   ||!positions.get(mid)?.get(pid)?.active||!item?.active)return;
 const alreadyJoined=shiftJoined.get(key)===true;
 if(!alreadyJoined&&item.endsAt<chicagoNow()){
   notice("This shift has ended.",true);return;
 }
 pendingWrites.add(lock);draw();
 const ref=doc(db,"ministries",mid,"positions",pid,"shifts",sid,"signups",account.uid);
 try{
   if(alreadyJoined)await deleteDoc(ref);
   else await setDoc(ref,{
     memberId:account.uid,memberName:profile.displayName,createdAt:serverTimestamp()
   });
   shiftJoined.set(key,!alreadyJoined);
   notice(alreadyJoined?"Your shift sign-up was canceled.":"You are signed up for this shift.");
 }catch(error){
   notice("Couldn't change shift signup ("+(error.code||"error")+"). Check Firebase rules.",true);
 }finally{pendingWrites.delete(lock);draw();}
}

function onChange(event){
 if(event.target.id==="ministryPicker"){
   selectedMinistryId=event.target.value;
   expandedPanels.clear();
   draw();
 }else if(event.target.id==="positionPicker"){
   selectedPositionByMinistry.set(selectedMinistryId,event.target.value);
   expandedPanels.clear();
   draw();
 }
}
async function shareRoster(button){
 if(!admin())return;
 const {mid,pid,sid}=button.dataset;
 const item=shifts.get(positionKey(mid,pid))?.get(sid);
 if(!item||item.rosterVisibility==="members")return;
 if(!window.confirm("Make the volunteer names for this shift visible to all approved members?"))return;
 const lock="roster:"+shiftKey(mid,pid,sid);
 if(pendingWrites.has(lock))return;
 pendingWrites.add(lock);
 try{
   await updateDoc(doc(db,"ministries",mid,"positions",pid,"shifts",sid),{
     rosterVisibility:"members"
   });
   notice("Volunteer names are now visible to approved members.");
 }catch(error){
   notice("Couldn't share volunteer names ("+(error.code||"error")+").",true);
 }finally{pendingWrites.delete(lock);}
}

async function setArchived(type,mid,pid,sid,archive){
 if(!admin())return;
 const entity=type==="ministry"?ministries.get(mid):
   type==="position"?positions.get(mid)?.get(pid):
     shifts.get(positionKey(mid,pid))?.get(sid);
 if(!entity)return;
 if(archive && entity.active===false)return;
 if(!archive && entity.active!==false)return;
 const label=type==="ministry"?entity.name:type==="position"?entity.title:
   showShiftTime(entity.startsAt);
 if(archive){
   const affected=type==="ministry"?
     " Its volunteer positions and shifts will be hidden, but their records and sign-ups are preserved.":
     type==="position"?
       " Its shifts and volunteer sign-ups will be preserved.":
       " Existing volunteer sign-ups will be preserved.";
   if(!window.confirm("Remove "+type+" '"+label+"' from active Serve opportunities?"+affected+
     " You can restore it later."))return;
 }
 const key="archive:"+type+":"+mid+":"+(pid||"")+":"+(sid||"");
 if(pendingWrites.has(key))return;
 pendingWrites.add(key);
 const path=type==="ministry"?["ministries",mid]:
   type==="position"?["ministries",mid,"positions",pid]:
     ["ministries",mid,"positions",pid,"shifts",sid];
 try{
   await updateDoc(doc(db,...path),{active:!archive});
   // Reconcile the local selector immediately after a confirmed Firestore write.
   // The live subscription will subsequently refresh this same record.
   const updated={...entity,active:!archive};
   if(type==="ministry"){
     ministries.set(mid,updated);
     if(archive && selectedMinistryId===mid){
       selectedMinistryId="";
       expandedPanels.clear();
     }
   }else if(type==="position"){
     positions.get(mid)?.set(pid,updated);
     if(archive && selectedPositionByMinistry.get(mid)===pid){
       selectedPositionByMinistry.delete(mid);
       expandedPanels.clear();
     }
   }else{
     shifts.get(positionKey(mid,pid))?.set(sid,updated);
   }
   draw();
   notice(type[0].toUpperCase()+type.slice(1)+(archive?" removed.":" restored.")+
     " Existing volunteer history was preserved.");
 }catch(error){
   notice("Couldn't "+(archive?"remove":"restore")+" "+type+" ("+
     (error.code||"error")+"). The updated Firebase rules may need publishing.",true);
 }finally{pendingWrites.delete(key);}
}

function onClick(event){
 const removeButton=event.target.closest("[data-archive-item]");
 if(removeButton){
   const {mid,pid,sid,archiveItem}=removeButton.dataset;
   setArchived(archiveItem,mid,pid,sid,true);return;
 }
 const restoreButton=event.target.closest("[data-restore-item]");
 if(restoreButton){
   const {mid,pid,sid,restoreItem}=restoreButton.dataset;
   setArchived(restoreItem,mid,pid,sid,false);return;
 }
 const share=event.target.closest("[data-share-roster]");
 if(share){shareRoster(share);return;}
 const shiftButton=event.target.closest("[data-toggle-shift]");
 if(shiftButton)toggleShift(shiftButton);
}
function onSubmit(event){
 if(event.target.matches("#ministryForm")){addMinistry(event);return;}
 if(event.target.matches("[data-position-form]")){addPosition(event);return;}
 if(event.target.matches("[data-shift-form]"))addShift(event);
}
export function unmountServe(){
 sequence++;
 for(const unsub of stops){try{unsub();}catch{}}
 for(const unsub of rosterSubscriptions.values()){try{unsub();}catch{}}
 rosterSubscriptions=new Map();
 stops=[];ministries=new Map();positions=new Map();
 shifts=new Map();shiftJoined=new Map();shiftRosters=new Map();
 knownPositionListeners=new Set();knownShiftListeners=new Set();pendingWrites=new Set();watchedMinistries=new Set();
 selectedMinistryId="";expandedPanels=new Set();selectedPositionByMinistry=new Map();
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
 <p class="muted">Find a ministry and sign up for a scheduled shift.</p>
 <div id="serveMessage" hidden></div>
 ${admin()?`<details class="card admin-expander ministry-composer" id="ministryComposer">
  <summary>Create a Ministry</summary>
  <form id="ministryForm" class="stack">
   <label for="ministryName">Ministry name</label>
   <input class="field" id="ministryName" name="ministryName" minlength="2" maxlength="80" required>
   <label for="ministryDescription">Description (optional)</label>
   <textarea class="field" id="ministryDescription" name="ministryDescription" rows="3" maxlength="500"></textarea>
   <button class="button" type="submit">Add Ministry</button>
  </form>
 </details>`:""}
 <h2>Church Ministries</h2>
 <label class="ministry-picker-label" for="ministryPicker">Select a Ministry</label>
 <select id="ministryPicker" class="field" aria-label="Select a Ministry"></select>
 <div id="ministriesList" aria-live="polite"><p class="muted">Loading ministries…</p></div>`;
 root.addEventListener("submit",onSubmit);
 root.addEventListener("click",onClick);
 root.addEventListener("change",onChange);
 const token=sequence;
 stops.push(onSnapshot(collection(db,"ministries"),snap=>{
   if(token!==sequence)return;
   for(const d of snap.docs){
     if(d.data().active)watchPositions(d.id,token);
   }
   ministries=new Map(snap.docs.map(d=>[d.id,{id:d.id,...d.data()}]));
   draw();
 },err=>{
   if(token!==sequence)return;
   root.querySelector("#ministriesList").innerHTML=
    '<p class="error">Unable to load ministries ('+esc(err.code||"network error")+').</p>';
 }));
}
