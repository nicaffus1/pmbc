// A practical, members-only help board with private volunteer responses.
import {db} from "./firebase.js";
import {collection,doc,addDoc,onSnapshot,query,where,serverTimestamp,updateDoc,setDoc,deleteDoc} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js";
const esc=x=>String(x??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
let root=null,user=null,profile=null,stops=[],requests=new Map(),responseStops=[],responses=new Map(),seen=new Set(),message="";
const approved=()=>!!user&&profile?.status==="approved";
const admin=()=>approved()&&profile?.role==="admin";
function draw(){
 if(!root)return;
 const items=[...requests.entries()].filter(([id,x])=>x.status==="open"||admin()||x.authorId===user?.uid).sort((a,b)=>(b[1].createdAt?.toMillis?.()||0)-(a[1].createdAt?.toMillis?.()||0));
 root.innerHTML='<header class="resource-intro"><span class="eyebrow">Serve one another</span><h1>Church Help Board</h1><p class="muted">Practical needs and ways to help within the church. Please avoid posting sensitive medical or family details.</p></header>'+
 (!approved()?'<article class="card">Sign in with an approved church account to view or offer help.</article>':
 '<details class="card resource-create"><summary>+ Share a practical need</summary><form id="newNeedForm" class="stack">'+
 '<label>What is needed?<input class="field" name="title" required minlength="3" maxlength="120" placeholder="A meal, a ride, help moving…"></label>'+
 '<label>Category<select class="field" name="category"><option>Meals</option><option>Transportation</option><option>Home or yard</option><option>Other</option></select></label>'+
 '<label>Details<textarea class="field" name="details" required minlength="5" maxlength="800" rows="4"></textarea></label>'+
 '<button class="button" type="submit">Post need</button></form></details>'+
 (message?'<p class="notice" role="status">'+esc(message)+'</p>':"")+
 (items.length?items.map(([id,r])=>card(id,r)).join(""):'<article class="card"><p>No current needs have been posted.</p></article>'));
 root.querySelector("#newNeedForm")?.addEventListener("submit",createNeed);
 root.querySelectorAll("[data-help-offer]").forEach(b=>b.addEventListener("click",()=>toggleOffer(b.dataset.helpOffer)));
 root.querySelectorAll("[data-help-close]").forEach(b=>b.addEventListener("click",()=>closeNeed(b.dataset.helpClose)));
 syncOffers(items);
}
function card(id,r){
 const own=r.authorId===user.uid,offer=responses.get(id)||[],mine=offer.some(x=>x.memberId===user.uid);
 return '<article class="card help-item"><span class="eyebrow">'+esc(r.category)+'</span><h2>'+esc(r.title)+'</h2>'+
 '<p>'+esc(r.details).replace(/\n/g,"<br>")+'</p>'+
 '<p class="section-note">Posted by '+esc(r.authorName)+' · '+(r.status==="open"?"Open":"Completed")+'</p>'+
 (r.status==="open"&&!own?'<button type="button" class="button outline" data-help-offer="'+esc(id)+'">'+(mine?"Withdraw offer":"I can help")+'</button>':"")+
 (own||admin()?'<div class="help-volunteers"><strong>People offering to help</strong>'+
 (offer.length?'<ul>'+offer.map(x=>'<li>'+esc(x.memberName)+'</li>').join("")+'</ul>':'<p class="muted">No offers yet.</p>')+'</div>':"")+
 (r.status==="open"&&(own||admin())?'<button type="button" class="button outline" data-help-close="'+esc(id)+'">Mark completed</button>':"")+
 '</article>';
}
function syncOffers(items){
 const wanted=new Set(items.map(([id])=>id));
 for(const [id,stop] of responseStops){if(!wanted.has(id)){stop();responseStops.delete(id);responses.delete(id);}}
 for(const [id,r] of items){
  if(responseStops.has(id))continue;
  const path=collection(db,"helpRequests",id,"offers");
  const q=r.authorId===user.uid||admin()?path:query(path,where("memberId","==",user.uid));
  const stop=onSnapshot(q,s=>{responses.set(id,s.docs.map(d=>d.data()));draw();},()=>{responses.set(id,[]);});
  responseStops.set(id,stop);
 }
}
async function createNeed(e){
 e.preventDefault();if(!approved())return;
 const f=e.currentTarget;
 const title=String(f.elements.namedItem("title").value).trim(),details=String(f.elements.namedItem("details").value).trim(),category=f.elements.namedItem("category").value;
 if(title.length<3||details.length<5)return;
 try{await addDoc(collection(db,"helpRequests"),{title,details,category,authorId:user.uid,authorName:profile.displayName||"Church Member",status:"open",createdAt:serverTimestamp(),updatedAt:serverTimestamp()});message="Your request has been posted.";draw();}
 catch(err){message="Could not post: "+(err.code||"check access");draw();}
}
async function toggleOffer(id){
 const r=requests.get(id);if(!r||r.status!=="open"||!approved()||r.authorId===user.uid)return;
 const ref=doc(db,"helpRequests",id,"offers",user.uid);
 try{
  if((responses.get(id)||[]).some(x=>x.memberId===user.uid))await deleteDoc(ref);
  else await setDoc(ref,{memberId:user.uid,memberName:profile.displayName||"Church Member",createdAt:serverTimestamp()});
  message="Your response was updated.";draw();
 }catch(err){message="Could not update response: "+(err.code||"check access");draw();}
}
async function closeNeed(id){
 const r=requests.get(id);if(!r||!approved()||!(admin()||r.authorId===user.uid))return;
 try{await updateDoc(doc(db,"helpRequests",id),{status:"completed",updatedAt:serverTimestamp()});message="Marked completed.";draw();}
 catch(err){message="Could not update: "+(err.code||"check access");draw();}
}
export function mountHelpBoard(target,currentUser,currentProfile){
 unmountHelpBoard();root=target;user=currentUser;profile=currentProfile;draw();
 if(!approved())return;
 const all=collection(db,"helpRequests");
 const qs=admin()?[all]:[query(all,where("status","==","open")),query(all,where("authorId","==",user.uid))];
 const sets=qs.map(()=>new Map());
 qs.forEach((q,i)=>stops.push(onSnapshot(q,s=>{sets[i]=new Map(s.docs.map(d=>[d.id,d.data()]));requests=new Map(sets.flatMap(x=>[...x]));draw();},()=>{message="Unable to load some requests. Check Firestore permissions.";draw();})));
}
export function unmountHelpBoard(){stops.forEach(s=>s());stops=[];for(const stop of responseStops.values())stop();responseStops=new Map();responses.clear();requests.clear();root=null;user=null;profile=null;message="";}
