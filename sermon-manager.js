// Providence sermon manager: YouTube hosts media, Firestore hosts public metadata.
import { db } from "./firebase.js";
import { collection, getDocs, doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js";

const CHANNEL="https://www.youtube.com/@providencembc4487";
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const videoID=v=>/^[\w-]{11}$/.test(v)?v:null;
const idFromUrl=raw=>{
 const s=String(raw||"").trim();
 if(videoID(s))return s;
 try{
  const u=new URL(s);
  const host=u.hostname.replace(/^www\./,"").replace(/^m\./,"");
  if(host==="youtu.be")return videoID(u.pathname.split("/")[1]);
  if(!["youtube.com","youtube-nocookie.com"].includes(host))return null;
  return videoID(u.searchParams.get("v"))||videoID(u.pathname.match(/^\/(?:shorts|live|embed)\/([^/]+)/)?.[1]);
 }catch{return null;}
};
const fmt=v=>{const t=Date.parse(v||"");return Number.isFinite(t)?new Date(t).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}):"";};
const uniq=a=>[...new Set(a.map(v=>v.trim()).filter(Boolean))];
const words=s=>uniq(String(s||"").split(",")).slice(0,12);
let sequence=0;

function videoCard(v){
 const id=encodeURIComponent(v.id);
 const tags=(v.topics||[]).map(t=>'<span class="sermon-topic">'+esc(t)+'</span>').join("");
 return '<article class="video-card"><a href="https://www.youtube.com/watch?v='+id+'" target="_blank" rel="noopener noreferrer" aria-label="Watch '+esc(v.title)+' on YouTube"><div class="video-thumbnail"><img src="https://i.ytimg.com/vi/'+id+'/hqdefault.jpg" alt="" loading="lazy" decoding="async"><span class="video-play" aria-hidden="true">▶</span></div></a><div class="video-info"><strong>'+esc(v.title)+'</strong><span>'+esc(fmt(v.published))+'</span><span>'+esc([v.speaker,v.scripture].filter(Boolean).join(" · "))+'</span><div class="sermon-tags">'+tags+'</div></div></article>';
}
function optionList(items,selected){
 return items.map(item=>'<option value="'+esc(item)+'" '+(selected===item?"selected":"")+'>'+esc(item)+'</option>').join("");
}
export async function renderSermonLibrary(node,latest,isAdmin,isCurrent=()=>true){
 const request=++sequence;
 let records=[],readError=false;
 try{const snap=await getDocs(collection(db,"sermonLibrary"));records=snap.docs.map(d=>({id:d.id,...d.data()})).filter(v=>videoID(v.id));}
 catch{readError=true;}
 if(!isCurrent()||request!==sequence)return;
 const byId=new Map();
 for(const v of latest.filter(v=>videoID(v.id)))byId.set(v.id,{...v,topics:[],playlists:[]});
 for(const v of records)byId.set(v.id,{...byId.get(v.id),...v});
 let all=[...byId.values()].sort((a,b)=>String(b.published||"").localeCompare(String(a.published||"")));
 const topics=()=>uniq(all.flatMap(v=>v.topics||[])).sort();
 const playlists=()=>uniq(all.flatMap(v=>v.playlists||[])).sort();
 node.innerHTML='<section class="sermon-featured"><h2>Latest Sermon</h2><div class="video-grid" id="sermon-latest"></div></section>'+
 '<section><h2>Explore Sermons</h2><div class="sermon-filters"><label>Search<input class="field" id="sermon-query" type="search" placeholder="Title, Bible passage, speaker"></label><label>Topic<select class="field" id="sermon-topic"></select></label><label>Playlist<select class="field" id="sermon-playlist"></select></label></div><div id="sermon-matches" class="video-grid"></div><p id="sermon-none" class="section-note" hidden>No sermons match your filters.</p></section>'+
 '<section class="sermon-playlists"><h2>Playlists</h2><div id="sermon-playlists"></div></section>'+
 (isAdmin?'<details class="sermon-manager" id="sermon-manager"><summary>Manage Sermons (Admin)</summary><p class="section-note">Choose a recent upload or paste an older YouTube link. Separate topics and playlist names with commas.</p>'+
 '<label>Choose existing sermon<select class="field" id="sermon-choice"></select></label>'+
 '<form id="sermon-form" class="stack"><label>YouTube video link or ID<input class="field" name="video" required></label><label>Title<input class="field" name="title" required maxlength="160"></label><label>Speaker<input class="field" name="speaker" maxlength="80"></label><label>Scripture<input class="field" name="scripture" maxlength="120"></label><label>Topics (comma separated)<input class="field" name="topics" maxlength="400" placeholder="Faith, Prayer, Grace"></label><label>Playlists (comma separated)<input class="field" name="playlists" maxlength="400" placeholder="Romans, Sunday Mornings"></label><label>Description<textarea class="field" name="description" maxlength="1500" rows="3"></textarea></label><button class="button" type="submit">Save sermon</button><p id="sermon-status" class="section-note" role="status" aria-live="polite"></p></form></details>':"")+
 '<section class="sermon-archive"><h2>Full YouTube Archive</h2><p>Older videos not yet cataloged in the app remain on the church YouTube channel.</p><a class="video-more-link" href="'+CHANNEL+'/videos" target="_blank" rel="noopener noreferrer">Browse YouTube channel →</a></section>';
 const latestEl=node.querySelector("#sermon-latest");
 const matches=node.querySelector("#sermon-matches");
 const playlistSection=node.querySelector("#sermon-playlists");
 const q=node.querySelector("#sermon-query"),t=node.querySelector("#sermon-topic"),p=node.querySelector("#sermon-playlist");
 const refresh=()=>{
  latestEl.innerHTML=all.length?videoCard(all[0]):'<p class="section-note">No sermons available.</p>';
  const oldT=t.value,oldP=p.value;
  t.innerHTML='<option value="">All topics</option>'+optionList(topics(),oldT);
  p.innerHTML='<option value="">All playlists</option>'+optionList(playlists(),oldP);
  t.value=topics().includes(oldT)?oldT:"";
  p.value=playlists().includes(oldP)?oldP:"";
  const query=q.value.toLowerCase().trim();
  const results=all.filter(v=>(!query||[v.title,v.description,v.speaker,v.scripture,...(v.topics||[]),...(v.playlists||[])].join(" ").toLowerCase().includes(query))&&(!t.value||(v.topics||[]).includes(t.value))&&(!p.value||(v.playlists||[]).includes(p.value)));
  matches.innerHTML=results.map(videoCard).join("");
  node.querySelector("#sermon-none").hidden=results.length>0;
  const names=playlists();
  playlistSection.innerHTML=names.length?names.map(name=>'<div class="sermon-playlist-group"><h3>'+esc(name)+'</h3><div class="video-grid">'+all.filter(v=>(v.playlists||[]).includes(name)).map(videoCard).join("")+'</div></div>').join(""):'<p class="section-note">Playlists will appear here when an administrator assigns them.</p>';
 };
 for(const input of [q,t,p])input.addEventListener(input===q?"input":"change",refresh);
 refresh();
 if(readError){
  const warn=document.createElement("p");warn.className="section-note";warn.textContent="Sermon catalog is not yet available. The Firebase sermon rules may still need publishing.";node.prepend(warn);
 }
 if(!isAdmin)return;
 const select=node.querySelector("#sermon-choice"),form=node.querySelector("#sermon-form"),status=node.querySelector("#sermon-status");
 const field=name=>form.elements.namedItem(name);
 const updateSelect=()=>{const keep=select.value;select.innerHTML='<option value="">Add by YouTube URL</option>'+all.map(v=>'<option value="'+esc(v.id)+'">'+esc(v.title||v.id)+'</option>').join("");select.value=all.some(v=>v.id===keep)?keep:"";};
 updateSelect();
 select.addEventListener("change",()=>{
  const v=all.find(v=>v.id===select.value)||{};
  field("video").value=v.id||"";
  for(const k of ["title","speaker","scripture","description"])field(k).value=v[k]||"";
  for(const k of ["topics","playlists"])field(k).value=(v[k]||[]).join(", ");
 });
 form.addEventListener("submit",async event=>{
  event.preventDefault();
  const id=idFromUrl(field("video").value),title=field("title").value.trim();
  if(!id){status.textContent="Use a valid YouTube video URL or ID.";return;}
  if(!title){status.textContent="Please enter a title.";return;}
  const existing=all.find(v=>v.id===id);
  const entry={id,title,speaker:field("speaker").value.trim(),scripture:field("scripture").value.trim(),topics:words(field("topics").value),playlists:words(field("playlists").value),description:field("description").value.trim(),published:existing?.published||new Date().toISOString(),updatedAt:serverTimestamp()};
  const button=form.querySelector('button[type="submit"]');
  button.disabled=true;status.textContent="Saving…";
  try{
   await setDoc(doc(db,"sermonLibrary",id),entry);
   const local={...existing,...entry};
   all=[local,...all.filter(v=>v.id!==id)].sort((a,b)=>String(b.published||"").localeCompare(String(a.published||"")));
   refresh();updateSelect();select.value=id;
   status.textContent="Saved. Topics and playlists are now visible to everyone.";
  }catch(error){
   status.textContent=error.code==="permission-denied"?"Firebase has not authorized sermon editing. Publish the new Firestore sermon rules first.":"Unable to save: "+(error.message||"Unknown error");
  }finally{button.disabled=false;}
 });
}
