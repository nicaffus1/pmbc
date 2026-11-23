// Read-only journal for prayer requests already marked answered by their authors.
import {db} from "./firebase.js";
import {collection,onSnapshot,query,where} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js";
const esc=x=>String(x??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
let stops=[],root=null,byId=new Map(),loaded=0,hadError=false;
function render(){
 if(!root)return;
 if(hadError){root.innerHTML='<p class="error">Could not load answered prayers. Check membership access and Firebase permissions.</p>';return;}
 const entries=[...byId.values()].filter(x=>x.status==="answered").sort((a,b)=>(b.createdAt?.toMillis?.()||0)-(a.createdAt?.toMillis?.()||0));
 root.innerHTML='<header><span class="eyebrow">Remember and give thanks</span><h1>Answered Prayers</h1>'+
 '<p class="muted">A record of requests marked answered by their authors or church administrators. Some requests are kept private.</p></header>'+
 (loaded===0?'<p class="muted">Loading answered prayers…</p>':entries.length===0?
 '<article class="card"><p>No answered prayer requests have been shared in the journal yet.</p></article>':
 entries.map(x=>'<article class="card answered-card"><span class="eyebrow">Answered prayer</span><h2>'+esc(x.subjectName||"Prayer Request")+'</h2>'+
 '<p>'+esc(x.text||"").replace(/\n/g,"<br>")+'</p>'+
 (x.visibility==="leadership"?'<small>Private request</small>':"")+'</article>').join(""));
}
export function mountAnsweredPrayers(target,user,profile){
 unmountAnsweredPrayers();root=target;
 if(!user||profile?.status!=="approved"){
  root.innerHTML='<h1>Answered Prayers</h1><p class="card">Sign in with an approved church account to view the prayer journal.</p>';return;
 }
 const col=collection(db,"prayers");
 // Queries always constrain visibility/status; private requests remain inaccessible.
 const queries=[
  query(col,where("status","==","answered"),where("visibility","==","members")),
  query(col,where("status","==","answered"),where("authorId","==",user.uid))
 ];
 if(profile.role==="admin")queries.splice(0,queries.length,query(col,where("status","==","answered")));
 const sets=queries.map(()=>new Map());
 queries.forEach((q,i)=>stops.push(onSnapshot(q,snap=>{
  sets[i]=new Map(snap.docs.map(d=>[d.id,{id:d.id,...d.data()}]));
  byId=new Map(sets.flatMap(s=>[...s]));loaded++;render();
 },()=>{hadError=true;render();})));
}
export function unmountAnsweredPrayers(){stops.forEach(s=>s());stops=[];root=null;byId=new Map();loaded=0;hadError=false;}
