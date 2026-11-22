// Home announcements and events — public viewing, administrator-managed Firestore records.
import { db } from "./firebase.js";
import { collection,doc,addDoc,updateDoc,onSnapshot,serverTimestamp,query,where }
 from "https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js";

const esc=x=>String(x??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
let root=null,admin=false,uid="",generation=0,subscriptions=[],timer=null;
let announcements=new Map(),events=new Map(),loaded=new Set(),errorMessages=new Map(),writing=new Set();
const durations=[60,90,120,180,240];
const fmtTime=time=>new Date(2000,0,1,Number(time.slice(0,2)),Number(time.slice(3)))
  .toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"});
function chicagoNow(){
 const parts={};
 for(const p of new Intl.DateTimeFormat("en-US",{timeZone:"America/Chicago",
  year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"})
  .formatToParts(new Date()))parts[p.type]=p.value;
 return parts.year+"-"+parts.month+"-"+parts.day+"T"+parts.hour+":"+parts.minute;
}
function validDate(date){
 if(!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date))return false;
 const d=new Date(date+"T00:00:00Z");
 return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===date;
}
function dateLabel(date){
 if(!validDate(date))return date;
 return new Date(date+"T12:00:00Z").toLocaleDateString("en-US",
  {timeZone:"UTC",weekday:"short",month:"short",day:"numeric",year:"numeric"});
}
function timeOptions(selected="09:00"){
 return Array.from({length:48},(_,i)=>{
  const t=String(Math.floor(i/2)).padStart(2,"0")+":"+(i%2?"30":"00");
  return '<option value="'+t+'" '+(selected===t?"selected":"")+'>'+fmtTime(t)+'</option>';
 }).join("");
}
function minutesOptions(selected=60){
 return durations.map(n=>'<option value="'+n+'" '+(Number(selected)===n?"selected":"")+'>'+
  (n/60===1?"1 hour":(n%60===0?n/60:n/60)+" hours")+'</option>').join("");
}
function endTime(startsAt,minutes){
 if(!validDate(startsAt.slice(0,10))||
  !/^(?:[01][0-9]|2[0-3]):(?:00|30)$/.test(startsAt.slice(11))||
  startsAt.length!==16||!durations.includes(minutes))throw Error("Choose a valid date, half-hour start time and duration.");
 const start=new Date(startsAt+":00Z");
 if(Number.isNaN(start.getTime())||start.toISOString().slice(0,16)!==startsAt)throw Error("Invalid date or time.");
 return new Date(start.getTime()+minutes*60000).toISOString().slice(0,16);
}
function current(item,kind,now){
 return item.active===true&&(kind==="announcement"
   ?validDate(item.expiresOn)&&item.expiresOn>=now.slice(0,10)
   :typeof item.endsAt==="string"&&item.endsAt>now);
}
function announceList(){
 const now=chicagoNow();
 return [...announcements.entries()].filter(([,v])=>current(v,"announcement",now))
  .sort((a,b)=>a[1].expiresOn.localeCompare(b[1].expiresOn));
}
function eventList(){
 const now=chicagoNow();
 return [...events.entries()].filter(([,v])=>current(v,"event",now))
  .sort((a,b)=>a[1].startsAt.localeCompare(b[1].startsAt));
}
function form(kind,item=null,id=""){
 const editing=Boolean(item),event=kind==="event";
 const title=item?.title||"",description=item?.description||"";
 const date=event?(item?.startsAt||"").slice(0,10):item?.expiresOn||"";
 const time=event?(item?.startsAt||"").slice(11,16):"09:00";
 const duration=event&&item?.startsAt&&item?.endsAt?
  Math.round((new Date(item.endsAt+":00Z")-new Date(item.startsAt+":00Z"))/60000):60;
 const options='<label>Title<input class="field" name="title" minlength="2" maxlength="100" value="'+esc(title)+'" required></label>'+
 '<label>'+ (event?"Details (optional)":"Message")+
 '<textarea class="field" name="description" maxlength="1200" rows="3" '+(event?"":"required")+'>'+
 esc(description)+'</textarea></label>'+
 '<label>'+(event?"Event date":"Show announcement through")+
 '<input class="field" type="date" name="date" value="'+esc(date)+'" required></label>'+
 (event?'<label>Start time (Central)<select class="field" name="time">'+timeOptions(time)+'</select></label>'+
 '<label>Duration<select class="field" name="duration">'+minutesOptions(duration)+'</select></label>'+
 '<label>Location (optional)<input class="field" name="location" maxlength="160" value="'+esc(item?.location||"")+'"></label>'+
 '<p class="section-note">Start times are in 30-minute steps. The event disappears after it ends.</p>':
 '<p class="section-note">This announcement disappears after the selected date (Central Time).</p>');
 return '<form class="stack update-editor" data-update-form="'+kind+'" data-record-id="'+esc(id)+'">'+
 options+'<button class="button" type="submit">'+(editing?"Save changes":"Publish "+(event?"event":"announcement"))+'</button></form>';
}
function row(kind,id,item){
 const event=kind==="event";
 const heading=event?dateLabel(item.startsAt.slice(0,10))+" · "+fmtTime(item.startsAt.slice(11)):
  "Until "+dateLabel(item.expiresOn);
 return '<article class="card home-update-entry"><div class="update-meta">'+esc(heading)+'</div>'+
  '<strong class="itemtitle">'+esc(item.title)+'</strong>'+
  (item.description?'<p>'+esc(item.description)+'</p>':"")+
  (event&&item.location?'<p class="section-note">Location: '+esc(item.location)+'</p>':"")+
  (admin?'<details class="home-manage" data-panel="'+kind+':'+esc(id)+'"><summary>Manage</summary>'+
   form(kind,item,id)+
   (item.active?'<button type="button" class="button outline home-remove" data-update-remove="'+kind+'" data-id="'+esc(id)+'">Remove '+(event?"event":"announcement")+'</button>':
   '<button type="button" class="button outline" data-update-restore="'+kind+'" data-id="'+esc(id)+'">Restore</button>')+
   '</details>':"")+'</article>';
}
function draw(){
 if(!root)return;
 const opened=new Set(),drafts=new Map();
 for(const pane of root.querySelectorAll("details[data-panel]")){
  if(!pane.open)continue;
  opened.add(pane.dataset.panel);
  const f=pane.querySelector("form[data-update-form]");
  if(f)drafts.set(pane.dataset.panel,Object.fromEntries([...new FormData(f).entries()]));
 }
 for(const kind of ["announcement","event"]){
  const container=root.querySelector("#home-"+kind+"s");
  if(!container)continue;
  const error=errorMessages.get(kind);
  const ready=loaded.has(kind);
  if(error){container.innerHTML='<p class="error">'+esc(error)+'</p>';continue;}
  if(!ready){container.innerHTML='<p class="muted">Loading '+kind+'s…</p>';continue;}
  const entries=kind==="event"?eventList():announceList();
  container.innerHTML=entries.length?entries.map(([id,item])=>row(kind,id,item)).join(""):
   '<div class="card empty-update"><p>No '+(kind==="event"?"upcoming events":"current announcements")+' at this time.</p></div>';
  const past=admin?[...(kind==="event"?events:announcements).entries()]
   .filter(([,v])=>!current(v,kind,chicagoNow())):[];
  past.sort((a,b)=>(b[1].startsAt||b[1].expiresOn||"").localeCompare(a[1].startsAt||a[1].expiresOn||""));
  const history=root.querySelector("#home-"+kind+"-history");
  if(history)history.innerHTML=admin&&past.length?
   '<details class="home-history" data-panel="history-'+kind+'"><summary>Past and removed '+kind+'s ('+past.length+')</summary>'+
   past.map(([id,v])=>row(kind,id,v)).join("")+'</details>':"";
 }
 for(const pane of root.querySelectorAll("details[data-panel]")){
  const key=pane.dataset.panel;
  pane.open=opened.has(key);
  const draft=drafts.get(key),f=pane.querySelector("form[data-update-form]");
  if(draft&&f)for(const [name,value] of Object.entries(draft)){
   const control=f.elements.namedItem(name);if(control)control.value=value;
  }
 }
}
function notice(message,error=false){
 const box=root?.querySelector("#updates-notice");
 if(!box)return;
 box.hidden=!message;box.textContent=message;box.className=error?"error":"notice";
}
function formData(form,kind){
 const title=String(form.elements.namedItem("title").value).trim();
 const description=String(form.elements.namedItem("description").value).trim();
 const date=form.elements.namedItem("date").value;
 if(title.length<2||title.length>100||description.length>(1200)||!validDate(date))
  throw Error("Check the title, description, and calendar date.");
 if(kind==="announcement"){
  if(description.length<3)throw Error("Enter an announcement message.");
  return {title,description,expiresOn:date};
 }
 const time=form.elements.namedItem("time").value;
 const duration=Number(form.elements.namedItem("duration").value);
 const startsAt=date+"T"+time,endsAt=endTime(startsAt,duration);
 const location=String(form.elements.namedItem("location").value).trim();
 if(location.length>160)throw Error("Location is too long.");
 return {title,description,location,startsAt,endsAt,timeZone:"America/Chicago"};
}
async function save(event){
 event.preventDefault();if(!admin||!uid)return;
 const f=event.target,kind=f.dataset.updateForm,id=f.dataset.recordId;
 if(!["announcement","event"].includes(kind))return;
 const lock=kind+":"+(id||"new");if(writing.has(lock))return;
 let values;
 try{
  values=formData(f,kind);
  const now=chicagoNow();
  if(!id&&(kind==="announcement"?values.expiresOn<now.slice(0,10):values.endsAt<=now))
   throw Error("Choose a future expiration or event end time.");
 }catch(err){notice(err.message,true);return;}
 const submit=f.querySelector('[type="submit"]');writing.add(lock);submit.disabled=true;
 try{
  const path=kind==="event"?"events":"announcements";
  if(id)await updateDoc(doc(db,path,id),values);
  else await addDoc(collection(db,path),{...values,active:true,createdBy:uid,createdAt:serverTimestamp()});
  // Close the form after a successful save; live snapshots refresh the list.
  const panel=f.closest("details");
  if(panel)panel.open=false;
  notice((kind==="event"?"Event":"Announcement")+(id?" updated.":" published."));
  if(!id)f.reset();
 }catch(err){notice("Could not save ("+(err.code||"error")+"). Check the published Firebase rules.",true);}
 finally{writing.delete(lock);if(submit.isConnected)submit.disabled=false;}
}
async function toggle(kind,id,active){
 if(!admin||!["announcement","event"].includes(kind))return;
 const store=kind==="event"?events:announcements;
 const item=store.get(id);if(!item||item.active===active)return;
 if(!active&&!window.confirm("Remove this "+kind+" from Home? Its record will be preserved."))return;
 const lock=kind+":"+id;if(writing.has(lock))return;writing.add(lock);
 try{
  await updateDoc(doc(db,kind==="event"?"events":"announcements",id),{active});
  store.set(id,{...item,active});
  draw();
  notice((kind==="event"?"Event":"Announcement")+(active?" restored.":" removed."));
 }catch(err){notice("Could not change this "+kind+" ("+(err.code||"error")+").",true);}
 finally{writing.delete(lock);}
}
function handleClick(event){
 const rem=event.target.closest("[data-update-remove]");
 if(rem){toggle(rem.dataset.updateRemove,rem.dataset.id,false);return;}
 const restore=event.target.closest("[data-update-restore]");
 if(restore)toggle(restore.dataset.updateRestore,restore.dataset.id,true);
}
export function unmountHomeUpdates(){
 generation++;
 for(const stop of subscriptions){try{stop();}catch{}}
 if(timer!==null){clearInterval(timer);timer=null;}
 subscriptions=[];root=null;admin=false;uid="";announcements=new Map();events=new Map();
 loaded=new Set();errorMessages=new Map();writing=new Set();
}
export function mountHomeUpdates(container,user,profile){
 unmountHomeUpdates();
 root=container;uid=user?.uid||"";
 admin=!!uid&&profile?.status==="approved"&&profile.role==="admin";
 if(!root)return;
 root.addEventListener("submit",save);
 root.addEventListener("click",handleClick);
 const eventForm=root.querySelector('form[data-update-form="event"]:not([data-record-id])');
 if(eventForm){
   eventForm.elements.namedItem("time").innerHTML=timeOptions();
   eventForm.elements.namedItem("duration").innerHTML=minutesOptions();
 }
 const token=generation;
 for(const [kind,path] of [["announcement","announcements"],["event","events"]]){
  const reference=admin?collection(db,path):query(collection(db,path),where("active","==",true));
  const unsub=onSnapshot(reference,snap=>{
   if(token!==generation)return;
   (kind==="event"?events:announcements)=new Map(snap.docs.map(d=>[d.id,d.data()]));
   loaded.add(kind);
   draw();
  },err=>{
   if(token!==generation)return;
   errorMessages.set(kind,"Unable to load "+kind+"s ("+(err.code||"error")+").");
   draw();
  });
  subscriptions.push(unsub);
 }
 timer=setInterval(draw,60000);
}
