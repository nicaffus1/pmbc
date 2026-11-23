// Private administrator-only care coordination; never exposed in public navigation.
import {db} from "./firebase.js";
import {collection,doc,addDoc,updateDoc,onSnapshot,serverTimestamp} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js";
const esc=x=>String(x??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
let root=null,stop=null,records=[],notice="";
function draw(){
 if(!root)return;
 root.innerHTML='<header class="resource-intro"><span class="eyebrow">Administrator only</span><h1>Care & Follow-Up</h1><p class="muted">Coordinate follow-up with visitors and members. Keep notes minimal. Do not record confidential counseling, medical, or financial details here.</p></header>'+
 '<details class="card resource-create"><summary>+ Add follow-up</summary><form id="careNew" class="stack">'+
 '<label>Person or household<input class="field" name="subject" minlength="2" maxlength="100" required></label>'+
 '<label>Next action<textarea class="field" name="action" rows="3" maxlength="500" required minlength="3"></textarea></label>'+
 '<label>Follow-up date (optional)<input class="field" type="date" name="dueDate"></label>'+
 '<button class="button" type="submit">Save follow-up</button></form></details>'+
 (notice?'<p class="notice" role="status">'+esc(notice)+'</p>':"")+
 '<div class="resource-list">'+(records.length?records.map(r=>'<article class="card"><span class="eyebrow">'+(r.status==="done"?"Completed":"Needs follow-up")+'</span>'+
 '<h2>'+esc(r.subject)+'</h2><p>'+esc(r.action)+'</p>'+
 (r.dueDate?'<p class="section-note">Target date: '+esc(r.dueDate)+'</p>':"")+
 (r.status==="open"?'<button class="button outline" data-care-complete="'+esc(r.id)+'">Mark completed</button>':"")+'</article>').join(""):'<article class="card"><p>No follow-up items yet.</p></article>')+'</div>';
 root.querySelector("#careNew")?.addEventListener("submit",create);
 root.querySelectorAll("[data-care-complete]").forEach(b=>b.addEventListener("click",()=>complete(b.dataset.careComplete)));
}
async function create(e){
 e.preventDefault();const f=e.currentTarget;
 const data={subject:String(f.elements.namedItem("subject").value).trim(),action:String(f.elements.namedItem("action").value).trim(),dueDate:f.elements.namedItem("dueDate").value};
 if(data.subject.length<2||data.action.length<3)return;
 try{await addDoc(collection(db,"careTasks"),{...data,status:"open",createdAt:serverTimestamp(),updatedAt:serverTimestamp()});notice="Saved.";draw();}
 catch(err){notice="Unable to save: "+(err?.code||"check permissions");draw();}
}
async function complete(id){
 if(!records.some(r=>r.id===id&&r.status==="open"))return;
 try{await updateDoc(doc(db,"careTasks",id),{status:"done",updatedAt:serverTimestamp()});notice="Follow-up completed.";draw();}
 catch(err){notice="Unable to update: "+(err?.code||"check permissions");draw();}
}
export function mountCareBoard(target,isAdmin){
 unmountCareBoard();root=target;
 if(!isAdmin){root.innerHTML='<article class="card">This page is restricted to church administrators.</article>';return;}
 root.innerHTML='<p class="muted">Loading follow-ups…</p>';
 stop=onSnapshot(collection(db,"careTasks"),s=>{records=s.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(a.status===b.status?String(a.dueDate||"9999").localeCompare(String(b.dueDate||"9999")):(a.status==="open"?-1:1)));draw();},
 ()=>{if(root)root.innerHTML='<p class="error">Unable to read private follow-up records.</p>';});
}
export function unmountCareBoard(){if(stop)stop();stop=null;root=null;records=[];notice="";}
