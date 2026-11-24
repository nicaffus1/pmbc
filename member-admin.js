import { auth, db } from "./firebase.js";
import { sendPhonePush } from "./notifications.js?v=members1";
import { collection, doc, getDocs, setDoc, addDoc, writeBatch, serverTimestamp, query, where } from "https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js";

function option(value, label) { return new Option(label, value); }

export async function mountMembers(root) {
 const feedback = root.querySelector("[role=status]");
 const controls = root.querySelector("fieldset");
 const member = root.querySelector("#member-choice");
 const group = root.querySelector("#group-choice");
 const picker = root.querySelector("#group-members");
 const form = root.querySelector("#compose-member");
 const name = root.querySelector("#group-name");
 let members, groups;
 async function refresh() {
  const [people, lists] = await Promise.all([
   getDocs(query(collection(db,"users"),where("status","==","approved"))),
   getDocs(collection(db,"contactGroups"))
  ]);
  members = new Map(people.docs.map(d=>[d.id,d.data()]).sort((a,b)=>(a[1].displayName||"").localeCompare(b[1].displayName||"")));
  groups = new Map(lists.docs.map(d=>[d.id,d.data()]).sort((a,b)=>a[1].name.localeCompare(b[1].name)));
  member.replaceChildren(option("","Choose a member"));
  group.replaceChildren(option("","New group"));
  picker.replaceChildren();
  for(const [id,p] of members){
   const label = (p.displayName || p.email || id) + (p.role === "admin" ? " · Administrator" : "") + (id === auth.currentUser.uid ? " · You" : "") + (p.email ? " (" + p.email + ")" : "");
   member.add(option(id,label));
   const row=document.createElement("label"), box=document.createElement("input");
   box.type="checkbox"; box.value=id;
   row.append(box," "+label); picker.append(row,document.createElement("br"));
  }
  for(const [id,g] of groups) group.add(option(id,g.name));
  root.querySelector("#roster-count").textContent=members.size+" approved members";
  group.onchange();
 }
 group.onchange=()=>{
  const current=groups.get(group.value);
  name.value=current?.name||"";
  const ids=new Set(current?.memberIds||[]);
  for(const box of picker.querySelectorAll("input")) box.checked=ids.has(box.value);
 };
 async function run(action){
  controls.disabled=true;
  feedback.textContent="";
  try{await action();}catch(e){feedback.textContent=e.message||"Could not complete this action.";}
  finally{controls.disabled=false;}
 }
 root.querySelector("#save-group").onclick=()=>run(async()=>{
  const memberIds=Array.from(picker.querySelectorAll("input:checked"),box=>box.value);
  if(!name.value.trim()||!memberIds.length)throw Error("Enter a group name and select at least one member.");
  const ref=group.value?doc(db,"contactGroups",group.value):doc(collection(db,"contactGroups"));
  await setDoc(ref,{name:name.value.trim(),memberIds});
  await refresh();group.value=ref.id;group.onchange();feedback.textContent="Group saved.";
 });
 root.querySelector("#remove-member").onclick=()=>run(async()=>{
  const id=member.value,p=members.get(id);
  if(!p)throw Error("Choose a member first.");
  const ownAccount = id === auth.currentUser.uid;
  const warning = ownAccount ? " You will immediately lose administrator access. If you are the last administrator, restoring access will require the Firebase console." : p.role === "admin" ? " This also revokes their administrator access." : "";
  if(!confirm("Remove "+p.displayName+" ("+p.email+") from app membership and the directory? They will lose member access."+warning))return;
  const batch=writeBatch(db);
  batch.update(doc(db,"users",id),{status:"removed"});
  batch.delete(doc(db,"memberDirectory",id));
  await batch.commit();
  if (ownAccount) { location.reload(); return; }
  await refresh(); feedback.textContent="Member access removed.";
 });
 form.onsubmit=e=>{
  e.preventDefault();run(async()=>{
   const byGroup=form.elements.target.value==="group";
   const selected=byGroup?groups.get(group.value):members.get(member.value);
   if(!selected)throw Error("Select the intended "+(byGroup?"saved group":"member")+" first.");
   const recipientIds=byGroup?selected.memberIds.filter(id=>members.has(id)):[member.value];
   if(!recipientIds.length)throw Error("This group has no approved recipients.");
   const label=byGroup?selected.name:selected.displayName;
   const push=form.elements.push.checked;
   if(!confirm("Send "+(push?"a message and phone alert":"an inbox message")+" to "+label+" ("+recipientIds.length+" recipients)?"))return;
   const notice=await addDoc(collection(db,"notifications"),{
    title:form.elements.subject.value.trim(),body:form.elements.body.value.trim(),
    recipientIds,audience:"targeted",kind:"general",active:true,linkTab:"",
    createdBy:auth.currentUser.uid,createdAt:serverTimestamp()
   });
   form.reset();feedback.textContent="Message saved to the selected inboxes.";
   if(push)try{
    const report=await sendPhonePush(notice.id);
    feedback.textContent+=" Phone delivery: "+report.sent+" accepted, "+report.failed+" failed.";
   }catch(error){feedback.textContent+=" Phone alert incomplete: "+error.message;}
  });
 };
 try{await refresh();controls.disabled=false;}catch(e){feedback.textContent="Unable to load member management: "+e.message;}
}

export function membersPage(){
 return `<h1>Members &amp; Groups</h1><div id="members-admin"><p role="status" aria-live="polite"></p><fieldset disabled>
 <section class="card"><h2>Members</h2><p id="roster-count"></p><label>Approved members<select class="field" id="member-choice"></select></label>
 <button class="button outline" id="remove-member">Remove member access</button></section>
 <section class="card"><h2>Groups</h2><label>Saved group<select class="field" id="group-choice"></select></label>
 <details><summary>Create or edit a group</summary><label>Group name<input class="field" id="group-name" maxlength="80"></label><div id="group-members"></div><button class="button" id="save-group">Save group</button></details></section>
 <form class="card" id="compose-member"><h2>Send a message</h2><label>Send to<select class="field" name="target"><option value="member">Selected member</option><option value="group">Selected saved group</option></select></label>
 <label>Subject<input class="field" name="subject" required minlength="2" maxlength="100"></label><label>Message<textarea class="field" name="body" required minlength="3" maxlength="500"></textarea></label>
 <label><input type="checkbox" name="push"> Also notify enabled phones</label><p><button class="button">Send message</button></p></form></fieldset></div>`;
}