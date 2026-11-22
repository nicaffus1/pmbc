// PMBC live member access. Registration remains disabled until Firestore rules are published.
import { auth, db } from "./firebase.js";
import { mountPrayer, unmountPrayer } from "./prayer.js";
import { mountServe, unmountServe } from "./serve.js";
import { mountHomeUpdates, unmountHomeUpdates } from "./home-updates.js";
import { mountNotifications, unmountNotifications } from "./notifications.js";
import { mountVideos, unmountVideos } from "./videos.js";
import { mountDailyVerse, unmountDailyVerse } from "./verse-of-day.js";
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

function givingCard(compact=false){
 const href="https://giv.li/amnptg";
 return compact
  ? `<a class="giving-home-link" href="${href}" target="_blank" rel="noopener noreferrer" aria-label="Give securely through Givelify"><span>Support Our Church</span><strong>Give Online <span aria-hidden="true">↗</span></strong></a>`
  : `<section class="card giving-card" aria-label="Online giving">
   <h2>Giving</h2>
   <p>Support the ministry of Providence Missionary Baptist Church through Givelify.</p>
   <a class="button giving-button" href="${href}" target="_blank" rel="noopener noreferrer">Give Online <span aria-hidden="true">↗</span></a>
   <p class="section-note">Givelify opens separately. PMBC does not collect or store your payment information.</p>
  </section>`;
}
function contactUs(){
 return `<section class="card contact-card" aria-label="Contact Providence">
  <h2>Contact Us</h2>
  <p>Have a question or something you'd like to share? Send the church a message.</p>
  <details class="contact-panel"><summary>Write a message <span aria-hidden="true">›</span></summary>
   <form id="contactForm" class="stack contact-form">
    <label for="contactTopic">What would you like to talk about?</label>
    <select class="field" id="contactTopic" name="topic" required>
     <option value="">Choose a topic</option>
     <option>General question</option>
     <option>Prayer request</option>
     <option>Talk with the pastor</option>
     <option>Visiting the church</option>
     <option>Church services or events</option>
     <option>Serving or volunteering</option>
     <option>Giving or donations</option>
     <option value="Something else">Something else</option>
    </select>
    <label for="contactName">Your name (optional)</label>
    <input class="field" id="contactName" name="name" maxlength="80" autocomplete="name" placeholder="Your name">
    <label for="contactMessage">Your message</label>
    <textarea class="field" id="contactMessage" name="message" rows="5" minlength="5" maxlength="3000" placeholder="Write your message here..." required></textarea>
    <button class="button" type="submit">Continue to email</button>
    <p class="section-note">Your email app will open with your message ready to send to church@providence.center. Review and tap Send there to deliver it. PMBC does not save this form.</p>
   </form>
  </details>
  <a class="contact-email" href="mailto:church@providence.center">Or email church@providence.center directly</a>
 </section>`;
}
function submitContact(event){
 event.preventDefault();
 const form=event.currentTarget;
 if(!form.reportValidity())return;
 const topic=String(form.elements.namedItem("topic").value||"").trim();
 const name=String(form.elements.namedItem("name").value||"").trim();
 const message=String(form.elements.namedItem("message").value||"").trim();
 if(!topic||message.length<5)return;
 const subject="PMBC Contact: "+topic;
 const body=(name?"From: "+name+"\n\n":"")+"Topic: "+topic+"\n\n"+message;
 const url="mailto:church@providence.center?subject="+encodeURIComponent(subject)+"&body="+encodeURIComponent(body);
 window.location.href=url;
}
function churchInfo(){
 return `<section class="card church-info" aria-label="Church information">
   <h2>Providence Missionary Baptist Church</h2>
   <p>We are a group of believers working together to share the gospel of Christ to our community and to the world! We love God and we love people!</p>
   <div class="church-contact">
     <div><strong>Location</strong><a href="https://www.google.com/maps/search/?api=1&query=1129%20CR%201265%2C%20Center%2C%20TX" target="_blank" rel="noopener noreferrer">1129 CR 1265, Center, TX</a></div>
     <div><strong>Website</strong><a href="https://providence.center" target="_blank" rel="noopener noreferrer">providence.center</a></div>
     <div><strong>Email</strong><a href="mailto:church@providence.center">church@providence.center</a></div>
     <div><strong>Facebook</strong><a href="https://www.facebook.com/share/19xnAkbkgi/" target="_blank" rel="noopener noreferrer">Providence Missionary Baptist Church</a></div>
   </div>
 </section>`;
}
function facebookUpdates(){
 const page="https://www.facebook.com/providencembccenter/";
 const iframe="https://www.facebook.com/plugins/page.php?href="+encodeURIComponent(page)+
  "&tabs=timeline&width=340&height=490&small_header=true&adapt_container_width=true&hide_cover=true&show_facepile=false";
 return `<section class="home-facebook-section" aria-label="Facebook church updates">
  <div class="home-heading"><h2>From Facebook</h2><a class="facebook-page-link" href="${page}" target="_blank" rel="noopener noreferrer">Open Facebook ↗</a></div>
  <p class="facebook-feed-intro">Recent updates posted by Providence Missionary Baptist Church.</p>
  <div class="facebook-feed-frame">
   <iframe title="Providence Missionary Baptist Church Facebook updates" src="${iframe}"
    width="340" height="490" loading="lazy" scrolling="no" frameborder="0"
    allow="encrypted-media; picture-in-picture" referrerpolicy="strict-origin-when-cross-origin"></iframe>
  </div>
  <p class="facebook-feed-note">Facebook controls which posts appear here. If the feed is blank, use Open Facebook above.</p>
 </section>`;
}
function home() {
 return `<section class="card hero home-welcome">
   <span class="eyebrow">Providence Missionary Baptist Church</span>
   <h1>Welcome</h1>
   <p>Worship. Pray. Connect. Serve.</p>
 </section>
 <section id="daily-verse" class="daily-verse card" aria-label="Verse of the Day"></section>
 ${givingCard(true)}
 ${facebookUpdates()}
 <div id="updates-notice" class="notice" hidden></div>
 <section class="home-updates" aria-label="Church updates">
   <div class="home-heading"><h2>Upcoming Events</h2>
     ${isAdmin()?`<details class="home-create" data-panel="create-event">
      <summary>+ Add</summary>
      <form class="stack update-editor" data-update-form="event">
       <label>Event title<input class="field" name="title" minlength="2" maxlength="100" required></label>
       <label>Details (optional)<textarea class="field" name="description" maxlength="1200" rows="3"></textarea></label>
       <label>Date<input class="field" name="date" type="date" required></label>
       <label>Start time (Central)<select class="field" name="time"></select></label>
       <label>Duration<select class="field" name="duration"></select></label>
       <label>Location (optional)<input class="field" name="location" maxlength="160"></label>
       <p class="section-note">Times are in 30-minute steps. Event disappears when it ends.</p>
       <button class="button" type="submit">Publish event</button>
      </form>
     </details>`:""}
   </div>
   <div id="home-events"><p class="muted">Loading events…</p></div>
   <div id="home-event-history"></div>
 </section>
 <section class="home-video-section" aria-label="Latest church videos">
  <div class="home-heading"><h2>Latest Videos</h2><a href="#videos" class="video-top-link">View all</a></div>
  <div id="home-video-list"><p class="muted">Loading latest videos…</p></div>
 </section>`;
}
function prayer() {
 return '<div id="prayer-root"></div>';
}
function serve() {
 return '<div id="serve-root"></div>';
}
function notifications(){
 return '<div id="notifications-root"></div>';
}
function videos(){
 return `<div class="videos-page"><span class="eyebrow">Sermons &amp; Messages</span><h1>Church Videos</h1>
 <p class="muted">Latest uploads from Providence on YouTube.</p>
 <div id="videos-page-list"><p class="muted">Loading videos…</p></div></div>`;
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
function accountPage() {
 return `<div class="account-page">
 ${accountError ? `<p role="alert" class="error">${escapeHTML(accountError)}</p>` : ""}
 ${user ? (review && isAdmin()? adminView() : account()) : form()}
 </div>`;
}
function more() {
 return `<span class="eyebrow">Connect &amp; Support</span><h1>More</h1>
 ${givingCard()}
 ${contactUs()}
 ${churchInfo()}`;
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
const views = {home, prayer, serve, more, notifications, videos, account:accountPage};
function navigate(next) {
 section = views[next]?next:"home";render();
}
function render(){
 unmountPrayer();
 unmountServe();
 unmountHomeUpdates();
 unmountNotifications();
 unmountVideos();
 unmountDailyVerse();
 screen.innerHTML=views[section]();
 if(section==="home"){ mountHomeUpdates(screen,user,profile);mountDailyVerse();mountVideos(false); }
 if(section==="videos") mountVideos(true);
 if(section==="notifications") mountNotifications(screen.querySelector("#notifications-root"),user,profile);
 if(section==="prayer") mountPrayer(screen.querySelector("#prayer-root"),user,profile);
 if(section==="serve") mountServe(screen.querySelector("#serve-root"),user,profile);
 navTabs.forEach(b=>b.classList.toggle("active",b.dataset.tab===section));
 const bell=document.getElementById("notificationBell");
 if(bell)bell.classList.toggle("active",section==="notifications");
 const accountButton=document.getElementById("accountButton");
 if(accountButton){accountButton.classList.toggle("active",section==="account");accountButton.setAttribute("aria-current",section==="account"?"page":"false");}
 document.title="PMBC — "+section[0].toUpperCase()+section.slice(1);
 screen.querySelectorAll("[data-go]").forEach(b=>b.addEventListener("click",()=>{location.hash=b.dataset.go;}));
 screen.querySelectorAll("[data-authmode]").forEach(b=>b.addEventListener("click",()=>{authMode=b.dataset.authmode;accountError="";render()}));
 screen.querySelector("#contactForm")?.addEventListener("submit",submitContact);
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
document.querySelector("#notificationBell")?.addEventListener("click",()=>{location.hash="notifications";});
document.querySelector("#accountButton")?.addEventListener("click",()=>{location.hash="account";});
navigate(location.hash.slice(1));
onAuthStateChanged(auth,async u=>{accountError="";review=null;await refreshProfile(u);});
if("serviceWorker" in navigator)window.addEventListener("load",()=>navigator.serviceWorker.register("./service-worker.js").catch(console.warn));
