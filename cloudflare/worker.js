import {createRemoteJWKSet,jwtVerify,importPKCS8,SignJWT} from "jose";

const PROJECT="pmbc-d6d17";
const ORIGIN="https://nicaffus1.github.io";
const DATABASE="https://firestore.googleapis.com/v1/projects/"+PROJECT+"/databases/(default)/documents";
const JWT_KEYS=createRemoteJWKSet(new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"));
const MAX_PER_BATCH=25; // Cloudflare Free has 50 external subrequests/request
const MAX_DEVICES=500;
const BATCH_TIMEOUT=10000;
const json=(value,status=200)=>new Response(JSON.stringify(value),{
 status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}
});
function cors(response,origin){
 const headers=new Headers(response.headers);
 if(origin===ORIGIN){headers.set("Access-Control-Allow-Origin",ORIGIN);headers.set("Vary","Origin");}
 headers.set("X-Content-Type-Options","nosniff");
 return new Response(response.body,{status:response.status,headers});
}
function field(doc,key){const v=doc?.fields?.[key];return v?.stringValue??v?.booleanValue??null;}
function encode(id){return encodeURIComponent(id);}
function fail(status,message){return json({error:message},status);}
async function verifiedUser(request){
 const auth=request.headers.get("Authorization")||"";
 if(!auth.startsWith("Bearer "))throw Object.assign(new Error("Sign in to PMBC to send alerts."),{status:401});
 const {payload}=await jwtVerify(auth.slice(7),JWT_KEYS,{
  issuer:"https://securetoken.google.com/"+PROJECT,audience:PROJECT,
  algorithms:["RS256"],clockTolerance:"30s"
 });
 if(typeof payload.sub!=="string"||!payload.sub||payload.sub.length>128)throw Error("Invalid Firebase user.");
 if(!Number.isFinite(payload.auth_time)||payload.auth_time>Date.now()/1000+30)throw Error("Invalid session.");
 return payload.sub;
}
async function serviceAccess(env){
 if(!env.FIREBASE_SERVICE_ACCOUNT_JSON)throw new Error("Worker Firebase credential has not been configured.");
 let service;
 try{service=JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);}catch{throw Error("Invalid Firebase credential JSON.");}
 if(service.project_id!==PROJECT||!service.client_email||!service.private_key)throw Error("Incorrect Firebase service account.");
 const now=Math.floor(Date.now()/1000);
 const key=await importPKCS8(service.private_key,"RS256");
 const assertion=await new SignJWT({scope:"https://www.googleapis.com/auth/cloud-platform"})
  .setProtectedHeader({alg:"RS256",typ:"JWT"}).setIssuer(service.client_email)
  .setAudience("https://oauth2.googleapis.com/token").setIssuedAt(now).setExpirationTime(now+3300).sign(key);
 const response=await fetch("https://oauth2.googleapis.com/token",{
  method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},
  body:new URLSearchParams({grant_type:"urn:ietf:params:oauth:grant-type:jwt-bearer",assertion})
 });
 if(!response.ok)throw Error("Unable to authorize Firebase service account ("+response.status+").");
 const value=await response.json();
 if(!value.access_token)throw Error("Missing Google access token.");
 return value.access_token;
}
async function firestore(url,access,method="GET",body){
 const response=await fetch(url,{
  method,headers:{"Authorization":"Bearer "+access,...(body?{"content-type":"application/json"}:{})},
  ...(body?{body:JSON.stringify(body)}:{})
 });
 if(!response.ok){
  if(response.status===409)return {exists:true};
  throw Error("Firebase database request failed ("+response.status+").");
 }
 return response.json();
}
async function queryDocs(access,query){
 const response=await firestore(DATABASE+":runQuery",access,"POST",{structuredQuery:query});
 if(!Array.isArray(response))throw Error("Unexpected Firebase query result.");
 return response.flatMap(x=>x.document?[x.document]:[]);
}
async function eligibleTokens(access,audience){
 const users=await queryDocs(access,{
  from:[{collectionId:"users"}],
  where:{fieldFilter:{field:{fieldPath:"status"},op:"EQUAL",value:{stringValue:"approved"}}},
  limit:500
 });
 const allowed=new Set(users.filter(u=>audience!=="admins"||field(u,"role")==="admin")
  .map(u=>u.name.split("/").at(-1)));
 // Single collection-group query avoids one network call per church member.
 const tokens=await queryDocs(access,{
  from:[{collectionId:"pushTokens",allDescendants:true}],limit:1000
 });
 const unique=new Set();
 for(const doc of tokens){
  const match=doc.name.match(/\/users\/([^/]+)\/pushTokens\/[^/]+$/);
  if(!match||!allowed.has(match[1])||field(doc,"enabled")!==true)continue;
  const token=field(doc,"token");
  if(typeof token==="string"&&token.length>30)unique.add(token);
 }
 if(unique.size>MAX_DEVICES)throw Error("Too many registered devices for the free-plan sender. Contact the administrator.");
 return [...unique].sort();
}
async function sendOne(access,token,notice,id){
 const tab=["home","prayer","serve","more","notifications"].includes(field(notice,"linkTab"))
  ?field(notice,"linkTab"):"notifications";
 const body={
  message:{
   token,
   data:{
    title:String(field(notice,"title")).slice(0,100),
    body:String(field(notice,"body")).slice(0,500),
    url:ORIGIN+"/pmbc/#"+tab,notificationId:id
   },
   webpush:{headers:{Urgency:"normal"}}
  }
 };
 try{
  const response=await fetch("https://fcm.googleapis.com/v1/projects/"+PROJECT+"/messages:send",{
   method:"POST",headers:{"Authorization":"Bearer "+access,"content-type":"application/json"},
   body:JSON.stringify(body),signal:AbortSignal.timeout(BATCH_TIMEOUT)
  });
  if(response.ok)return true;
  return false;
 }catch{return false;}
}

