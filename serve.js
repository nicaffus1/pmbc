// PMBC Serve — ministry positions and member opt-in, backed by Firestore.
import { db } from "./firebase.js";
import { createMinistry, observeMinistries } from "./ministry-data.js";
import { buildId, upcomingWeeklyDates, churchClock, shiftIsUpcoming } from "./serve-model.js";
import {
  collection, doc, addDoc, setDoc, deleteDoc, updateDoc, getDoc,
  onSnapshot, serverTimestamp, writeBatch
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js";

const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({
 "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
}[c]));

let root=null, account=null, profile=null, sequence=0;
let stops=[], ministries=new Map(), positions=new Map(), joined=new Map();
let shifts=new Map(), shiftJoined=new Map(), shiftRosters=new Map();
let knownPositionListeners=new Set(), knownShiftListeners=new Set(), pendingWrites=new Set();
let rosterListeners=new Map();
let selectedMinistry="", recurring=new Map(), recurringJoined=new Map(), recurringRosters=new Map();
let recurringListeners=new Set(), recurringRostersListeners=new Map();

const approved=()=>!!account && profile?.status==="approved";
const admin=()=>approved() && profile?.role==="admin";
const positionKey=(mid,pid)=>mid+"/"+pid;
const shiftKey=(mid,pid,sid)=>mid+"/"+pid+"/"+sid;
const recurringKey=(mid,pid,rid)=>mid+"/"+pid+"/"+rid;

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

