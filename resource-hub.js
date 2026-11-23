// Public, administrator-curated ministry resources. No personal data stored.
import {db} from "./firebase.js";
import {collection,addDoc,doc,updateDoc,onSnapshot,query,where,serverTimestamp} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js";
const types={
 missions:{collection:"missionProfiles",heading:"Missions & Missionaries",eyebrow:"Across the world",intro:"Pray for the missionaries and ministries supported by Providence.",singular:"Missionary or ministry",empty:"No missionary updates have been published yet.",category:"Ministry location or field",detail:"Latest update",urlLabel:"Newsletter / ministry link"},
 studies:{collection:"bibleStudies",heading:"Bible Study & Discipleship",eyebrow:"Grow in the Word",intro:"Read Scripture together and use these studies for personal and group discipleship.",singular:"Bible study",empty:"No Bible studies have been published yet.",category:"Scripture passage",detail:"Study and reflection questions",urlLabel:"Optional study resource"}
};
const esc=x=>String(x??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const link=x=>{try{const u=new URL(x);return u.protocol==="https:"?u.href:"";}catch{return "";}};
let stop=null,root=null,mode="",admin=false,items=[];
function render(){
 if(!root)return;
 const t=types[mode];
 root.innerHTML='<header class="resource-intro"><span class="eyebrow">'+t.eyebrow+'</span><h1>'+t.heading+'</h1><p class="muted">'+t.intro+'</p></header>'+
 (admin?'<details class="card resource-create"><summary>+ Add '+t.singular+'</summary>'+editor(null)+'</details>':"")+
 '<div class="resource-list">'+(items.filter(x=>admin||x.published).length?
 items.filter(x=>admin||x.published).map(item=>card(item)).join(""):'<article class="card"><p>'+t.empty+'</p></article>')+'</div>';
 for(const form of root.querySelectorAll("form[data-resource-form]"))form.addEventListener("submit",save);
}
function editor(item){
 const t=types[mode],data=item||{},id=data.id||"";
 const val=(key)=>esc(data[key]||"");
 return '<form class="stack resource-form" data-resource-form="'+esc(id)+'">'+
 '<label>Title or name<input class="field" name="title" maxlength="140" minlength="2" value="'+val("title")+'" required></label>'+
 '<label>'+t.category+'<input class="field" name="category" maxlength="160" value="'+val("category")+'"></label>'+
 '<label>Summary<textarea class="field" name="summary" maxlength="700" rows="3">'+val("summary")+'</textarea></label>'+
 '<label>'+t.detail+'<textarea class="field" name="body" maxlength="4000" rows="8" required>'+val("body")+'</textarea></label>'+
 '<label>'+t.urlLabel+' (optional, https://)<input class="field" name="url" type="url" maxlength="500" value="'+val("url")+'" placeholder="https://"></label>'+
 '<label class="resource-publish"><input type="checkbox" name="published" '+(data.published?"checked":"")+'> Visible to church members and visitors</label>'+
 '<button class="button" type="submit">'+(id?"Save changes":"Add resource")+'</button><p class="section-note" role="status"></p></form>';
}
function card(item){
 const t=types[mode],href=link(item.url);
 return '<article class="card resource-card"><span class="eyebrow">'+esc(item.category||t.eyebrow)+'</span>'+
 '<h2>'+esc(item.title)+'</h2>'+
 (item.summary?'<p>'+esc(item.summary)+'</p>':"")+
 '<details class="resource-details"><summary>Read '+(mode==="missions"?"update":"study")+'</summary><div class="resource-body">'+esc(item.body).replace(/\n/g,"<br>")+'</div>'+
 (href?'<a href="'+esc(href)+'" target="_blank" rel="noopener noreferrer">Open additional resource ↗</a>':"")+'</details>'+
 (admin?'<p class="section-note">'+(item.published?"Published":"Unpublished draft")+'</p><details class="resource-manage"><summary>Edit</summary>'+editor(item)+'</details>':"")+
 '</article>';
}
async function save(e){
 e.preventDefault();if(!admin)return;
 const form=e.currentTarget,btn=form.querySelector('button[type="submit"]'),status=form.querySelector('[role="status"]');
 const id=form.dataset.resourceForm;const data={};
 for(const k of ["title","category","summary","body","url"])data[k]=String(form.elements.namedItem(k).value||"").trim();
 data.published=form.elements.namedItem("published").checked;
 if(data.title.length<2||data.body.length<3){status.textContent="Add a title and main content.";return;}
 if(data.url&&!link(data.url)){status.textContent="Only https:// links are accepted.";return;}
 btn.disabled=true;status.textContent="Saving…";
 try{
  if(id)await updateDoc(doc(db,types[mode].collection,id),{...data,updatedAt:serverTimestamp()});
  else await addDoc(collection(db,types[mode].collection),{...data,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
  status.textContent="Saved.";
 }catch(err){status.textContent="Could not save: "+(err?.code||"check Firebase permissions");}
 finally{btn.disabled=false;}
}
export function mountResourceHub(target,type,isAdmin){
 unmountResourceHub();
 if(!types[type]||!target)return;
 root=target;mode=type;admin=!!isAdmin;
 root.innerHTML='<p class="muted">Loading resources…</p>';
 const col=collection(db,types[type].collection);
 const q=admin?col:query(col,where("published","==",true));
 stop=onSnapshot(q,snap=>{items=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>a.title.localeCompare(b.title));render();},
 ()=>{if(root)root.innerHTML='<p class="error">Unable to load resources. Check your connection or the Firebase rules.</p>';});
}
export function unmountResourceHub(){if(stop){stop();stop=null;}root=null;items=[];mode="";admin=false;}
