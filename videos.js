// Providence Missionary Baptist Church — newest YouTube uploads.
// The Cloudflare Worker fetches and caches the public YouTube upload feed.
import { PUSH_SENDER_URL } from "./push-sender-config.js";

const CHANNEL="https://www.youtube.com/@providencembc4487";
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const date=s=>{
 const t=Date.parse(s);
 return Number.isFinite(t)?new Intl.DateTimeFormat("en-US",{month:"short",day:"numeric",year:"numeric"}).format(new Date(t)):"";
};
let active=0,abort=null,cache=null,updated=0;
function cards(items){
 return items.map((video,i)=>{
  const id=String(video.id||"");
  if(!/^[a-zA-Z0-9_-]{11}$/.test(id))return "";
  const title=esc(video.title);
  const url="https://www.youtube.com/watch?v="+encodeURIComponent(id);
  const thumb="https://i.ytimg.com/vi/"+encodeURIComponent(id)+"/hqdefault.jpg";
  return '<a class="video-card" href="'+url+'" target="_blank" rel="noopener noreferrer" aria-label="Watch '+title+' on YouTube">'+
   '<div class="video-thumbnail"><img src="'+thumb+'" loading="'+(i?"lazy":"eager")+'" alt="" decoding="async"><span class="video-play" aria-hidden="true">▶</span></div>'+
   '<div class="video-info"><strong>'+title+'</strong>'+
   '<span>'+esc(date(video.published))+'</span></div></a>';
 }).join("");
}
function show(section,all){
 const target=document.querySelector(section);if(!target)return;
 const items=(cache?.videos||[]).filter(v=>/^[a-zA-Z0-9_-]{11}$/.test(String(v.id||"")));
 if(!items.length){
  target.innerHTML='<p class="section-note">Recent sermons could not be loaded. You can still watch on YouTube.</p>'+
   '<a class="video-more-link" href="'+CHANNEL+'" target="_blank" rel="noopener noreferrer">Visit our YouTube channel →</a>';
  return;
 }
 if(!all){
  target.innerHTML='<div class="video-grid">'+cards(items.slice(0,3))+'</div>'+
   '<a class="video-more-link" href="#videos">Browse sermons →</a>';
  return;
 }
 target.innerHTML='<section class="sermon-featured" aria-label="Latest sermon"><h2>Latest Sermon</h2><div class="video-grid">'+cards(items.slice(0,1))+'</div></section>'+
  '<div class="sermon-library-heading"><h2>Recent Sermons</h2><span class="muted">'+items.length+' recent uploads</span></div>'+
  '<label class="sermon-search-label" for="sermonSearch">Search recent sermons</label>'+
  '<input id="sermonSearch" class="field sermon-search" type="search" placeholder="Search by title, topic, or speaker" autocomplete="off">'+
  '<div id="sermon-results" class="video-grid">'+cards(items)+'</div>'+
  '<p id="sermon-empty" class="section-note" hidden>No recent sermons match your search.</p>'+
  '<div class="sermon-archive"><h2>Full Sermon Archive</h2><p>Browse all available videos and older sermons directly on our YouTube channel.</p>'+
  '<a class="video-more-link" href="'+CHANNEL+'/videos" target="_blank" rel="noopener noreferrer">Browse our YouTube archive →</a></div>';
 const input=target.querySelector("#sermonSearch");
 const results=target.querySelector("#sermon-results");
 const empty=target.querySelector("#sermon-empty");
 input?.addEventListener("input",()=>{
  const q=input.value.trim().toLocaleLowerCase();
  const filtered=items.filter(v=>(String(v.title||"")+" "+date(v.published)).toLocaleLowerCase().includes(q));
  results.innerHTML=cards(filtered);
  empty.hidden=filtered.length>0;
 });
}
export function unmountVideos(){active++;if(abort){abort.abort();abort=null;}}
export function mountVideos(all=false){
 unmountVideos();
 const identity=active,section=all?"#videos-page-list":"#home-video-list";
 const node=document.querySelector(section);if(!node)return;
 if(cache&&Date.now()-updated<15*60*1000){show(section,all);return;}
 if(!/^https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev\/?$/i.test(PUSH_SENDER_URL)){
  show(section,all);return;
 }
 abort=new AbortController();
 fetch(PUSH_SENDER_URL.replace(/\/$/,"")+"/videos",{signal:abort.signal})
  .then(async response=>{
   if(!response.ok)throw Error("YouTube feed unavailable");
   const data=await response.json();
   if(!Array.isArray(data.videos))throw Error("Invalid video feed");
   cache={videos:data.videos};updated=Date.now();
   if(active===identity)show(section,all);
  }).catch(error=>{
   if(error.name!=="AbortError"&&active===identity)show(section,all);
  });
}