function chicagoNow(){return churchClock();}
function showShiftTime(value){
 const date=value?.slice(0,10), time=value?.slice(11);
 if(!date||!time)return esc(value);
 const [y,m,d]=date.split("-").map(Number);
 const [h,min]=time.split(":").map(Number);
 return esc(new Date(y,m-1,d).toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"})
 +" · "+new Date(2000,0,1,h,min).toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"}));
}
function shiftList(mid,pid){
 const list=[...(shifts.get(positionKey(mid,pid))?.values()||[])].filter(x=>x.active && shiftIsUpcoming(x.endsAt))
   .sort((a,b)=>a.startsAt.localeCompare(b.startsAt));
 const rows=list.map(x=>{
  const key=shiftKey(mid,pid,x.id), signed=shiftJoined.get(key)===true;
  const past=x.endsAt<chicagoNow();
  const visibility=x.rosterVisibility||"members";
  const canViewRoster=admin()||visibility==="members";
  const roster=shiftRosters.get(key);
  const rosterNames=roster?.map(v=>"<li>"+esc(v.memberName||"Church Member")+"</li>").join("")||"";
  return `<div class="shift-entry">
    <strong>${showShiftTime(x.startsAt)} to ${showShiftTime(x.endsAt).split(" · ").pop()} CT</strong>
    ${x.notes?`<p>${esc(x.notes)}</p>`:""}
    ${canViewRoster?`<div class="shift-roster"><strong>Volunteers (${roster?.length??"…" })</strong>
     ${roster===undefined?'<p class="muted">Loading volunteers…</p>':roster.length?`<ul>${rosterNames}</ul>`:'<p class="muted">No one has signed up yet.</p>'}
     </div>`:'<p class="section-note">Volunteer names visible to administrators only.</p>'}
    ${admin()?`<label class="roster-setting">Who can see volunteer names?
     <select class="field" data-roster-visibility data-mid="${esc(mid)}" data-pid="${esc(pid)}" data-sid="${esc(x.id)}">
      <option value="members" ${visibility==="members"?"selected":""}>All approved members</option>
      <option value="admins" ${visibility==="admins"?"selected":""}>Administrators only</option>
     </select></label>`:""}
    <button class="button ${signed?"outline":""}" type="button" data-toggle-shift
      data-mid="${esc(mid)}" data-pid="${esc(pid)}" data-sid="${esc(x.id)}"
      ${pendingWrites.has("shift:"+key)||(!signed&&past)?"disabled":""}>
      ${signed?"✓ Signed Up — Cancel Shift":past?"Shift Ended":"Sign Up for Shift"}
    </button>
  </div>`;
 }).join("");
 return `<div class="shift-list"><h4>Scheduled Shifts</h4>
  ${rows||'<p class="muted">No scheduled shifts yet.</p>'}
  ${admin()?`<form class="stack shift-form" data-shift-form data-mid="${esc(mid)}" data-pid="${esc(pid)}">
    <label>Shift date<input class="field" name="date" type="date" required></label>
    <div class="shift-time-row">
      <label>Start time<input class="field" name="start" type="time" required></label>
      <label>End time<input class="field" name="end" type="time" required></label>
    </div>
    <label>Notes (optional)<input class="field" name="notes" maxlength="300"></label>
    <label>Who can see volunteer names?
     <select class="field" name="rosterVisibility">
      <option value="members">All approved members</option>
      <option value="admins">Administrators only</option>
     </select></label>
    <p class="section-note">Times are Central Time. Each shift starts and ends on the same day.</p>
    <button class="button outline" type="submit">Add Shift</button>
  </form>`:""}
 </div>`;
}


function watchRecurringDate(mid,pid,schedule,date,token){
 const key=recurringKey(mid,pid,schedule.id)+"/"+date;
 if(recurringListeners.has(key))return;
 recurringListeners.add(key);
 const path=["ministries",mid,"positions",pid,"recurring",schedule.id,"dates",date,"members"];
 const personal=doc(db,...path,account.uid);
 stops.push(onSnapshot(personal,snapshot=>{
  if(token!==sequence)return;
  recurringJoined.set(key,snapshot.exists());draw();
 },error=>{if(token===sequence)notice("Unable to load your weekly sign-up ("+(error.code||"error")+").",true);}));
 if(admin()||schedule.rosterVisibility==="members"){
  const stop=onSnapshot(collection(db,...path),snapshot=>{
   if(token!==sequence)return;
   recurringRosters.set(key,snapshot.docs.map(d=>({id:d.id,...d.data()}))
    .sort((a,b)=>(a.memberName||"").localeCompare(b.memberName||"")));
   draw();
  },error=>{if(token===sequence)notice("Unable to load weekly roster ("+(error.code||"error")+").",true);});
  recurringRostersListeners.set(key,stop);
 }
}
function watchRecurring(mid,pid,token){
 const key=positionKey(mid,pid), listenerKey="templates:"+key;
 if(recurringListeners.has(listenerKey))return;
 recurringListeners.add(listenerKey);
 stops.push(onSnapshot(collection(db,"ministries",mid,"positions",pid,"recurring"),snapshot=>{
  if(token!==sequence)return;
  const records=new Map(snapshot.docs.map(d=>[d.id,{id:d.id,...d.data()}]));
  recurring.set(key,records);
  for(const schedule of records.values())if(schedule.active){
   for(const date of datesForSchedule(schedule,5))watchRecurringDate(mid,pid,schedule,date,token);
  }
  draw();
 },error=>{
  if(token===sequence)notice("Unable to load weekly schedules ("+(error.code||"error")+"). Please publish the updated rules.",true);
 }));
}

function watchRoster(mid,pid,shift,token){
 const key=shiftKey(mid,pid,shift.id);
 const visibility=shift.rosterVisibility||"members";
 const allowed=admin()||visibility==="members";
 const previous=rosterListeners.get(key);
 if(!allowed){
   if(previous){previous();rosterListeners.delete(key);}
   shiftRosters.delete(key);
   return;
 }
 if(previous)return;
 const stop=onSnapshot(collection(db,"ministries",mid,"positions",pid,"shifts",shift.id,"signups"),snap=>{
   if(sequence!==token)return;
   shiftRosters.set(key,snap.docs.map(d=>({id:d.id,...d.data()}))
     .sort((a,b)=>(a.memberName||"").localeCompare(b.memberName||"")));
   draw();
 },error=>{
   if(sequence!==token)return;
   shiftRosters.delete(key);
   notice("Unable to load volunteer names ("+(error.code||"error")+"). Check the published roster permissions.",true);
 });
 rosterListeners.set(key,stop);
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
     if(item.active){watchShiftSignup(mid,pid,item.id,token);watchRoster(mid,pid,item,token);}
   }
   draw();
 },error=>{
   if(token===sequence)notice("Unable to load shifts ("+(error.code||"error")+"). Check the published Firebase rules.",true);
 }));
}


