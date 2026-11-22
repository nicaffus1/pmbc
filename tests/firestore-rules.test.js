// Firebase emulator only. Never reads or writes production Firestore.
import test, {before, beforeEach, after} from "node:test";
import {readFileSync} from "node:fs";
import {initializeTestEnvironment, assertSucceeds, assertFails} from "@firebase/rules-unit-testing";
import {doc, setDoc, getDoc, getDocs, updateDoc, collection, serverTimestamp} from "firebase/firestore";

let env,admin,member,other,outsider;
const ministry="ministries/childrens";
const position=ministry+"/positions/classroom";
const schedule=position+"/recurring/sundays";
const occurrence=schedule+"/dates/2026-11-29/members/member";

before(async()=>{
 env=await initializeTestEnvironment({
  projectId:"demo-pmbc",
  firestore:{
   host:"127.0.0.1",port:8080,
   rules:readFileSync(new URL("../firestore.rules",import.meta.url),"utf8")
  }
 });
 admin=env.authenticatedContext("admin",{email:"admin@pmbc.test"}).firestore();
 member=env.authenticatedContext("member",{email:"member@pmbc.test"}).firestore();
 other=env.authenticatedContext("other",{email:"other@pmbc.test"}).firestore();
 outsider=env.unauthenticatedContext().firestore();
});
beforeEach(async()=>{
 await env.clearFirestore();
 await env.withSecurityRulesDisabled(async ctx=>{
  const db=ctx.firestore();
  for(const [id,name,role] of [
   ["admin","Admin","admin"],
   ["member","Member One","member"],
   ["other","Member Two","member"]
  ])await setDoc(doc(db,"users",id),{
    displayName:name,email:id+"@pmbc.test",role,status:"approved",createdAt:new Date()
  });
  await setDoc(doc(db,ministry),{
    name:"Children's Ministry",description:"",active:true,createdBy:"admin",createdAt:new Date()
  });
  await setDoc(doc(db,position),{
    title:"Classroom Helper",description:"",active:true,createdBy:"admin",createdAt:new Date()
  });
 });
});
after(async()=>{if(env)await env.cleanup()});

test("anonymous visitors cannot read private ministries",async()=>{
 await assertFails(getDoc(doc(outsider,ministry)));
 await assertSucceeds(getDoc(doc(member,ministry)));
});
test("admin alone can create a new ministry",async()=>{
 const payload={name:"Music Ministry",description:"",active:true,createdBy:"admin",createdAt:serverTimestamp()};
 await assertSucceeds(setDoc(doc(admin,"ministries/music"),payload));
 await assertFails(setDoc(doc(member,"ministries/unauthorized"),{
  ...payload,createdBy:"member"
 }));
});
test("admin can archive and restore a position; member cannot",async()=>{
 await assertSucceeds(updateDoc(doc(admin,position),{active:false}));
 await assertFails(updateDoc(doc(member,position),{active:true}));
 await assertSucceeds(updateDoc(doc(admin,position),{active:true}));
});
test("admin creates weekly schedule and member joins own date",async()=>{
 await assertSucceeds(setDoc(doc(admin,schedule),{
  title:"Children's Church",weekday:0,startTime:"09:00",endTime:"10:00",
  notes:"Arrive early",rosterVisibility:"admins",active:true,
  createdBy:"admin",createdAt:serverTimestamp()
 }));
 await assertFails(setDoc(doc(member,position+"/recurring/hijack"),{
  title:"Not allowed",weekday:0,startTime:"09:00",endTime:"10:00",
  notes:"",rosterVisibility:"members",active:true,
  createdBy:"member",createdAt:serverTimestamp()
 }));
 await assertSucceeds(setDoc(doc(member,occurrence),{
  memberId:"member",memberName:"Member One",
  occurrenceDate:"2026-11-29",createdAt:serverTimestamp()
 }));
 await assertSucceeds(getDoc(doc(member,occurrence)));
 await assertFails(getDoc(doc(other,occurrence)));
 await assertSucceeds(getDoc(doc(admin,occurrence)));
 await assertFails(getDocs(collection(other,schedule+"/dates/2026-11-29/members")));
});
test("admin hides a prayer without letting members read it",async()=>{
 await env.withSecurityRulesDisabled(ctx=>setDoc(doc(ctx.firestore(),"prayers/prayer1"),{
  text:"Test request",visibility:"members",status:"active",
  authorId:"member",authorName:"Member One",
  createdAt:new Date(),updatedAt:new Date()
 }));
 await assertSucceeds(getDoc(doc(member,"prayers/prayer1")));
 await assertSucceeds(updateDoc(doc(admin,"prayers/prayer1"),{
  status:"removed",updatedAt:serverTimestamp()
 }));
 await assertFails(getDoc(doc(member,"prayers/prayer1")));
 await assertSucceeds(getDoc(doc(admin,"prayers/prayer1")));
 await assertSucceeds(updateDoc(doc(admin,"prayers/prayer1"),{
  status:"active",updatedAt:serverTimestamp()
 }));
 await assertSucceeds(getDoc(doc(member,"prayers/prayer1")));
});
