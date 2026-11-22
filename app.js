// PMBC live member access. Registration remains disabled until Firestore rules are published.
import { auth, db } from "./firebase.js";
import { mountPrayer, unmountPrayer } from "./prayer.js";
import { mountServe, unmountServe } from "./serve.js?v=20261121-12";
import {
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, onAuthStateChanged, sendPasswordResetEmail, sendEmailVerification
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js";
import {
  doc, getDoc, setDoc, serverTimestamp, collection, query,
  where, getDocs, updateDoc
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js";

const REGISTRATION_ENABLED = true; // Enabled after the owner confirmed secure Firestore rules were published.
const screen = document.getElementById("screen");
const navTabs = [...document.querySelectorAll("[data-tab]")];
let user = null, profile = null, accountError = "", authBusy = false;
let section = "home", authMode = "login", review = null;

const escapeHTML = (x) => String(x ?? "").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const isApproved = () => profile?.status === "approved";
const isAdmin = () => isApproved() && profile?.role === "admin";
const signedInMessage = () => !user ? "Sign in to view private member information." : "Your membership is pending administrator approval.";
const info = (title, body) => `<article class="card"><strong class="itemtitle">${escapeHTML(title)}</strong><p>${escapeHTML(body)}</p></article>`;
const badge = (text) => `<span class="pill">${escapeHTML(text)}</span>`;

function home() {
 return `<section class="card hero"><span class="eyebrow">PMBC</span><h1>Welcome to PMBC</h1><p>Worship. Pray. Connect. Serve.</p></section>
 <div class="grid"><button class="tile" data-go="prayer"><span class="emoji">♡</span><strong>Prayer</strong></button>
 <button class="tile" data-go="serve"><span class="emoji">♧</span><strong>Serve</strong></button>
 <button class="tile" data-go="more"><span class="emoji">▣</span><strong>Announcements</strong></button>
 <button class="tile" data-go="more"><span class="emoji">▤</span><strong>Church Information</strong></button></div>
 <h2>Announcements</h2>${info("No announcements available","Nothing has been published yet.")}
 <h2>Events</h2>${info("No events available","Nothing has been scheduled yet.")}`;
}
function prayer() {
 return '<div id="prayer-root"></div>';
}
function serve() {
 return '<div id="serve-root"></div>';
}
function form() {
 let state = `<span class="eyebrow">Member access</span><h1>${authMode==="register"?"Request Membership":authMode==="reset"?"Reset Password":"Member Sign In"}</h1>
 <p class="muted">${authMode==="register"?"New accounts must be approved before private access is granted.":"PMBC uses your email and password."}</p>`;
 if(authMode==="register" && !REGISTRATION_ENABLED) return state + `<div class="notice">Registration is temporarily unavailable while we secure the member database.</div>
 <button type="button" class="button outline" data-authmode="login">Back to Sign In</button>`;
 state += `<form id="authForm" class="card stack" autocomplete="on">`;
 if(authMode==="register") state+=`<label for="displayName">Full Name</label><input class="field" id="displayName" name="displayName" minlength="2" maxlength="80" autocomplete="name" required>`;
 state += `<label for="email">Email Address</label><input class="field" type="email" id="email" name="email" autocomplete="email" required>`;
 if(authMode!=="reset") state +=`<label for="password">Password</label><input class="field" type="password" id="password" name="password" autocomplete="${authMode==="register"?"new-password":"current-password"}" minlength="6" required>`;
 state+=`<button class="button" type="submit" ${authBusy?"disabled":""}>${authBusy?"Please wait…":authMode==="register"?"Request Access":authMode==="reset"?"Send Reset Email":"Sign In"}</button></form>`;
 state+=`<div class="auth-links"><button data-authmode="login" type="button">Sign In</button>
 ${REGISTRATION_ENABLED?'<button data-authmode="register" type="button">Create Account</button>':''}
 <button data-authmode="reset" type="button">Forgot Password?</button></div>`;
 return state;
}
function account() {
 return `<span class="eyebrow">Your account</span><h1>${escapeHTML(profile?.displayName || user?.email || "PMBC Member")}</h1>
 <div class="card stack"><div><span class="muted">Email</span><p>${escapeHTML(user?.email)}</p></div>
 <div><span class="muted">Membership Status</span><p>${badge(isApproved()?"Approved":profile?.status==="rejected"?"Not Approved":"Pending Approval")}</p></div>
 ${!isApproved()?'<p class="muted">An administrator must approve your account before private church content becomes available.</p>':''}
 ${isAdmin()?'<button class="button" id="reviewBtn">Review Member Requests</button>':''}
 <button class="button outline" id="signOut">Sign Out</button></div>`;
}
function more() {
 return `<span class="eyebrow">Church community</span><h1>More</h1>
 ${accountError ? `<p role="alert" class="error">${escapeHTML(accountError)}</p>` : ""}
 ${user ? (review && isAdmin()? adminView() : account()) : form()}
 ${info("Church Information","Giving link and church service times have not been configured.")}`;
}
function adminView() {
 if(!review) return account();
 const list = review.map(m=>`<article class="card"><strong>${escapeHTML(m.displayName)}</strong>
 <p class="muted">${escapeHTML(m.email)}</p>
 <div class="button-row"><button class="button" data-approve="${escapeHTML(m.id)}">Approve</button>
 <button class="button outline" data-reject="${escapeHTML(m.id)}">Decline</button></div></article>`).join("");
 return `<span class="eyebrow">Admin · Membership</span><h2>Pending Requests</h2>
 <button class="button outline" id="backToAccount">Back to Account</button>
 ${list || '<p class="muted">No pending membership requests.</p>'}`;
}
const views = {home, prayer, serve, more};
function navigate(next) {
 section = views[next]?next:"home";render();
}
function render(){
 unmountPrayer();
 unmountServe();
 screen.innerHTML=views[section]();
 if(section==="prayer") mountPrayer(screen.querySelector("#prayer-root"),user,profile);
 if(section==="serve") mountServe(screen.querySelector("#serve-root"),user,profile);
 navTabs.forEach(b=>b.classList.toggle("active",b.dataset.tab===section));
 document.title="PMBC — "+section[0].toUpperCase()+section.slice(1);
 screen.querySelectorAll("[data-go]").forEach(b=>b.addEventListener("click",()=>{location.hash=b.dataset.go;}));
 screen.querySelectorAll("[data-authmode]").forEach(b=>b.addEventListener("click",()=>{authMode=b.dataset.authmode;accountError="";render()}));
 const af=screen.querySelector("#authForm");
 if(af)af.addEventListener("submit",submitAuth);
 screen.querySelector("#signOut")?.addEventListener("click",async()=>{await signOut(auth);review=null;accountError="";});
 screen.querySelector("#reviewBtn")?.addEventListener("click",loadReview);
 screen.querySelector("#backToAccount")?.addEventListener("click",()=>{review=null;render()});
 screen.querySelectorAll("[data-approve]").forEach(b=>b.addEventListener("click",()=>decide(b.dataset.approve,"approved")));
 screen.querySelectorAll("[data-reject]").forEach(b=>b.addEventListener("click",()=>decide(b.dataset.reject,"rejected")));
}
const humanError = (err) => {
 const code=err?.code||"";
 const messages={
 "auth/invalid-credential":"Email or password is incorrect.",
 "auth/email-already-in-use":"An account with this email already exists.",
 "auth/weak-password":"Please use a stronger password.",
 "auth/too-many-requests":"Too many attempts. Please try again later.",
 "auth/unauthorized-domain":"This website needs to be added to Firebase authorized domains.",
 "permission-denied":"Database permission denied. Please confirm the secure Firestore rules are published.",
 "auth/network-request-failed":"Can't reach Firebase. Check your internet connection."
 };
 return messages[code] || "Something went wrong. "+(code||"Please try again.");
};
async function submitAuth(event) {
 event.preventDefault();if(authBusy)return;
 const data=new FormData(event.currentTarget);authBusy=true;accountError="";render();
 try {
   const email=String(data.get("email")||"").trim();
   if(authMode==="reset") {await sendPasswordResetEmail(auth,email);accountError="Password reset email requested. Check your inbox.";authMode="login";}
   else if(authMode==="register" && REGISTRATION_ENABLED){
     const name=String(data.get("displayName")||"").trim();
     if(name.length<2||name.length>80)throw new Error("Name must have 2–80 characters.");
     const credential=await createUserWithEmailAndPassword(auth,email,String(data.get("password")));
     await setDoc(doc(db,"users",credential.user.uid),{displayName:name,email:credential.user.email,role:"member",status:"pending",createdAt:serverTimestamp()});
     await refreshProfile(credential.user);
   } else if(authMode==="login"){
     await signInWithEmailAndPassword(auth,email,String(data.get("password")));
   }
 }catch(err){accountError=humanError(err); if(err?.message?.startsWith("Name must"))accountError=err.message;}
 finally{authBusy=false;render();}
}
async function refreshProfile(current){
 if(!current){user=null;profile=null;render();return}
 user=current;
 try {
  const snapshot=await getDoc(doc(db,"users",current.uid));
  profile=snapshot.exists()?snapshot.data():null;
  if(!profile) accountError="Your account has no membership record. Ask an administrator to check setup.";
 }catch(err){profile=null;accountError=humanError(err)}
 render();
}
async function loadReview() {
 if(!isAdmin())return;
 try {
  const q=query(collection(db,"users"),where("status","==","pending"));
  const snap=await getDocs(q);
  review=snap.docs.map(x=>({id:x.id,...x.data()}));
  accountError="";render();
 }catch(err){accountError=humanError(err);render();}
}
async function decide(uid,status) {
 if(!isAdmin() || !review?.some(x=>x.id===uid))return;
 if(!window.confirm(status==="approved"?"Approve this member for private church access?":"Decline this membership request?"))return;
 try {await updateDoc(doc(db,"users",uid),{status});await loadReview();}
 catch(err){accountError=humanError(err);render()}
}
window.addEventListener("hashchange",()=>navigate(location.hash.slice(1)));
navTabs.forEach(b=>b.addEventListener("click",()=>{location.hash=b.dataset.tab;}));
navigate(location.hash.slice(1));
onAuthStateChanged(auth,async u=>{accountError="";review=null;await refreshProfile(u);});
if("serviceWorker" in navigator)window.addEventListener("load",()=>navigator.serviceWorker.register("./service-worker.js").catch(console.warn));
