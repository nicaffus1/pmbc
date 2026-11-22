"use strict";

// PMBC trusted Firebase Cloud Functions.
// All device tokens and recipient routing stay on the server.
const { onDocumentCreated }=require("firebase-functions/v2/firestore");
const { onSchedule }=require("firebase-functions/v2/scheduler");
const { logger }=require("firebase-functions");
const admin=require("firebase-admin");
const {chicagoMinute,dueWithin,reminderId,niceDate}=require("./reminder-utils");
admin.initializeApp();
const db=admin.firestore();
const messaging=admin.messaging();
const APP_BASE="https://nicaffus1.github.io/pmbc/";
const VALID_TABS=new Set(["home","prayer","serve","more","notifications"]);
const REGION="us-central1";

// Only send messages to users who are still approved and who opted in.
async function loadRecipients(notice){
 if(notice.audience==="person"){
  if(typeof notice.recipientId!=="string"||!notice.recipientId)return [];
  const snap=await db.doc("users/"+notice.recipientId).get();
  return snap.exists&&snap.get("status")==="approved"?[snap]:[];
 }
 if(!["members","admins"].includes(notice.audience))return [];
 const snap=await db.collection("users").where("status","==","approved").get();
 return snap.docs.filter(p=>notice.audience==="members"||p.get("role")==="admin");
}
async function loadTokens(recipients){
 const all=[];
 // Limit parallel queries for larger churches.
 for(let i=0;i<recipients.length;i+=20){
  const batch=recipients.slice(i,i+20);
  const snapshots=await Promise.all(batch.map(u=>u.ref.collection("pushTokens")
   .where("enabled","==",true).get()));
  for(const s of snapshots)for(const d of s.docs){
   const token=d.get("token");
   if(typeof token==="string"&&token.length>=20)all.push({token,ref:d.ref});
  }
 }
 return [...new Map(all.map(v=>[v.token,v])).values()];
}
async function pushNotice(notice,id){
 const recipients=await loadRecipients(notice);
 const tokens=await loadTokens(recipients);
 const tab=VALID_TABS.has(notice.linkTab)?notice.linkTab:"notifications";
 const payload={
  title:String(notice.title||"PMBC").slice(0,100),
  body:String(notice.body||"You have a church update.").slice(0,500),
  url:APP_BASE+"#"+tab,
  notificationId:id
 };
 let sent=0,failed=0;
 for(let i=0;i<tokens.length;i+=500){
  const current=tokens.slice(i,i+500);
  const result=await messaging.sendEachForMulticast({
   tokens:current.map(t=>t.token),data:payload,
   webpush:{headers:{Urgency:"normal"}}
  });
  sent+=result.successCount;
  failed+=result.failureCount;
  await Promise.all(result.responses.map((response,n)=>{
   const code=response.error?.code;
   if(!["messaging/registration-token-not-registered",
         "messaging/invalid-registration-token"].includes(code))return null;
   return current[n].ref.delete().catch(err=>logger.warn("Token cleanup failed",err));
  }));
 }
 return {devices:tokens.length,sent,failed};
}
exports.deliverAdminNotification=onDocumentCreated({
 document:"notifications/{notificationId}",region:REGION,retry:false
},async event=>{
 const notice=event.data?.data();
 const id=event.params.notificationId;
 if(!notice||notice.active!==true)return;
 if(!["members","admins","person"].includes(notice.audience))return;
 if(typeof notice.title!=="string"||typeof notice.body!=="string")return;

 if(notice.createdBy==="system"){
  // System notifications can be created only by privileged server code.
  // The client Firestore rules disallow the 'system' identity.
  if(!id.startsWith("auto-"))return;
 }else{
  if(notice.audience==="person"||typeof notice.createdBy!=="string")return;
  const author=await db.doc("users/"+notice.createdBy).get();
  if(!author.exists||author.get("status")!=="approved"||author.get("role")!=="admin"){
   logger.warn("Rejected notification from a non-admin",{id});return;
  }
 }
 // This at-most-once dispatch claim prevents duplicate push from duplicate events.
 // On a mid-send crash it can leave a partial delivery; see operational notes.
 const dispatch=db.doc("notificationDispatch/"+id);
 try{
  await dispatch.create({state:"started",createdAt:admin.firestore.FieldValue.serverTimestamp()});
 }catch(e){
  if(e.code===6||e.code==="already-exists")return;
  throw e;
 }
 try{
  const report=await pushNotice(notice,id);
  await dispatch.update({state:"completed",...report,
   completedAt:admin.firestore.FieldValue.serverTimestamp()});
  logger.info("PMBC push dispatch",{id,...report});
 }catch(err){
  await dispatch.update({state:"failed",reason:String(err.message||err).slice(0,200),
   failedAt:admin.firestore.FieldValue.serverTimestamp()});
  logger.error("PMBC push dispatch failed",{id,error:err});
 }
});