const CHANNEL_URL="https://www.youtube.com/@providencembc4487";
const YOUTUBE_VIDEO=/^[A-Za-z0-9_-]{11}$/;
function xmlUnescape(input){
 return String(input).replace(/&#(x[0-9a-f]+|\d+);|&(amp|lt|gt|quot|apos);/gi,(full,number,named)=>{
  if(number){const point=number[0].toLowerCase()==="x"?parseInt(number.slice(1),16):parseInt(number,10);
   return point>=32&&point<=0x10ffff?String.fromCodePoint(point):"";}
  return {amp:"&",lt:"<",gt:">",quot:'"',apos:"'"}[named]||full;
 });
}
function extractChannelId(page){
 const match=page.match(/(?:\"channelId\"|\"externalId\"|\"browseId\")\s*:\s*\"(UC[A-Za-z0-9_-]{22})\"/)
  ||page.match(/youtube\.com\/channel\/(UC[A-Za-z0-9_-]{22})/);
 return match?.[1]||"";
}
function parseVideos(xml){
 const entries=xml.match(/<entry>[\s\S]*?<\/entry>/g)||[];
 return entries.slice(0,10).map(entry=>{
  const id=entry.match(/<yt:videoId>([^<]+)<\/yt:videoId>/)?.[1]||"";
  const title=entry.match(/<title>([\s\S]*?)<\/title>/)?.[1]||"";
  const published=entry.match(/<published>([^<]+)<\/published>/)?.[1]||"";
  return {id,title:xmlUnescape(title),published,
   url:"https://www.youtube.com/watch?v="+id,
   thumbnail:"https://i.ytimg.com/vi/"+id+"/hqdefault.jpg"};
 }).filter(v=>YOUTUBE_VIDEO.test(v.id)&&v.title.length>0);
}
async function loadVideos(){
 const channel=await fetch(CHANNEL_URL,{headers:{"User-Agent":"Mozilla/5.0 (compatible; PMBCVideoFeed/1.0)"}});
 if(!channel.ok)throw Error("YouTube channel lookup unavailable");
 const html=(await channel.text()).slice(0,3000000);
 const id=extractChannelId(html);
 if(!id)throw Error("Unable to find the channel's YouTube ID");
 const rss=await fetch("https://www.youtube.com/feeds/videos.xml?channel_id="+id);
 if(!rss.ok)throw Error("YouTube upload feed unavailable");
 const videos=parseVideos(await rss.text());
 if(!videos.length)throw Error("The channel feed has no public videos");
 return {videos,channel:CHANNEL_URL,updatedAt:new Date().toISOString()};
}
async function videosResponse(request,origin){
 const key=new Request("https://pmbc-video-cache.invalid/latest",{method:"GET"});
 const cache=caches.default;
 const cached=await cache.match(key);
 if(cached)return cors(cached,origin);
 try{
  const payload=await loadVideos();
  const response=new Response(JSON.stringify(payload),{
   headers:{"content-type":"application/json; charset=utf-8",
    "cache-control":"public, max-age=900","X-Content-Type-Options":"nosniff"}
  });
  await cache.put(key,response.clone());
  return cors(response,origin);
 }catch(error){
  return cors(json({error:"Unable to load recent videos right now.",channel:CHANNEL_URL},503),origin);
 }
}

export default{
 async fetch(request,env){
  const origin=request.headers.get("Origin")||"";
  if(request.method==="OPTIONS"){
   return cors(new Response(null,{status:204,headers:{
    "Access-Control-Allow-Methods":"POST, OPTIONS",
    "Access-Control-Allow-Headers":"Authorization, Content-Type",
    "Access-Control-Max-Age":"3600"
   }}),origin);
  }
  if(origin!==ORIGIN)return cors(fail(403,"This service accepts requests only from PMBC."),origin);
  if(request.method==="GET"&&new URL(request.url).pathname==="/videos")
   return videosResponse(request,origin);
  if(request.method!=="POST"||new URL(request.url).pathname!=="/send")return cors(fail(404,"Not found."),origin);
  try{
   const uid=await verifiedUser(request);
   const {notificationId,offset=0}=await request.json();
   if(typeof notificationId!=="string"||!(/^[A-Za-z0-9_-]{10,100}$/.test(notificationId))||
    !Number.isInteger(offset)||offset<0||offset>MAX_DEVICES||offset%MAX_PER_BATCH!==0)
    return cors(fail(400,"Invalid notification request."),origin);
   const access=await serviceAccess(env);
   const profile=await firestore(DATABASE+"/users/"+encode(uid),access);
   if(field(profile,"status")!=="approved"||field(profile,"role")!=="admin")
    return cors(fail(403,"Only approved PMBC administrators can send push alerts."),origin);
   const notice=await firestore(DATABASE+"/notifications/"+encode(notificationId),access);
   const audience=field(notice,"audience");
   if(field(notice,"createdBy")!==uid||field(notice,"active")!==true||
    !["members","admins"].includes(audience))
    return cors(fail(403,"You can send only your own active administrator notices."),origin);
   const tokens=await eligibleTokens(access,audience);
   const batch=tokens.slice(offset,offset+MAX_PER_BATCH);
   if(!batch.length)return cors(json({sent:0,failed:0,total:tokens.length,done:true}),origin);

   const claimId="manual-"+notificationId+"-"+offset;
   const claim=await firestore(DATABASE+"/notificationDispatch?documentId="+encode(claimId),access,"POST",{
    fields:{state:{stringValue:"started"},noticeId:{stringValue:notificationId},
     authorId:{stringValue:uid},createdAt:{timestampValue:new Date().toISOString()}}
   });
   if(claim.exists)return cors(json({
    error:"This notification batch was already submitted. It will not be resent automatically.",
    sent:0,failed:0,total:tokens.length,done:true
   },409),origin);
   // Concurrency capped to avoid overwhelming FCM and small Cloudflare account.
   let sent=0,failed=0;
   for(let i=0;i<batch.length;i+=5){
    const responses=await Promise.all(batch.slice(i,i+5).map(t=>sendOne(access,t,notice,notificationId)));
    sent+=responses.filter(Boolean).length;
    failed+=responses.filter(x=>!x).length;
   }
   await firestore(DATABASE+"/notificationDispatch/"+encode(claimId)+
    "?updateMask.fieldPaths=state&updateMask.fieldPaths=sent&updateMask.fieldPaths=failed",
    access,"PATCH",{fields:{state:{stringValue:"completed"},
     sent:{integerValue:String(sent)},failed:{integerValue:String(failed)}}});
   return cors(json({sent,failed,total:tokens.length,
    nextOffset:offset+batch.length<tokens.length?offset+MAX_PER_BATCH:null,
    done:offset+batch.length>=tokens.length}),origin);
  }catch(error){
   return cors(fail(error.status||500,error.status?error.message:
    "Push sender failed. Verify Cloudflare secrets, permissions, and deployment logs."),origin);
  }
 }
};
