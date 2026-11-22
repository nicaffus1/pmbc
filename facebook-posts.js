// PMBC native Facebook Page post cards.
// Read-only; tokens remain private in Cloudflare.
import {PUSH_SENDER_URL} from "./push-sender-config.js";
const PAGE="https://www.facebook.com/providencembccenter/";
const escapeHTML=x=>String(x??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
let active=0,controller=null;
let cached=null,updatedAt=0;
function postCard(post){
 if(!post||typeof post!=="object")return "";
 const when=Date.parse(post.createdAt);
 const date=Number.isFinite(when)?new Intl.DateTimeFormat("en-US",{month:"short",day:"numeric",year:"numeric"}).format(new Date(when)):"";
 const photos=(Array.isArray(post.images)?post.images:[]).slice(0,4)
  .filter(src=>typeof src==="string"&&src.startsWith("https://"));
 const raw=String(post.message||"").trim();
 if(!raw&&!photos.length)return "";
 const url=typeof post.url==="string"&&/^https:\/\/(?:www\.|m\.)?facebook\.com\//.test(post.url)?post.url:PAGE;
 return '<article class="facebook-post-card">'+
  '<div class="facebook-post-meta"><strong>Providence Missionary Baptist Church</strong><time>'+escapeHTML(date)+'</time></div>'+
  (raw?'<p>'+escapeHTML(raw)+'</p>':"")+
  (photos.length?'<div class="facebook-post-photos">'+photos.map(src=>
   '<img loading="lazy" decoding="async" alt="Photo shared by the church on Facebook" src="'+escapeHTML(src)+'">').join("")+'</div>':"")+
  '<a href="'+escapeHTML(url)+'" target="_blank" rel="noopener noreferrer">View original post ↗</a>'+
  '</article>';
}
function show(data){
 const box=document.querySelector("#facebook-post-list");
 if(!box)return;
 if(data?.connected&&data.posts?.length){
  box.innerHTML=data.posts.slice(0,5).map(postCard).join("")||
   '<p class="section-note">No public Facebook updates to display.</p>';
 }else if(data?.connected){
  box.innerHTML='<p class="section-note">No recent public Facebook posts are available.</p>';
 }else{
  box.innerHTML='<p class="section-note">Facebook updates are not connected yet. A church administrator needs to authorize the Page once.</p>';
 }
}
export function unmountFacebookPosts(){
 active++;
 if(controller){controller.abort();controller=null;}
}
export function mountFacebookPosts(){
 unmountFacebookPosts();
 const box=document.querySelector("#facebook-post-list");if(!box)return;
 const requestId=active;
 if(cached&&Date.now()-updatedAt<15*60*1000){show(cached);return;}
 controller=new AbortController();
 fetch(PUSH_SENDER_URL.replace(/\/$/,"")+"/facebook-posts",{signal:controller.signal})
  .then(async response=>{
   const data=await response.json();
   if(!response.ok)throw Error(data.message||"Could not load Facebook posts");
   cached=data;
   updatedAt=Date.now();
   if(requestId===active)show(data);
  })
  .catch(e=>{
   if(requestId===active&&e.name!=="AbortError"){
    show({connected:false});
   }
  });
}
