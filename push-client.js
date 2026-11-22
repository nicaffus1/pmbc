// PMBC opt-in browser push registration. Never stores server credentials in the client.
import { firebaseApp,db } from "./firebase.js";
import { PUBLIC_VAPID_KEY } from "./push-config.js";
import { doc,setDoc,serverTimestamp } from "https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js";
import { getMessaging,getToken,isSupported } from "https://www.gstatic.com/firebasejs/13.4.0/firebase-messaging.js";

export function pushConfigured(){return Boolean(PUBLIC_VAPID_KEY&&PUBLIC_VAPID_KEY.trim().length>20);}
export async function pushSupport(){
 if(!pushConfigured())return {ready:false,reason:"Push setup is pending: an administrator must add the Firebase public Web Push key."};
 if(!("serviceWorker" in navigator)||!("Notification" in window))
  return {ready:false,reason:"This device or browser does not support web push notifications."};
 const supports=await isSupported().catch(()=>false);
 if(!supports)return {ready:false,reason:"Web push isn't supported here. On iPhone, open the app from its Home Screen icon."};
 return {ready:true,reason:Notification.permission==="granted"?"Notifications are allowed on this device.":"Enable phone alerts for PMBC."};
}
async function tokenId(token){
 const bytes=new TextEncoder().encode(token);
 const hash=await crypto.subtle.digest("SHA-256",bytes);
 return [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,"0")).join("");
}
export async function enablePush(uid){
 if(!uid)throw Error("Sign in before enabling notifications.");
 if(!pushConfigured())throw Error("Firebase Web Push public key is not configured yet.");
 if(!("serviceWorker" in navigator)||!("Notification" in window))
  throw Error("This browser does not support phone push alerts.");
 // iOS requires the permission prompt to originate directly from a button tap,
 // before any asynchronous check can lose the user gesture.
 const permission=await Notification.requestPermission();
 if(permission!=="granted")throw Error("Notification permission was not granted. Check your device's notification settings.");
 const support=await pushSupport();
 if(!support.ready)throw Error(support.reason);
 const reg=await navigator.serviceWorker.ready;
 const messaging=getMessaging(firebaseApp);
 const token=await getToken(messaging,{vapidKey:PUBLIC_VAPID_KEY,serviceWorkerRegistration:reg});
 if(!token)throw Error("Firebase couldn't create a push token for this device.");
 const id=await tokenId(token);
 await setDoc(doc(db,"users",uid,"pushTokens",id),{
  token,enabled:true,platform:"web",updatedAt:serverTimestamp()
 },{merge:true});
 return {message:"This device is ready for manual Firebase push alerts.",token};
}