async function publishReminder(type,reference,startsAt,recipientId,notice){
 const id=reminderId(type,reference,startsAt,recipientId||"");
 try{
  await db.doc("notifications/"+id).create({
   title:notice.title,body:notice.body,kind:notice.kind,
   linkTab:notice.linkTab,audience:notice.audience,
   ...(recipientId?{recipientId}:{}),
   active:true,createdBy:"system",
   createdAt:admin.firestore.FieldValue.serverTimestamp()
  });
  return 1;
 }catch(err){
  if(err.code===6||err.code==="already-exists")return 0;
  throw err;
 }
}
async function approvedId(uid,cache){
 if(cache.has(uid))return cache.get(uid);
 const snap=await db.doc("users/"+uid).get();
 const valid=snap.exists&&snap.get("status")==="approved";
 cache.set(uid,valid);return valid;
}
async function eventReminders(now){
 // Fetch upcoming records only. No reminder is generated for inactive/past events.
 const future=new Date(now+":00Z");
 future.setUTCDate(future.getUTCDate()+2);
 const end=future.toISOString().slice(0,16);
 const snap=await db.collection("events").where("startsAt",">=",now)
  .where("startsAt","<",end).get();
 let n=0;
 for(const doc of snap.docs){
  const e=doc.data();
  if(e.active!==true||e.endsAt<=now)continue;
  if(!dueWithin(e.startsAt,now,24))continue;
  n+=await publishReminder("event-24h",doc.id,e.startsAt,null,{
   title:"Upcoming church event",
   body:e.title.slice(0,90)+" — "+niceDate(e.startsAt)+".",
   kind:"event",linkTab:"home",audience:"members"
  });
 }
 return n;
}
async function serveReminders(now){
 // Traverse the existing hierarchy; avoids needing a new collection-group index.
 const ministries=await db.collection("ministries").where("active","==",true).get();
 const approvals=new Map();
 let n=0;
 for(const ministry of ministries.docs){
  const positions=await ministry.ref.collection("positions").where("active","==",true).get();
  for(const position of positions.docs){
   const shifts=await position.ref.collection("shifts").where("active","==",true).get();
   for(const shift of shifts.docs){
    const s=shift.data(),start=s.startsAt;
    if(typeof start!=="string"||s.endsAt<=now)continue;
    const day=dueWithin(start,now,24);
    const hour=dueWithin(start,now,1);
    if(!day&&!hour)continue;
    const people=await shift.ref.collection("signups").get();
    const path=shift.ref.path;
    if(day&&people.empty){
     n+=await publishReminder("unfilled-serve-24h",path,start,null,{
      title:"Unfilled Serve opportunity",
      body:"A volunteer is needed for "+position.get("title")+" on "+niceDate(start)+".",
      kind:"serve",linkTab:"serve",audience:"admins"
     });
    }
    for(const signup of people.docs){
     const uid=signup.id;
     if(!await approvedId(uid,approvals))continue;
     for(const [due,label] of [[day,"tomorrow"],[hour,"in about an hour"]]){
      if(!due)continue;
      const type=day?"assigned-serve-24h":"assigned-serve-1h";
      n+=await publishReminder(type,path,start,uid,{
       title:"Your upcoming Serve shift",
       body:"You're serving "+label+" ("+niceDate(start)+").",
       kind:"serve",linkTab:"serve",audience:"person"
      });
     }
    }
   }
  }
 }
 return n;
}

// Every 15 minutes; overlap 30 min avoids timing drift. Deterministic IDs
// make repeat executions safe and do not duplicate reminders.
exports.sendScheduledReminders=onSchedule({
 schedule:"every 15 minutes",timeZone:"America/Chicago",
 region:REGION,retryCount:0,timeoutSeconds:540
},async()=>{
 const now=chicagoMinute();
 const [events,serve]=await Promise.allSettled([eventReminders(now),serveReminders(now)]);
 for(const [name,outcome] of [["events",events],["serve",serve]]){
  if(outcome.status==="rejected")logger.error("Reminder scan failed",{name,error:outcome.reason});
 }
 logger.info("PMBC reminder scan",{now,
  events:events.status==="fulfilled"?events.value:0,
  serve:serve.status==="fulfilled"?serve.value:0});
});
