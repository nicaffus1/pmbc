// Providence sermon library. YouTube hosts videos; Firestore stores admin metadata.
import { PUSH_SENDER_URL } from "./push-sender-config.js";
import { db } from "./firebase.js";
import { collection, getDocs, doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js";

const CHANNEL="https://www.youtube.com/@providencembc4487";
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const valid=id=>/^[a-zA-Z0-9_-]{11}$/.test(String(id||""));
const date=s=>{const t=Date.parse(s);return Number.isFinite(t)?new Intl.DateTimeFormat("en-US",{month:"short",day:"numeric",year:"numeric"}).format(new Date(t)):"";};
const fields=["speaker","scripture","series","topics"];
let active=0,abort=null,feed=null,feedAt=0;
function card(v){
 const id=encodeURIComponent(v.id),title=esc(v.title);
 const details=[v.speaker,v.scripture,v.series].filter(Boolean).map(x=>'<span>'+esc(x)+'</span>').join("");
 const tags=(v.topics||[]).map(x=>'<span class="sermon-topic">'+esc(x)+'</span>').join("");
 return '<article class="video-card"><a href="https://www.youtube.com/watch?v='+id+'" target="_blank" rel="noopener noreferrer" aria-label="Watch '+title+' on YouTube"><div class="video-thumbnail"><img src="https://i.ytimg.com/vi/'+id+'/hqdefault.jpg" alt="" loading="lazy"><span class="video-play" aria-hidden="true">▶</span></div></a><div class="video-info"><strong>'+title+'</strong><span>'+esc(date(v.published))+'</span><div class="sermon-card-meta">'+details+'</div><div class="sermon-tags">'+tags+'</div></div></article>';
}
async function getFeed(signal){
 if(feed && Date.now()-feedAt<15*60*1000)return feed;
 if(!/^https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev\/?$/i.test(PUSH_SENDER_URL))return [];
 const resp=await fetch(PUSH_SENDER_URL.replace(/\/$/,"")+"/videos",{signal});
 if(!resp.ok)throw Error("YouTube feed unavailable");
 const result=await resp.json();
 if(!Array.isArray(result.videos))throw Error("Invalid feed");
 feed=result.videos.filter(v=>valid(v.id));feedAt=Date.now();return feed;
}
async function getMetadata(){
 const snapshot=await getDocs(collection(db,"sermons"));
 return snapshot.docs.map(d=>({id:d.id,...d.data()})).filter(v=>valid(v.id));
}
function merge(latest,metadata){
 const map=new Map();
 for(const v of latest)map.set(v.id,{...v,topics:[]});
 for(const m of metadata)map.set(m.id,{...map.get(m.id),...m,topics:Array.isArray(m.topics)?m.topics:[],id:m.id});
 return [...map.values()].sort((a,b)=>String(b.published||"").localeCompare(String(a.published||"")));
}
function renderLibrary(node,items,admin){
 let selected={q:"",speaker:"",scripture:"",series:"",topic:""};
 const options=(key)=>[...new Set(items.flatMap(v=>key==="topic"?(v.topics||[]):[v[key]]).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
 const select=(key,label)=>'<label>'+label+'<select class="field" data-filter="'+key+'"><option value="">All '+label.toLowerCase()+'</option>'+options(key).map(v=>'<option value="'+esc(v)+'">'+esc(v)+'</option>').join("")+'</select></label>';
 const controls='<div class="sermon-filters"><label>Search sermons<input class="field" type="search" data-filter="q" placeholder="Search titles and descriptions"></label>'+select("scripture","Scripture")+select("speaker","Speakers")+select("series","Series")+select("topic","Topics")+'</div>';
 node.innerHTML='<section class="sermon-featured"><h2>Latest Sermon</h2><div class="video-grid">'+(items[0]?card(items[0]):'<p>No sermons available yet.</p>')+'</div></section>'+
  '<div class="sermon-library-heading"><h2>Sermon Library</h2><span class="muted">'+items.length+' available</span></div>'+controls+
  '<div id="sermon-results" class="video-grid"></div><p id="sermon-empty" class="section-note" hidden>No sermons match those filters.</p>'+
  (admin?'<section class="sermon-editor"><h2>Manage Sermons</h2><p class="muted">Select a video to edit its information, or paste a YouTube URL to add an older sermon.</p><label>Choose sermon<select id="sermonEditSelect" class="field"><option value="">Add a sermon by URL</option>'+items.map(v=>'<option value="'+esc(v.id)+'">'+esc(v.title||v.id)+'</option>').join("")+'</select></label><form id="sermonEditForm" class="stack"><label>YouTube URL or video ID<input class="field" name="video" required placeholder="https://youtube.com/watch?v=…"></label><label>Sermon title<input class="field" name="title" maxlength="180" required></label><label>Speaker<input class="field" name="speaker" maxlength="100"></label><label>Scripture reference<input class="field" name="scripture" maxlength="120" placeholder="Romans 8:28–30"></label><label>Series<input class="field" name="series" maxlength="100"></label><label>Topics (comma-separated)<input class="field" name="topics" maxlength="350" placeholder="Prayer, Faith, Discipleship"></label><label>Description<textarea class="field" name="description" maxlength="1200" rows="3"></textarea></label><button class="button" type="submit">Save sermon</button><p id="sermon-save-status" role="status" aria-live="polite"></p></form></section>':"")+
  '<div class="sermon-archive"><h2>More on YouTube</h2><p>Browse older uploads on Providence’s YouTube channel.</p><a class="video-more-link" href="'+CHANNEL+'/videos" target="_blank" rel="noopener noreferrer">Open full YouTube archive →</a></div>';
 const filtered=()=>{
  const q=selected.q.toLocaleLowerCase();
  const found=items.filter(v=>{
   const hay=[v.title,v.description,v.speaker,v.scripture,v.series,...(v.topics||[])].join(" ").toLocaleLowerCase();
   return (!q||hay.includes(q))&&(!selected.speaker||v.speaker===selected.speaker)&&(!selected.scripture||v.scripture===selected.scripture)&&(!selected.series||v.series===selected.series)&&(!selected.topic||(v.topics||[]).includes(selected.topic));
  });
  node.querySelector("#sermon-results").innerHTML=found.map(card).join("");
  node.querySelector("#sermon-empty").hidden=found.length>0;
 };
 node.querySelectorAll("[data-filter]").forEach(el=>el.addEventListener(el.tagName==="INPUT"?"input":"change",()=>{selected[el.dataset.filter]=el.value;filtered();}));
 filtered();
 if(!admin)return;
 const choose=node.querySelector("#sermonEditSelect"),form=node.querySelector("#sermonEditForm"),status=node.querySelector("#sermon-save-status");
 const fill=()=>{
  const v=items.find(v=>v.id===choose.value)||{};
  form.elements.video.value=v.id||"";
  for(const key of ["title","speaker","scripture","series","description"])form.elements[key].value=v[key]||"";
  form.elements.topics.value=(v.topics||[]).join(", ");
 };
 choose.addEventListener("change",fill);
 form.addEventListener("submit",async e=>{
  e.preventDefault();status.textContent="";
  const raw=form.elements.video.value.trim();
  let id=raw;
  try{if(raw.includes("youtu")){const url=new URL(raw);id=url.searchParams.get("v")||(url.hostname==="youtu.be"?url.pathname.split("/")[1]:url.pathname.match(/\/(?:shorts|live|embed)\/([^/]+)/)?.[1])||"";}}catch{}
  if(!valid(id)){status.textContent="Enter a valid YouTube video URL or ID.";return;}
  const values={title:form.elements.title.value.trim(),speaker:form.elements.speaker.value.trim(),scripture:form.elements.scripture.value.trim(),series:form.elements.series.value.trim(),description:form.elements.description.value.trim(),topics:[...new Set(form.elements.topics.value.split(",").map(x=>x.trim()).filter(Boolean))].slice(0,12)};
  if(!values.title){status.textContent="A title is required.";return;}
  const old=items.find(v=>v.id===id);
  const entry={...values,id,published:old?.published||new Date().toISOString(),updatedAt:serverTimestamp()};
  const button=form.querySelector("button[type=submit]");button.disabled=true;
  try{
   await setDoc(doc(db,"sermons",id),entry,{merge:true});
   const next={...old,...entry};
   const index=items.findIndex(v=>v.id===id);
   if(index>=0)items[index]=next;else items.unshift(next);
   status.textContent="Sermon saved for everyone.";
   renderLibrary(node,items,true);
   const note=node.querySelector("#sermon-save-status");if(note)note.textContent="Sermon saved for everyone.";
  }catch(err){status.textContent=err.code==="permission-denied"?"Cannot save: the sermon Firestore rules must be published in Firebase first.":"Save failed: "+(err.message||"Please try again.");}
  finally{button.disabled=false;}
 });
}
export function unmountVideos(){active++;if(abort){abort.abort();abort=null;}}
export function mountVideos(all=false,admin=false){
 unmountVideos();
 const identity=active,section=all?"#videos-page-list":"#home-video-list",node=document.querySelector(section);
 if(!node)return;
 abort=new AbortController();const signal=abort.signal;
 Promise.allSettled([getFeed(signal),getMetadata()]).then(results=>{
  if(active!==identity)return;
  const recent=results[0].status==="fulfilled"?results[0].value:[];
  const saved=results[1].status==="fulfilled"?results[1].value:[];
  if(!all){
   node.innerHTML=recent.length?'<div class="video-grid">'+recent.slice(0,3).map(card).join("")+'</div><a class="video-more-link" href="#videos">Browse sermons →</a>':'<a class="video-more-link" href="'+CHANNEL+'" target="_blank" rel="noopener noreferrer">View sermons on YouTube →</a>';
  }else{
   const items=merge(recent,saved);
   renderLibrary(node,items,admin);
   if(results[1].status==="rejected"){
    const note=document.createElement("p");note.className="section-note";note.textContent="Saved sermon tags are unavailable until Firestore sermon rules are published.";node.prepend(note);
   }
  }
 });
}
