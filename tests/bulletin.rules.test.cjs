const fs = require('node:fs');
const assert = require('node:assert/strict');
const {initializeTestEnvironment,assertSucceeds,assertFails} = require('@firebase/rules-unit-testing');
const {doc,collection,getDoc,getDocs,setDoc,serverTimestamp,query,where} = require('firebase/firestore');

(async () => {
 const env=await initializeTestEnvironment({
  projectId:'demo-pmbc-bulletin-test',
  firestore:{host:'127.0.0.1',port:8088,rules:fs.readFileSync('firestore.rules','utf8')}
 });
 try{
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx=>{
   const db=ctx.firestore();
   for(const [uid,role,status] of [['admin-user','admin','approved'],['member-user','member','approved'],['pending-user','member','pending']])
    await setDoc(doc(db,'users',uid),{displayName:'Test User',role,status,email:'demo@example.invalid',createdAt:new Date()});
   await setDoc(doc(db,'churchBulletins','current'),{
     date:'2026-11-29',theme:'Sunday Worship',scripture:'Psalm 100',order:'Welcome',announcements:'',notes:'',published:false,updatedAt:new Date()
   });
  });
  const guest=env.unauthenticatedContext().firestore();
  const member=env.authenticatedContext('member-user').firestore();
  const pending=env.authenticatedContext('pending-user').firestore();
  const admin=env.authenticatedContext('admin-user').firestore();
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    for (const [path, data] of [
      ['memberDirectory/listed', {visible:true}], ['memberDirectory/hidden', {visible:false}],
      ['careTasks/private', {}], ['ministryGroups/class', {published:true}],
      ['missionProfiles/draft', {published:false}], ['helpRequests/need', {authorId:'member-user',status:'open'}],
      ['helpRequests/need/offers/helper', {memberId:'helper'}]
    ]) await setDoc(doc(db,path),data);
  });
  for (const db of [guest,pending]) {
    for (const path of ['memberDirectory/listed','careTasks/private','ministryGroups/class','helpRequests/need'])
      await assertFails(getDoc(doc(db,path)));
  }
  await assertSucceeds(getDoc(doc(member,'memberDirectory/listed')));
  await assertFails(getDoc(doc(member,'memberDirectory/hidden')));
  await assertFails(getDoc(doc(member,'careTasks/private')));
  await assertSucceeds(getDoc(doc(admin,'careTasks/private')));
  await assertFails(getDoc(doc(guest,'missionProfiles/draft')));
  await assertSucceeds(getDoc(doc(member,'helpRequests/need/offers/helper')));
  await assertFails(getDocs(collection(member,'memberDirectory')));
  const bulletin=doc(guest,'churchBulletins','current');
  const published=ctx=>query(collection(ctx,'churchBulletins'),where('published','==',true));
  await assertFails(getDoc(bulletin));
  await assertFails(getDoc(doc(member,'churchBulletins','current')));
  assert.equal((await assertSucceeds(getDocs(published(guest)))).empty,true);
  await assertFails(getDocs(collection(guest,'churchBulletins')));
  await assertSucceeds(getDoc(doc(admin,'churchBulletins','current')));
  await assertFails(setDoc(doc(member,'churchBulletins','current'),{published:true},{merge:true}));
  await assertFails(setDoc(doc(pending,'churchBulletins','current'),{published:true},{merge:true}));
  await assertSucceeds(setDoc(doc(admin,'churchBulletins','current'),{
    date:'2026-11-29',theme:'Sunday Worship',scripture:'Psalm 100',order:'Welcome',announcements:'',notes:'',published:true,updatedAt:serverTimestamp()
  }));
  assert.equal((await assertSucceeds(getDoc(bulletin))).data().published,true);
  assert.equal((await assertSucceeds(getDocs(published(guest)))).size,1);
  await assertSucceeds(setDoc(doc(admin,'churchBulletins','current'),{
    date:'2026-11-29',theme:'Sunday Worship',scripture:'Psalm 100',order:'Welcome',announcements:'',notes:'',published:false,updatedAt:serverTimestamp()
  }));
  assert.equal((await assertSucceeds(getDocs(published(guest)))).empty,true);
  await assertFails(getDoc(bulletin));
  console.log('PASS: public published bulletin only, admin edit, pending/member restrictions, draft privacy.');
 }finally{await env.cleanup();}
})().catch(e=>{console.error(e);process.exitCode=1;});
