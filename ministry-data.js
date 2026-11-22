// Firebase repository for ministries. No DOM or event-handling code.
import { db } from "./firebase.js";
import { collection, addDoc, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js";
import { normalizeMinistry } from "./serve-model.js";

export async function createMinistry({name,description,uid}) {
  if(!uid)throw new Error("Sign in as an approved administrator first.");
  const fields=normalizeMinistry(name,description);
  const ref=await addDoc(collection(db,"ministries"),{
    ...fields,active:true,createdBy:uid,createdAt:serverTimestamp()
  });
  return ref.id;
}
export function observeMinistries(onData,onError){
  return onSnapshot(collection(db,"ministries"),snapshot=>{
    onData(snapshot.docs.map(item=>({id:item.id,...item.data()})));
  },onError);
}
