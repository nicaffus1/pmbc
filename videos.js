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
 const data=(cache?.videos||[]).slice(0,all?10:3);
 target.innerHTML=data.length?'<div class="video-grid">'+cards(data)+'</div>'+
  (!all?'<a class="video-more-link" href="#videos">See all recent videos →</a>':""):
  '<p class="section-note">Recent videos could not be loaded. You can still watch on YouTube.</p>'+
  '<a class="video-more-link" href="'+CHANNEL+'" target="_blank" rel="noopener noreferrer">Open our YouTube channel →</a>';
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
