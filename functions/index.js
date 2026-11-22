"use strict";

// Deployed Firebase Cloud Function. Never run this code in GitHub Pages.
// Admin Firestore triggers are trusted; they verify the notice's author again.
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { logger } = require("firebase-functions");
const admin = require("firebase-admin");
admin.initializeApp();

const db=admin.firestore();
const messaging=admin.messaging();
const APP_BASE="https://nicaffus1.github.io/pmbc/";
const VALID_TABS=new Set(["home","prayer","serve","more","notifications"]);

exports.deliverAdminNotification = onDocumentCreated(
 {document:"notifications/{notificationId}",region:"us-central1",retry:false},
 async event=>{
  const notice=event.data?.data();
  if(!notice||notice.active!==true||!["members","admins"].includes(notice.audience))return;
  if(typeof notice.title!=="string"||typeof notice.body!=="string"||
    typeof notice.createdBy!=="string")return;

  const author=await db.doc("users/"+notice.createdBy).get();
  if(!author.exists||author.get("status")!=="approved"||author.get("role")!=="admin"){
   logger.warn("Rejecting untrusted notification author",{id:event.params.notificationId});
   return;
  }
  // Idempotency: Firestore events can be retried. Only one dispatch claims a notice.
  const claim=db.doc("notificationDispatch/"+event.params.notificationId);
  try{
   await claim.create({state:"started",createdAt:admin.firestore.FieldValue.serverTimestamp()});
  }catch(err){
   if(err.code===6||err.code==="already-exists")return;
   throw err;
  }

  const people=await db.collection("users").where("status","==","approved").get();
  const recipients=people.docs.filter(p=>notice.audience==="members"||p.get("role")==="admin");
  const tokenDocs=await Promise.all(recipients.map(p=>
   p.ref.collection("pushTokens").where("enabled","==",true).get()
  ));
  const target=new Map();
  for(const snap of tokenDocs)for(const d of snap.docs){
   const token=d.get("token");
   if(typeof token==="string"&&token.length>20)target.set(token,d.ref);
  }

  const link=VALID_TABS.has(notice.linkTab)?notice.linkTab:"notifications";
  const payload={
   title:notice.title.slice(0,100),
   body:notice.body.slice(0,500),
   url:APP_BASE+"#"+link,
   notificationId:String(event.params.notificationId)
  };
  let sent=0,failed=0;
  const entries=[...target.entries()];
  for(let i=0;i<entries.length;i+=500){
   const batch=entries.slice(i,i+500);
   const response=await messaging.sendEachForMulticast({
    tokens:batch.map(([token])=>token),
    data:payload,
    webpush:{headers:{Urgency:"normal"}}
   });
   sent+=response.successCount;
   failed+=response.failureCount;
   for(let j=0;j<response.responses.length;j++){
    const err=response.responses[j].error;
    if(err&&[
      "messaging/registration-token-not-registered","messaging/invalid-registration-token"
    ].includes(err.code)){
     await batch[j][1].delete().catch(cleanup=>logger.warn("Token cleanup failed",cleanup));
    }
   }
  }
  await claim.update({state:"completed",delivered:sent,failed,
   completedAt:admin.firestore.FieldValue.serverTimestamp()});
  logger.info("PMBC push dispatch",{id:event.params.notificationId,devices:entries.length,sent,failed});
 }
);
