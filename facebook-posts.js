// PMBC Facebook news: compact Home carousel and complete Church News page.
// Read-only; access tokens stay in Cloudflare.
import {PUSH_SENDER_URL} from "./push-sender-config.js";
const PAGE="https://www.facebook.com/providencembccenter/";
const esc=x=>String(x??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
let generation=0,controller=null,cached=null,updatedAt=0;
const dateLabel=value=>{
 const time=Date.parse(value||"");
 return Number.isFinite(time)?new Intl.DateTimeFormat("en-US",{month:"short",day:"numeric",year:"numeric"}).format(time):"";
};
function normalized(post){
 if(!post||typeof post!=="object")return null;
 const message=String(post.message||"").trim();
 const photos=(Array.isArray(post.images)?post.images:[])
  .filter(src=>typeof src==="string"&&/^https:\/\//.test(src)).slice(0,4);
 if(!message&&!photos.length)return null;
 const url=typeof post.url==="string"&&/^https:\/\/(?:www\.|m\.)?facebook\.com\//.test(post.url)?post.url:PAGE;
 return {message,photos,url,date:dateLabel(post.createdAt),time:Date.parse(post.createdAt||"")||0};
}
function card(post,compact){
 const image=post.photos.length?
  '<img class="facebook-cover" loading="lazy" decoding="async" alt="Photo from this church post" src="'+esc(post.photos[0])+'">':"";
 const body=post.message?'<p class="facebook-message">'+esc(post.message)+'</p>':"";
 const extras=!compact&&post.photos.length>1?
  '<div class="facebook-extra-photos">'+post.photos.slice(1).map(src=>
   '<img loading="lazy" alt="Additional photo from this post" src="'+esc(src)+'">').join("")+'</div>':"";
 return '<article class="facebook-post-card'+(compact?' facebook-post-compact':' facebook-post-full')+'">'+
  '<div class="facebook-post-meta"><strong>Providence MBC</strong><time>'+esc(post.date)+'</time></div>'+
  image+body+extras+
  '<a href="'+esc(post.url)+'" target="_blank" rel="noopener noreferrer" aria-label="Read full church post on Facebook">Read full post ↗</a>'+
  '</article>';
}
function show(data,mode){
 const box=document.querySelector(mode==="news"?"#church-news-list":"#facebook-post-list");
 if(!box)return;
 if(!data?.connected){
  box.innerHTML='<p class="section-note">Church Facebook posts are temporarily unavailable. <a href="'+PAGE+'" target="_blank" rel="noopener noreferrer">Visit Facebook ↗</a></p>';
  return;
 }
 const posts=(Array.isArray(data.posts)?data.posts:[]).map(normalized).filter(Boolean)
  .sort((a,b)=>b.time-a.time);
 if(!posts.length){
  box.innerHTML='<p class="section-note">No recent public church posts are available.</p>';return;
 }
 if(mode==="news"){
  box.className="facebook-news-list";
  box.innerHTML=posts.map(post=>card(post,false)).join("");
  return;
 }
 const featured=posts.slice(0,3);
 box.className="facebook-carousel";
 box.setAttribute("aria-label","Latest church updates; swipe sideways to read more");
 box.innerHTML=featured.map((post,i)=>'<div class="facebook-slide" role="group" aria-label="Update '+(i+1)+' of '+featured.length+'">'+card(post,true)+'</div>').join("");
 const dots=document.querySelector("#facebook-carousel-dots");
 if(dots){
  dots.hidden=featured.length<2;
  dots.innerHTML=featured.map((_,i)=>'<span class="facebook-dot'+(i===0?' current':'')+'"></span>').join("");
  const mark=()=>{
   const idx=Math.min(featured.length-1,Math.max(0,Math.round(box.scrollLeft/Math.max(1,box.clientWidth*.86))));
   dots.querySelectorAll(".facebook-dot").forEach((d,i)=>d.classList.toggle("current",i===idx));
  };
  box.addEventListener("scroll",mark,{passive:true});
 }
}
export function unmountFacebookPosts(){
 generation++;
 if(controller){controller.abort();controller=null;}
}
export function mountFacebookPosts(mode="home"){
 unmountFacebookPosts();
 const box=document.querySelector(mode==="news"?"#church-news-list":"#facebook-post-list");
 if(!box)return;
 const requestId=generation;
 if(cached&&Date.now()-updatedAt<15*60*1000){show(cached,mode);return;}
 controller=new AbortController();
 fetch(PUSH_SENDER_URL.replace(/\/$/,"")+"/facebook-posts",{signal:controller.signal})
  .then(async response=>{
   const data=await response.json();
   if(!response.ok)throw Error("Facebook feed unavailable");
   cached=data;updatedAt=Date.now();
   if(requestId===generation)show(data,mode);
  })
  .catch(err=>{if(requestId===generation&&err.name!=="AbortError")show({connected:false},mode);});
}
