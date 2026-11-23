// PMBC Serve — ministry positions and member opt-in, backed by Firestore.
import { db } from "./firebase.js";
import {
  collection, doc, addDoc, setDoc, deleteDoc, updateDoc,
  onSnapshot, serverTimestamp, runTransaction
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
let clockRefresh=null;
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
function shiftEnd(startsAt){
 if(!/^[0-9]{4}-[0-9]{2}-[0-9]{2}T(?:[01][0-9]|2[0-3]):(?:00|30)$/.test(startsAt))
   throw new Error("Choose a start time in 30-minute increments.");
 const start=new Date(startsAt+":00Z");
 if(Number.isNaN(start.getTime())||start.toISOString().slice(0,16)!==startsAt)
   throw new Error("Choose a valid date and start time.");
 return new Date(start.getTime()+3600000).toISOString().slice(0,16);
}
function startOptions(selected="09:00"){
 return Array.from({length:48},(_,i)=>{
  const time=String(Math.floor(i/2)).padStart(2,"0")+":"+(i%2?"30":"00");
  const label=new Date(2000,0,1,Math.floor(i/2),i%2?30:0)
   .toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"});
  return `<option value="${time}" ${time===selected?"selected":""}>${label}</option>`;
 }).join("");
}
function roundedStart(value){
 if(!/^[0-9]{2}:[0-9]{2}$/.test(value))return "09:00";
 const minutes=Number(value.slice(0,2))*60+Number(value.slice(3));
 const nearest=Math.min(47,Math.max(0,Math.round(minutes/30)));
 return String(Math.floor(nearest/2)).padStart(2,"0")+":"+(nearest%2?"30":"00");
}
function shiftList(mid,pid){
 const list=[...(shifts.get(positionKey(mid,pid))?.values()||[])].filter(x=>x.active && x.endsAt>chicagoNow())
   .sort((a,b)=>a.startsAt.localeCompare(b.startsAt));
 const rows=list.map(x=>{
  const key=shiftKey(mid,pid,x.id), signed=shiftJoined.get(key)===true;
  const past=x.endsAt<chicagoNow();
  const visibility=x.rosterVisibility||"members";
  const audienceAllowed=admin()||visibility==="members";
  const roster=shiftRosters.get(key);
  const limit=Number.isInteger(x.capacity)&&x.capacity>0?x.capacity:0;
  const used=Number.isInteger(x.signupCount)?x.signupCount:(roster?.length??0);
  const full=limit>0&&used>=limit;
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
    <div class="shift-capacity ${full?"is-full":""}">${limit?`<strong>${full?"Shift Full":Math.max(0,limit-used)+" of "+limit+" spots open"}</strong><span>${used} signed up</span>`:"<span>Open volunteer sign-up</span>"}</div>
    ${rosterMarkup}
    <div class="shift-primary-actions">
      <button class="button ${signed?"outline":""}" type="button" data-toggle-shift
        data-mid="${esc(mid)}" data-pid="${esc(pid)}" data-sid="${esc(x.id)}"
        ${pendingWrites.has("shift:"+key)||(!signed&&(past||full))?"disabled":""}>
        ${signed?"✓ Signed Up — Cancel Shift":past?"Shift Ended":full?"Shift Full":"Sign Up for Shift"}
      </button>
    </div>
    ${admin()?`<details class="manage-menu" data-panel="manage-shift:${esc(mid)}:${esc(pid)}:${esc(x.id)}">
      <summary>Manage this shift</summary>
      <div class="manage-menu-body">
        <details class="edit-panel" data-panel="edit-shift:${esc(mid)}:${esc(pid)}:${esc(x.id)}">
          <summary>Edit shift</summary>
          <form class="stack edit-form" data-edit-shift-form data-mid="${esc(mid)}"
            data-pid="${esc(pid)}" data-sid="${esc(x.id)}">
            <label>Shift date
              <input class="field" type="date" name="date" value="${esc(x.startsAt.slice(0,10))}" required></label>
            <label>Start time
              <select class="field" name="start" required>${startOptions(roundedStart(x.startsAt.slice(11,16)))}</select></label>
            <p class="section-note">Duration: 1 hour automatically.</p>
            <label>Volunteer limit (0 = unlimited)<input class="field" type="number" name="capacity" min="0" max="50" value="${Number.isInteger(x.capacity)?x.capacity:0}" required></label>
            <label>Notes (optional)
              <input class="field" name="notes" maxlength="300" value="${esc(x.notes||"")}"></label>
            <button class="button" type="submit">Save changes</button>
          </form>
        </details>
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
    <label>Start time
      <select class="field" name="start" required>${startOptions()}</select>
    </label>
    <label>Notes (optional)<input class="field" name="notes" maxlength="300"></label>
    <label>Volunteer limit (0 = unlimited)<input class="field" type="number" name="capacity" min="0" max="50" value="0" required></label>
    <p class="section-note">Volunteer names are visible to all approved members and administrators.</p>
    <p class="section-note">Every shift lasts one hour. Choose a start time in 30-minute steps (Central Time).</p>
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
    <details class="edit-panel" data-panel="edit-position:${esc(mid)}:${esc(id)}">
      <summary>Edit position</summary>
      <form class="stack edit-form" data-edit-position-form data-mid="${esc(mid)}" data-pid="${esc(id)}">
        <label>Position name
          <input class="field" name="title" minlength="2" maxlength="80" value="${esc(data.title)}" required></label>
        <label>Description (optional)
          <textarea class="field" name="description" rows="3" maxlength="500">${esc(data.description||"")}</textarea></label>
        <button class="button" type="submit">Save changes</button>
      </form>
    </details>
    <button type="button" class="button outline remove-control"
     data-archive-item="position" data-mid="${esc(mid)}" data-pid="${esc(id)}">Remove this position</button>
   </div>
  </details>`:""}
 </section>`;
}
function ministryAdministrationUI(entry){
 if(!admin())return "";
 const mid=entry?.id||"";
 return `<details class="ministry-manage-panel" data-panel="manage-all-ministries">
   <summary>Manage Ministries</summary>
   <div class="ministry-manage-content">
     <details class="admin-expander" data-panel="create-ministry">
       <summary>+ Create a ministry</summary>
       <form id="ministryForm" class="stack">
         <label for="ministryName">Ministry name</label>
         <input class="field" id="ministryName" name="ministryName" minlength="2" maxlength="80" required>
         <label for="ministryDescription">Description (optional)</label>
         <textarea class="field" id="ministryDescription" name="ministryDescription" rows="3" maxlength="500"></textarea>
         <button class="button" type="submit">Add Ministry</button>
       </form>
     </details>
     ${entry?`<details class="manage-menu ministry-manage" data-panel="remove-ministry:${esc(mid)}">
       <summary>Remove selected ministry</summary>
       <div class="manage-menu-body">
         <p class="section-note">Remove ${esc(entry.name)} from active ministries. Its positions, shifts, and sign-ups will be preserved.</p>
         <button type="button" class="button outline remove-control"
           data-archive-item="ministry" data-mid="${esc(mid)}">Remove ${esc(entry.name)}</button>
       </div>
     </details>`:""}
     ${archivedMinistriesUI()}
   </div>
 </details>`;
}
function ministryUI(entry){
 const {id}=entry;
 const items=[...(positions.get(id)?.values()||[])].filter(p=>p.active)
   .sort((a,b)=>a.title.localeCompare(b.title));
 const current=selectedPositionByMinistry.get(id);
 const selected=items.some(p=>p.id===current)?current:(items[0]?.id||"");
 selectedPositionByMinistry.set(id,selected);
 const chosen=items.find(p=>p.id===selected);
 return `<article class="card ministry-item compact-ministry">
  <div class="position-picker-heading">
    <label class="position-picker-label" for="positionPicker">Select a Volunteer Position</label>
    ${admin()?`<details class="position-add-compact" data-panel="position:${esc(id)}">
      <summary>+ Add</summary>
      <form class="stack position-form" data-position-form data-mid="${esc(id)}">
        <label>Position name
          <input class="field" name="title" minlength="2" maxlength="80" required placeholder="e.g. Classroom Helper"></label>
        <label>Description (optional)
          <textarea class="field" name="description" maxlength="500" rows="2" placeholder="What will a volunteer do?"></textarea></label>
        <button class="button" type="submit">Save Position</button>
      </form>
    </details>`:""}
  </div>
  <select class="field position-picker" id="positionPicker" aria-label="Select a Volunteer Position"
   ${items.length?"":"disabled"}>
   ${items.length?items.map(p=>`<option value="${esc(p.id)}" ${p.id===selected?"selected":""}>${esc(p.title)}</option>`).join(""):
      '<option value="">No volunteer positions yet</option>'}
  </select>
  ${admin()?archivedPositionsUI(id):""}
  ${chosen?positionUI(id,chosen):'<p class="muted position-empty">No active volunteer positions in this ministry.</p>'}
 </article>`;
}
function draw(){
 const area=root?.querySelector("#ministriesList");if(!area)return;
 // Preserve expanded sections and unsaved form edits across live Firestore updates.
 const formDrafts=new Map();
 for(const panel of area.querySelectorAll("details[data-panel]")){
   const id=panel.dataset.panel;
   if(panel.open)expandedPanels.add(id);
   else expandedPanels.delete(id);
   if(!panel.open||!id)continue;
   const form=panel.querySelector(":scope > form");
   if(form){
     formDrafts.set(id,Object.fromEntries(
       [...form.querySelectorAll("[name]")].map(control=>[control.name,control.value])
     ));
   }
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
 area.innerHTML=(admin()?ministryAdministrationUI(chosen):"")+
   (chosen?ministryUI(chosen):
   '<div class="notice">No active ministries. An administrator can create or restore one.</div>');
 for(const panel of area.querySelectorAll("details[data-panel]")){
   const id=panel.dataset.panel;
   panel.open=expandedPanels.has(id);
   const draft=formDrafts.get(id);
   if(draft){
     const form=panel.querySelector(":scope > form");
     for(const [name,value] of Object.entries(draft)){
       const control=form?.elements.namedItem(name);
       if(control)control.value=value;
     }
   }
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
 const notes=form.elements.namedItem("notes").value.trim();
 const startsAt=date+"T"+start;
 let endsAt;
 try{endsAt=shiftEnd(startsAt);}
 catch(error){notice(error.message,true);return;}
 if(endsAt<=chicagoNow()){notice("Choose a future shift time.",true);return;}
 if(notes.length>300){notice("Notes must be 300 characters or fewer.",true);return;}
 const button=form.querySelector("[type=submit]");button.disabled=true;
 try{
   await addDoc(collection(db,"ministries",mid,"positions",pid,"shifts"),{
     startsAt,endsAt,timeZone:"America/Chicago",notes,active:true,
     capacity:Number(form.elements.namedItem("capacity").value),signupCount:0,
     rosterVisibility:"members",
     createdBy:account.uid,createdAt:serverTimestamp()
   });
   form.reset();notice("Scheduled shift added.");
 }catch(error){
   notice("Couldn't add shift ("+(error.code||"error")+"). Check the new Firebase rules.",true);
 }finally{if(button.isConnected)button.disabled=false;}
}
async function editPosition(event){
 event.preventDefault();
 if(!admin())return;
 const form=event.target;
 const {mid,pid}=form.dataset;
 const existing=positions.get(mid)?.get(pid);
 if(!ministries.get(mid)?.active||!existing?.active)return;
 const title=String(form.elements.namedItem("title").value).trim();
 const description=String(form.elements.namedItem("description").value).trim();
 if(title.length<2||title.length>80||description.length>500){
   notice("Position name must be 2–80 characters and description at most 500.",true);return;
 }
 const changes={};
 if(title!==existing.title)changes.title=title;
 if(description!==(existing.description||""))changes.description=description;
 if(!Object.keys(changes).length){notice("No changes to save.");return;}
 const button=form.querySelector('[type="submit"]');
 button.disabled=true;
 try{
   await updateDoc(doc(db,"ministries",mid,"positions",pid),changes);
   positions.get(mid).set(pid,{...existing,...changes});
   form.closest("details.edit-panel").open=false;
   expandedPanels.delete("edit-position:"+mid+":"+pid);
   draw();
   notice("Volunteer position updated.");
 }catch(error){
   notice("Couldn't update position ("+(error.code||"error")+"). The Firebase rules may need publishing.",true);
 }finally{if(button.isConnected)button.disabled=false;}
}
async function editShift(event){
 event.preventDefault();
 if(!admin())return;
 const form=event.target;
 const {mid,pid,sid}=form.dataset;
 const existing=shifts.get(positionKey(mid,pid))?.get(sid);
 if(!ministries.get(mid)?.active||!positions.get(mid)?.get(pid)?.active||!existing?.active)return;
 const startsAt=form.elements.namedItem("date").value+"T"+form.elements.namedItem("start").value;
 const notes=String(form.elements.namedItem("notes").value).trim();
 let endsAt;
 try{endsAt=shiftEnd(startsAt);}
 catch(error){notice(error.message,true);return;}
 if(endsAt<=chicagoNow()){notice("Choose a future shift time.",true);return;}
 if(notes.length>300){notice("Notes must be 300 characters or fewer.",true);return;}
 const changes={};
 const capacity=Number(form.elements.namedItem("capacity").value);
 if(!Number.isInteger(capacity)||capacity<0||capacity>50){notice("Choose a volunteer limit between 0 and 50.",true);return;}
 const roster=shiftRosters.get(shiftKey(mid,pid,sid));
 if(!roster){notice("Wait for the volunteer roster to load before changing capacity.",true);return;}
 if(capacity>0&&roster.length>capacity){notice("There are already more volunteers than that limit.",true);return;}
 if(capacity!==(existing.capacity||0))changes.capacity=capacity;
 if(capacity>0&&((existing.capacity||0)===0||!Number.isInteger(existing.signupCount)))changes.signupCount=roster.length;
 if(startsAt!==existing.startsAt)changes.startsAt=startsAt;
 if(endsAt!==existing.endsAt)changes.endsAt=endsAt;
 if(notes!==(existing.notes||""))changes.notes=notes;
 if(!Object.keys(changes).length){notice("No changes to save.");return;}
 const button=form.querySelector('[type="submit"]');
 button.disabled=true;
 try{
   await updateDoc(doc(db,"ministries",mid,"positions",pid,"shifts",sid),changes);
   shifts.get(positionKey(mid,pid)).set(sid,{...existing,...changes});
   form.closest("details.edit-panel").open=false;
   expandedPanels.delete("edit-shift:"+mid+":"+pid+":"+sid);
   draw();
   notice("Shift updated. Existing volunteer sign-ups were preserved.");
 }catch(error){
   notice("Couldn't update shift ("+(error.code||"error")+"). The Firebase rules may need publishing.",true);
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
   if(!Number.isInteger(item.capacity)||item.capacity===0){
     if(alreadyJoined)await deleteDoc(ref);
     else await setDoc(ref,{
       memberId:account.uid,memberName:profile.displayName,createdAt:serverTimestamp()
     });
   }else{
     const shiftRef=doc(db,"ministries",mid,"positions",pid,"shifts",sid);
     await runTransaction(db,async tx=>{
       const shiftSnap=await tx.get(shiftRef);
       const signupSnap=await tx.get(ref);
       if(!shiftSnap.exists()||!shiftSnap.data().active)throw new Error("Shift unavailable");
       const current=shiftSnap.data(),count=current.signupCount;
       if(!Number.isInteger(count))throw new Error("Admin must initialize this shift's volunteer limit.");
       if(alreadyJoined){
         if(!signupSnap.exists())throw new Error("Sign-up already canceled. Refresh.");
         tx.delete(ref);
         tx.update(shiftRef,{signupCount:Math.max(0,count-1)});
       }else{
         if(signupSnap.exists())throw new Error("Already signed up.");
         if(count>=current.capacity)throw new Error("This shift is full.");
         tx.set(ref,{memberId:account.uid,memberName:profile.displayName,createdAt:serverTimestamp()});
         tx.update(shiftRef,{signupCount:count+1});
       }
     });
   }
   shiftJoined.set(key,!alreadyJoined);
   notice(alreadyJoined?"Your shift sign-up was canceled.":"You are signed up for this shift.");
 }catch(error){
   notice(error.message||("Couldn't change shift signup ("+(error.code||"error")+")."),true);
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
 if(event.target.matches("[data-shift-form]")){addShift(event);return;}
 if(event.target.matches("[data-edit-position-form]")){editPosition(event);return;}
 if(event.target.matches("[data-edit-shift-form]"))editShift(event);
}
export function unmountServe(){
 sequence++;
 for(const unsub of stops){try{unsub();}catch{}}
 for(const unsub of rosterSubscriptions.values()){try{unsub();}catch{}}
 if(clockRefresh!==null){clearInterval(clockRefresh);clockRefresh=null;}
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
 <p class="muted serve-intro">Find a place to help, choose a role, and reserve your spot.</p>
 <div id="serveMessage" hidden></div>
 <div class="serve-heading"><h2>Church Ministries</h2><span>Volunteer opportunities</span></div>
 <label class="ministry-picker-label" for="ministryPicker">Select a Ministry</label>
 <select id="ministryPicker" class="field" aria-label="Select a Ministry"></select>
 <div id="ministriesList" aria-live="polite"><p class="muted">Loading ministries…</p></div>`;
 root.addEventListener("submit",onSubmit);
 root.addEventListener("click",onClick);
 root.addEventListener("change",onChange);
 // Hide completed opportunities even when the page stays open across the end time.
 clockRefresh=setInterval(()=>draw(),60000);
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
