import {db} from "./firebase.js";
import {collection,doc,query,where,onSnapshot,setDoc,serverTimestamp} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js";
const escapeHTML=x=>String(x??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fields=["date","theme","scripture","order","announcements","notes"];
let stop=null,root=null,admin=false,latest=null;
const item=(label,value)=>value?'<section class="bulletin-part"><h2>'+label+'</h2><div class="bulletin-lines">'+escapeHTML(value).replace(/\n/g,"<br>")+'</div></section>':"";
function draw(){
 if(!root)return;
 const data=latest;
 root.innerHTML='<div class="bulletin-head"><span class="eyebrow">Worship together</span><h1>Sunday Bulletin</h1><p class="muted">The weekly order of worship, Scripture, and church announcements.</p></div>'+
 (!data||!data.published?'<article class="card"><p>The bulletin has not been published yet. Check back before the next service.</p></article>':
 '<article class="card bulletin-paper"><p class="eyebrow">'+escapeHTML(data.date||"Sunday Worship")+'</p>'+
 '<h2 class="bulletin-theme">'+escapeHTML(data.theme||"Worship Service")+'</h2>'+
 item("Scripture Reading",data.scripture)+item("Order of Service",data.order)+
 item("Announcements",data.announcements)+item("Sermon Notes",data.notes)+'</article>')+
 (admin?'<details class="card bulletin-editor"><summary>Edit this week’s bulletin</summary><form id="bulletinForm" class="stack">'+
 '<label>Service date<input class="field" type="date" name="date" value="'+escapeHTML(data?.date||"")+'" required></label>'+
 '<label>Service theme / title<input class="field" name="theme" maxlength="120" value="'+escapeHTML(data?.theme||"")+'" placeholder="Sunday Worship"></label>'+
 '<label>Scripture reading<textarea class="field" name="scripture" rows="2" maxlength="1000"></textarea></label>'+
 '<label>Order of service (one item per line)<textarea class="field" name="order" rows="7" maxlength="2500"></textarea></label>'+
 '<label>Announcements<textarea class="field" name="announcements" rows="5" maxlength="2500"></textarea></label>'+
 '<label>Sermon notes<textarea class="field" name="notes" rows="5" maxlength="2500"></textarea></label>'+
 '<label class="bulletin-check"><input type="checkbox" name="published"> Publish to everyone</label>'+
 '<button class="button" type="submit">Save bulletin</button><p class="section-note" id="bulletinStatus" role="status"></p></form></details>':"");
 const form=root.querySelector("#bulletinForm");if(!form)return;
 for(const f of ["scripture","order","announcements","notes"])form.elements.namedItem(f).value=data?.[f]||"";
 form.elements.namedItem("published").checked=!!data?.published;
 form.addEventListener("submit",save);
}
async function save(e){
 e.preventDefault();if(!admin)return;
 const form=e.currentTarget,submit=form.querySelector('button[type="submit"]'),status=form.querySelector("#bulletinStatus");
 const record={};
 for(const f of fields)record[f]=String(form.elements.namedItem(f).value||"").trim();
 record.published=form.elements.namedItem("published").checked;
 if(!/^\d{4}-\d{2}-\d{2}$/.test(record.date)){status.textContent="Choose a service date.";return;}
 submit.disabled=true;status.textContent="Saving…";
 try{await setDoc(doc(db,"churchBulletins","current"),{...record,updatedAt:serverTimestamp()});
 status.textContent="Bulletin saved.";}catch(err){status.textContent="Could not save: "+(err?.code||"check access and Firestore rules");}
 finally{submit.disabled=false;}
}
export function mountBulletin(target,isAdmin){
 unmountBulletin();root=target;admin=!!isAdmin;
 root.innerHTML='<p class="muted">Loading bulletin…</p>';
 const target=admin?doc(db,"churchBulletins","current"):query(collection(db,"churchBulletins"),where("published","==",true));
 stop=onSnapshot(target,snap=>{
  latest=admin?(snap.exists()?snap.data():null):(snap.docs.find(d=>d.id==="current")?.data()||null);
  draw();
 },err=>{
  if(root)root.innerHTML='<p class="error">Unable to load the bulletin ('+escapeHTML(err?.code||"connection error")+').</p>';
 });
}
export function unmountBulletin(){if(stop){stop();stop=null;}root=null;latest=null;admin=false;}
