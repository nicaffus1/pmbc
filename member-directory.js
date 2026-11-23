// Opt-in member directory; no automatic sharing of membership profiles.
import {db} from "./firebase.js";
import {collection,doc,onSnapshot,query,where,setDoc,serverTimestamp} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js";
const esc=x=>String(x??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
let root=null,stops=[],rows=[],mine=null,loaded=false,sessionUser=null,sessionProfile=null;
function draw(){
 if(!root)return;
 const permitted=!!sessionUser&&sessionProfile?.status==="approved";
 root.innerHTML='<header class="resource-intro"><span class="eyebrow">Church Family</span><h1>Member Directory</h1><p class="muted">Only approved church members can view this directory. Everyone decides whether to be listed and which contact details to share.</p></header>'+
 (!permitted?'<article class="card">Sign in with an approved church account to view or join the directory.</article>':
 '<div class="card"><details class="directory-editor"><summary>My directory listing</summary>'+
 '<form id="directoryForm" class="stack">'+
 '<label>Display name<input class="field" name="displayName" minlength="2" maxlength="80" required value="'+esc(mine?.displayName||sessionProfile?.displayName||"")+'"></label>'+
 '<label>Phone (optional)<input class="field" name="phone" type="tel" maxlength="30" value="'+esc(mine?.phone||"")+'"></label>'+
 '<label>Email (optional)<input class="field" name="contactEmail" type="email" maxlength="160" value="'+esc(mine?.contactEmail||"")+'"></label>'+
 '<label class="resource-publish"><input type="checkbox" name="showPhone" '+(mine?.showPhone?"checked":"")+'> Show my phone to other approved members</label>'+
 '<label class="resource-publish"><input type="checkbox" name="showEmail" '+(mine?.showEmail?"checked":"")+'> Show my email to other approved members</label>'+
 '<label class="resource-publish"><input type="checkbox" name="visible" '+(mine?.visible?"checked":"")+'> Include me in the member directory</label>'+
 '<button class="button" type="submit">Save my preferences</button><p role="status" class="section-note"></p></form></details></div>'+
 (loaded?'<div class="resource-list">'+(rows.filter(r=>r.visible).length?rows.filter(r=>r.visible).sort((a,b)=>a.displayName.localeCompare(b.displayName)).map(r=>
 '<article class="card directory-person"><strong>'+esc(r.displayName)+'</strong>'+
 (r.showPhone&&r.phone?'<p><a href="tel:'+esc(r.phone.replace(/[^+0-9]/g,""))+'">'+esc(r.phone)+'</a></p>':"")+
 (r.showEmail&&r.contactEmail?'<p><a href="mailto:'+encodeURIComponent(r.contactEmail)+'">'+esc(r.contactEmail)+'</a></p>':"")+
 '</article>').join(""):'<article class="card"><p>No members have opted into the directory yet.</p></article>')+'</div>':'<p class="muted">Loading directory…</p>'));
 root.querySelector("#directoryForm")?.addEventListener("submit",save);
}
async function save(e){
 e.preventDefault();if(!sessionUser||sessionProfile?.status!=="approved")return;
 const f=e.currentTarget,status=f.querySelector('[role="status"]'),button=f.querySelector("button");
 const data={
  displayName:String(f.elements.namedItem("displayName").value||"").trim(),
  phone:String(f.elements.namedItem("phone").value||"").trim(),
  contactEmail:String(f.elements.namedItem("contactEmail").value||"").trim(),
  visible:f.elements.namedItem("visible").checked,
  showPhone:f.elements.namedItem("showPhone").checked,
  showEmail:f.elements.namedItem("showEmail").checked
 };
 if(data.displayName.length<2||data.displayName.length>80){status.textContent="Enter a name between 2 and 80 characters.";return;}
 if(data.showPhone&&!data.phone||data.showEmail&&!data.contactEmail){status.textContent="Add contact information before choosing to share it.";return;}
 button.disabled=true;status.textContent="Saving…";
 try{await setDoc(doc(db,"memberDirectory",sessionUser.uid),{...data,updatedAt:serverTimestamp()});status.textContent="Preferences saved.";}
 catch(err){status.textContent="Unable to save: "+(err?.code||"check access");}
 finally{button.disabled=false;}
}
export function mountDirectory(target,user,profile){
 unmountDirectory();root=target;sessionUser=user;sessionProfile=profile;draw();
 if(!user||profile?.status!=="approved")return;
 const me=doc(db,"memberDirectory",user.uid);
 stops.push(onSnapshot(me,s=>{mine=s.exists()?s.data():null;draw();},()=>{if(root)root.innerHTML='<p class="error">Unable to read your directory preferences.</p>';}));
 stops.push(onSnapshot(query(collection(db,"memberDirectory"),where("visible","==",true)),s=>{rows=s.docs.map(d=>d.data());loaded=true;draw();},()=>{if(root)root.innerHTML='<p class="error">Directory permission unavailable. Check the Firestore rules.</p>';}));
}
export function unmountDirectory(){stops.forEach(s=>s());stops=[];root=null;rows=[];mine=null;loaded=false;sessionUser=null;sessionProfile=null;}