const weekdayNames=["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
function datesForSchedule(schedule,count=5){return upcomingWeeklyDates(schedule.weekday,schedule.endTime,count);}
function recurringUI(mid,pid){
 const schedules=[...(recurring.get(positionKey(mid,pid))?.values()||[])].filter(s=>s.active)
  .sort((a,b)=>a.title.localeCompare(b.title));
 const cards=schedules.map(schedule=>{
  const key=recurringKey(mid,pid,schedule.id);
  const dates=datesForSchedule(schedule,5);
  const entries=dates.map(date=>{
   const occurrence=key+"/"+date;
   const joined=recurringJoined.get(occurrence)===true;
   const roster=recurringRosters.get(occurrence);
   const names=roster?.map(v=>"<li>"+esc(v.memberName||"Member")+"</li>").join("")||"";
   const readable=admin()||schedule.rosterVisibility==="members";
   const dateText=new Date(date+"T12:00:00").toLocaleDateString("en-US",{
     weekday:"short",month:"short",day:"numeric"
   });
   return `<div class="recurring-occurrence">
    <strong>${esc(dateText)} · ${esc(schedule.startTime)}–${esc(schedule.endTime)} CT</strong>
    ${readable?`<div class="shift-roster"><strong>Volunteers (${roster?.length??"…" })</strong>
     ${roster===undefined?'<p class="muted">Loading volunteers…</p>':roster.length?`<ul>${names}</ul>`:'<p class="muted">No one signed up yet.</p>'}
    </div>`:"<p class='section-note'>Roster visible to administrators.</p>"}
    <button class="button ${joined?"outline":""}" type="button" data-recurring-signup
      data-mid="${esc(mid)}" data-pid="${esc(pid)}" data-rid="${esc(schedule.id)}" data-date="${esc(date)}"
      ${pendingWrites.has("rec:"+occurrence)?"disabled":""}>
     ${joined?"✓ Signed Up — Cancel":"Sign Up"}
    </button>
   </div>`;
  }).join("");
  return `<section class="recurring-card">
   <h4>${esc(schedule.title)} · Every ${weekdayNames[schedule.weekday]}</h4>
   <p class="section-note">${esc(schedule.notes||"Regular weekly serving")} · Next five weeks, rolling forward automatically</p>
   <div class="button-row">
     <button class="button outline" data-recurring-bulk data-count="4" data-mid="${esc(mid)}"
      data-pid="${esc(pid)}" data-rid="${esc(schedule.id)}">Volunteer for 4 weeks</button>
     <button class="button outline" data-recurring-bulk data-count="13" data-mid="${esc(mid)}"
      data-pid="${esc(pid)}" data-rid="${esc(schedule.id)}">Volunteer for 3 months</button>
   </div>
   ${entries}
   ${admin()?`<button class="button outline" type="button" data-recurring-archive
     data-mid="${esc(mid)}" data-pid="${esc(pid)}" data-rid="${esc(schedule.id)}">Stop Recurrence</button>`:""}
  </section>`;
 }).join("");
 return `<section class="recurring-section"><h4>Weekly Opportunities</h4>
 ${cards||'<p class="muted">No recurring schedules yet.</p>'}
 ${admin()?`<form class="stack recurring-form" data-recurring-form data-mid="${esc(mid)}" data-pid="${esc(pid)}">
  <label>Schedule title<input class="field" name="title" maxlength="80" minlength="2" required placeholder="Children's Church"></label>
  <label>Repeats every
   <select class="field" name="weekday">
    ${weekdayNames.map((name,index)=>`<option value="${index}">${name}</option>`).join("")}
   </select></label>
  <div class="shift-time-row">
   <label>Start<input class="field" name="start" type="time" required></label>
   <label>End<input class="field" name="end" type="time" required></label>
  </div>
  <label>Instructions<input class="field" name="notes" maxlength="300" placeholder="Where to meet"></label>
  <label>Volunteer name visibility
   <select class="field" name="rosterVisibility">
    <option value="members">Approved members</option>
    <option value="admins">Administrators only</option>
   </select></label>
  <button class="button outline" type="submit">Create Weekly Schedule</button>
 </form>`:""}
 </section>`;
}

function positionUI(mid,entry){
 const {id,...data}=entry;
 return `<div class="position-item">
  <strong>${esc(data.title)}</strong>
  ${data.description?`<p>${esc(data.description)}</p>`:""}
  <p class="section-note">Ongoing ministry interest</p>
  ${volunteerUI(mid,id)}
  ${shiftList(mid,id)}
  ${recurringUI(mid,id)}
  ${admin()?`<button type="button" class="button outline position-archive"
   data-position-archive data-mid="${esc(mid)}" data-pid="${esc(id)}">Remove Position</button>`:""}
 </div>`;
}
function archivedPositionsUI(mid){
 const archived=[...(positions.get(mid)?.values()||[])].filter(p=>p.active===false);
 if(!archived.length)return "";
 return `<details class="archived-positions"><summary>Removed Positions (${archived.length})</summary>
  ${archived.map(p=>`<div class="archived-entry"><span>${esc(p.title)}</span>
   <button class="button outline" type="button" data-position-restore data-mid="${esc(mid)}"
    data-pid="${esc(p.id)}">Restore</button></div>`).join("")}
 </details>`;
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
  ${admin()?archivedPositionsUI(id):""}
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
 const all=[...ministries.values()].filter(m=>m.active)
   .sort((a,b)=>a.name.localeCompare(b.name));
 const picker=root.querySelector("#ministryPicker");
 if(picker){
  const old=selectedMinistry;
  picker.innerHTML='<option value="">Choose a ministry…</option>'+
   all.map(m=>'<option value="'+esc(m.id)+'">'+esc(m.name)+'</option>').join("");
  if(all.some(m=>m.id===old))picker.value=old;
  else{selectedMinistry="";picker.value="";}
 }
 const entries=all.filter(m=>m.id===selectedMinistry);
 if(!all.length){
   area.innerHTML='<div class="notice">No ministries have been added yet.</div>';return;
 }
 if(!selectedMinistry){
   area.innerHTML='<p class="notice">Choose a ministry above to see its positions and upcoming shifts.</p>';return;
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
   for(const p of records.values())if(p.active){watchSignup(mid,p.id,token);watchShifts(mid,p.id,token);watchRecurring(mid,p.id,token);}
   draw();
 },err=>{
   if(sequence!==token)return;
   notice("Unable to load volunteer positions ("+(err.code||"network error")+"). Check Firestore rules.",true);
 });
 stops.push(unsub);
}
async function addMinistry(event){
 event.preventDefault();
 const form=event.currentTarget;
 if(!admin()){
  notice("Only approved administrators can add ministries. Check your account under More.",true);
  return;
 }
 const name=String(form.querySelector('[name="ministryName"]')?.value||"").trim();
 const description=String(form.querySelector('[name="ministryDescription"]')?.value||"").trim();
 if(name.length<2||name.length>80||description.length>500){
  notice("Use a ministry name of 2–80 characters and a description under 500 characters.",true);return;
 }
 const button=form.querySelector("#addMinistryButton");
 if(button){button.disabled=true;button.textContent="Saving Ministry…";}
 notice("Saving ministry to Firebase…");
 try{
  const createdId=await createMinistry({name,description,uid:account.uid});
  selectedMinistry=createdId;
  form.reset();
  notice("Ministry saved. It should appear selected below.");
 }catch(error){
  console.error("PMBC ministry save failed",error);
  const code=error?.code||"unknown";
  notice(code==="permission-denied"?
   "Firebase denied this ministry. Confirm that you are signed in as an approved administrator. (permission-denied)":
   "Could not save ministry ("+code+"): "+String(error?.message||"Please check your connection.").slice(0,170),true);
 }finally{
  if(button?.isConnected){button.disabled=false;button.textContent="Add Ministry";}
 }
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
     rosterVisibility:form.elements.namedItem("rosterVisibility").value,
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



async function addRecurring(event){
 event.preventDefault();
 if(!admin())return;
 const form=event.target;
 const mid=form.dataset.mid,pid=form.dataset.pid;
 const title=form.elements.namedItem("title").value.trim();
 const weekday=Number(form.elements.namedItem("weekday").value);
 const startTime=form.elements.namedItem("start").value;
 const endTime=form.elements.namedItem("end").value;
 const notes=form.elements.namedItem("notes").value.trim();
 const rosterVisibility=form.elements.namedItem("rosterVisibility").value;
 if(!positions.get(mid)?.get(pid)?.active||title.length<2||title.length>80
    ||weekday<0||weekday>6||!startTime||!endTime||endTime<=startTime||notes.length>300)return notice("Check the weekly schedule details and times.",true);
 const btn=form.querySelector("[type=submit]");btn.disabled=true;
 try{
  await addDoc(collection(db,"ministries",mid,"positions",pid,"recurring"),{
   title,weekday,startTime,endTime,notes,rosterVisibility,active:true,
   createdBy:account.uid,createdAt:serverTimestamp()
  });
  form.reset();notice("Weekly schedule created. PMBC now displays its next five dates.");
 }catch(error){notice("Couldn't add weekly schedule ("+(error.code||"error")+"). Publish the latest rules.",true);}
 finally{if(btn.isConnected)btn.disabled=false;}
}
async function toggleRecurring(button){
 if(!approved())return;
 const {mid,pid,rid,date}=button.dataset;
 const schedule=recurring.get(positionKey(mid,pid))?.get(rid);
 if(!schedule?.active||!positions.get(mid)?.get(pid)?.active)return;
 const key=recurringKey(mid,pid,rid)+"/"+date,lock="rec:"+key;
 if(pendingWrites.has(lock))return;
 const wasSigned=recurringJoined.get(key)===true;
 pendingWrites.add(lock);draw();
 const ref=doc(db,"ministries",mid,"positions",pid,"recurring",rid,"dates",date,"members",account.uid);
 try{
  if(wasSigned)await deleteDoc(ref);
  else await setDoc(ref,{
   memberId:account.uid,memberName:profile.displayName,occurrenceDate:date,createdAt:serverTimestamp()
  });
  recurringJoined.set(key,!wasSigned);notice(wasSigned?"Weekly shift canceled.":"You're signed up for this date.");
 }catch(error){notice("Couldn't update weekly sign-up ("+(error.code||"error")+").",true);}
 finally{pendingWrites.delete(lock);draw();}
}
async function signForWeeks(button){
 if(!approved())return;
 const {mid,pid,rid}=button.dataset;
 const count=Number(button.dataset.count);
 if(![4,13].includes(count))return;
 const schedule=recurring.get(positionKey(mid,pid))?.get(rid);
 if(!schedule?.active||!positions.get(mid)?.get(pid)?.active)return;
 const lock="bulk:"+recurringKey(mid,pid,rid);
 if(pendingWrites.has(lock))return;
 if(!window.confirm("Sign up for the next "+count+" "+weekdayNames[schedule.weekday]+"s? You can cancel dates individually."))return;
 pendingWrites.add(lock);button.disabled=true;
 try{
  const dates=datesForSchedule(schedule,count);
  const checks=await Promise.all(dates.map(async date=>{
   const ref=doc(db,"ministries",mid,"positions",pid,"recurring",rid,"dates",date,"members",account.uid);
   const snapshot=await getDoc(ref);
   return snapshot.exists()?null:{date,ref};
  }));
  const pending=checks.filter(Boolean);
  if(pending.length){
   const batch=writeBatch(db);
   for(const {date,ref} of pending)batch.set(ref,{
    memberId:account.uid,memberName:profile.displayName,occurrenceDate:date,createdAt:serverTimestamp()
   });
   await batch.commit();
  }
  notice("Signed up for "+pending.length+" additional dates. Already-saved dates were kept.");
 }catch(error){notice("Couldn't complete multiweek signup ("+(error.code||"error")+"). Nothing was partially added in the final batch.",true);}
 finally{pendingWrites.delete(lock);if(button.isConnected)button.disabled=false;}
}
async function archiveRecurring(button){
 if(!admin())return;
 const {mid,pid,rid}=button.dataset;
 if(!window.confirm("Stop this weekly schedule? Past volunteer signups will remain in Firebase."))return;
 try{
  await updateDoc(doc(db,"ministries",mid,"positions",pid,"recurring",rid),{active:false});
  notice("Weekly schedule stopped. Prior signups remain saved.");
 }catch(error){notice("Couldn't stop weekly schedule ("+(error.code||"error")+").",true);}
}

async function setPositionActive(mid,pid,active){
 if(!admin()||!positions.get(mid)?.has(pid))return;
 const name=positions.get(mid).get(pid).title;
 if(!active && !window.confirm("Remove '"+name+"' from active Serve positions? Existing shifts and signups will be retained and the position can be restored."))return;
 const key="position:"+positionKey(mid,pid);
 if(pendingWrites.has(key))return;
 pendingWrites.add(key);
 try{
  await updateDoc(doc(db,"ministries",mid,"positions",pid),{active});
  notice(active?"Position restored.":"Position removed from active ministries. Its history is preserved.");
 }catch(error){notice("Couldn't change position ("+(error.code||"error")+"). Check the updated Firebase rules.",true);}
 finally{pendingWrites.delete(key);}
}
function archivePosition(button){setPositionActive(button.dataset.mid,button.dataset.pid,false);}
function restorePosition(button){setPositionActive(button.dataset.mid,button.dataset.pid,true);}
async function onChange(event){
 const ministryPicker=event.target.closest("#ministryPicker");
 if(ministryPicker){selectedMinistry=ministryPicker.value;draw();return;}
 const select=event.target.closest("[data-roster-visibility]");
 if(!select||!admin())return;
 const {mid,pid,sid}=select.dataset;
 const value=select.value;
 if(!["members","admins"].includes(value))return;
 const key="roster:"+shiftKey(mid,pid,sid);
 if(pendingWrites.has(key))return;
 pendingWrites.add(key);select.disabled=true;
 try{
   await updateDoc(doc(db,"ministries",mid,"positions",pid,"shifts",sid),{rosterVisibility:value});
   notice(value==="admins"?"Volunteer names are now administrator-only.":"Volunteer names are now visible to approved members.");
 }catch(error){
   notice("Couldn't change roster visibility ("+(error.code||"error")+"). Check the new Firebase rules.",true);
 }finally{pendingWrites.delete(key);if(select.isConnected)select.disabled=false;}
}

function onClick(event){
 const button=event.target.closest("[data-toggle-signup]");
 if(button){toggleSignup(button);return;}
 const shiftButton=event.target.closest("[data-toggle-shift]");
 if(shiftButton){toggleShift(shiftButton);return;}
 const archiveButton=event.target.closest("[data-position-archive]");
 if(archiveButton){archivePosition(archiveButton);return;}
 const restoreButton=event.target.closest("[data-position-restore]");
 if(restoreButton){restorePosition(restoreButton);return;}
 const recurringButton=event.target.closest("[data-recurring-signup]");
 if(recurringButton){toggleRecurring(recurringButton);return;}
 const multi=event.target.closest("[data-recurring-bulk]");
 if(multi){signForWeeks(multi);return;}
 const archive=event.target.closest("[data-recurring-archive]");
 if(archive)archiveRecurring(archive);
}
function onSubmit(event){
 if(event.target.matches("[data-position-form]")){addPosition(event);return;}
 if(event.target.matches("[data-shift-form]")){addShift(event);return;}
 if(event.target.matches("[data-recurring-form]"))addRecurring(event);
}
export function unmountServe(){
 sequence++;
 for(const unsub of stops){try{unsub();}catch{}}
 for(const unsub of rosterListeners.values()){try{unsub();}catch{}}
 rosterListeners=new Map();
 stops=[];ministries=new Map();positions=new Map();joined=new Map();
 shifts=new Map();shiftJoined=new Map();shiftRosters=new Map();
 knownPositionListeners=new Set();knownShiftListeners=new Set();pendingWrites=new Set();
 selectedMinistry="";recurring=new Map();recurringJoined=new Map();recurringRosters=new Map();
 recurringListeners=new Set();
 for(const stop of recurringRostersListeners.values()){try{stop();}catch{}}
 recurringRostersListeners=new Map();
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
 <p class="section-note" id="serveBuildVersion">Serve build: ${buildId}</p>
 ${admin()?`<section class="card" id="ministryComposer">
  <h2>Create a Ministry</h2>
  <form id="ministryForm" class="stack" novalidate>
   <label for="ministryName">Ministry name</label>
   <input class="field" id="ministryName" name="ministryName" minlength="2" maxlength="80" required>
   <label for="ministryDescription">Description (optional)</label>
   <textarea class="field" id="ministryDescription" name="ministryDescription" rows="3" maxlength="500"></textarea>
   <button class="button" type="button" id="addMinistryButton">Add Ministry</button>
  </form>
 </section>`:""}
 <h2>Church Ministries</h2>
 <label class="ministry-picker-label" for="ministryPicker">Select a ministry</label>
 <select class="field" id="ministryPicker"><option value="">Choose a ministry…</option></select>
 <div id="ministriesList" aria-live="polite"><p class="muted">Loading ministries…</p></div>`;
 root.querySelector("#addMinistryButton")?.addEventListener("click",event=>{
   const form=event.currentTarget.closest("#ministryForm");
   if(form)addMinistry({preventDefault(){},currentTarget:form});
 });
 root.addEventListener("submit",onSubmit);
 root.addEventListener("click",onClick);
 root.addEventListener("change",onChange);
 const token=sequence;
 stops.push(observeMinistries(entries=>{
   if(token!==sequence)return;
   for(const d of entries){
     if(d.active && !ministries.has(d.id))watchPositions(d.id,token);
   }
   ministries=new Map(entries.map(d=>[d.id,d]));
   draw();
 },err=>{
   if(token!==sequence)return;
   root.querySelector("#ministriesList").innerHTML=
    '<p class="error">Unable to load ministries ('+esc(err.code||"network error")+').</p>';
 }));
}
