import { membersPage, mountMembers } from "./member-admin.js";
// PMBC live member access. Registration remains disabled until Firestore rules are published.
import { auth, db } from "./firebase.js";
import { mountPrayer, unmountPrayer } from "./prayer.js";
import { mountBulletin, unmountBulletin } from "./bulletin.js";
import { mountResourceHub, unmountResourceHub } from "./resource-hub.js";
import { mountAnsweredPrayers, unmountAnsweredPrayers } from "./answered-prayers.js";
import { mountDirectory, unmountDirectory } from "./member-directory.js";
import { mountHelpBoard, unmountHelpBoard } from "./help-board.js";
import { mountCareBoard, unmountCareBoard } from "./care-board.js";
import { mountServe, unmountServe } from "./serve.js";
import { mountHomeUpdates, unmountHomeUpdates } from "./home-updates.js";
import { mountNotifications, unmountNotifications } from "./notifications.js?v=members1";
import { mountVideos, unmountVideos } from "./videos.js";
import { mountDailyVerse, unmountDailyVerse } from "./verse-of-day.js";
import { mountFacebookPosts, unmountFacebookPosts } from "./facebook-posts.js";
import {
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, onAuthStateChanged, sendPasswordResetEmail, sendEmailVerification
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js";
import {
  doc, getDoc, setDoc, serverTimestamp, collection, query,
  where, limit, getDocs, updateDoc
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js";

const REGISTRATION_ENABLED = true; // Enabled after the owner confirmed secure Firestore rules were published.
const screen = document.getElementById("screen");
const navTabs = [...document.querySelectorAll("[data-tab]")];
let user = null, profile = null, accountError = "", authBusy = false;
let section = "home", authMode = "login", review = null;

const THEME_KEY="pmbc-color-theme";
function savedTheme(){
 try{return localStorage.getItem(THEME_KEY)==="dark"?"dark":"light";}catch{return "light";}
}
function applyTheme(mode){
 const dark=mode==="dark";
 document.documentElement.classList.toggle("dark-mode",dark);
 document.documentElement.style.colorScheme=dark?"dark":"light";
 const meta=document.querySelector('meta[name="theme-color"]');
 if(meta)meta.setAttribute("content",dark?"#111e2b":"#082f59");
 const toggle=document.getElementById("darkModeToggle");
 if(toggle){toggle.checked=dark;toggle.setAttribute("aria-checked",String(dark));}
}
function setTheme(mode){
 try{localStorage.setItem(THEME_KEY,mode);}catch{}
 applyTheme(mode);
}
applyTheme(savedTheme());

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
function websiteHub(){
 return `<section class="website-quick-link" aria-label="Church website">
  <div><strong>Looking for church information?</strong><span>Service details, beliefs, and planning a visit</span></div>
  <a href="https://www.providence.center/" target="_blank" rel="noopener noreferrer">Church Website ↗</a>
 </section>`;
}
function facebookUpdates(){
 const page="https://www.facebook.com/providencembccenter/";
 return `<section class="home-facebook-section" aria-label="Church updates from Facebook">
  <div class="home-heading"><h2>Church Updates</h2>
  <a class="facebook-page-link" href="${page}" target="_blank" rel="noopener noreferrer">Facebook ↗</a></div>
  <p class="facebook-feed-intro">Shared from our church's Facebook Page.</p>
  <div id="facebook-post-list" aria-live="polite"><p class="muted">Loading church updates…</p></div>
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
 <a class="feature-link" href="#bulletin"><div><strong>This Week’s Bulletin</strong><span>Scripture, order of worship, and announcements</span></div><b class="arrow" aria-hidden="true">›</b></a>
 <a class="feature-link" href="#visitor"><div><strong>New to Providence?</strong><span>Plan a visit and learn what to expect</span></div><b class="arrow" aria-hidden="true">›</b></a>
 ${facebookUpdates()}
 <div id="updates-notice" class="notice" hidden></div>
 <section class="home-updates" aria-label="Church updates">
   <div class="home-heading"><h2>Member Events</h2>
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
 <section class="home-video-section" aria-label="Latest church sermons">
  <div class="home-heading"><h2>Latest Sermons</h2><a href="#videos" class="video-top-link">View all</a></div>
  <div id="home-video-list"><p class="muted">Loading latest sermons…</p></div>
 </section>`;
}
function bulletin(){return '<div id="bulletin-root"></div>';}
function missions(){return '<div id="resource-root"></div>';}
function studies(){return '<div id="resource-root"></div>';}
function groups(){return '<div id="resource-root"></div>';}
function hymns(){return '<div id="resource-root"></div>';}
function directory(){return '<div id="directory-root"></div>';}
function help(){return '<div id="help-root"></div>';}
function care(){return '<div id="care-root"></div>';}
function adminHub(){
 if(!isAdmin())return '<article class="card">Administrator access is required.</article>';
 return `<span class="eyebrow">Church administration</span><h1>Management Hub</h1>
 <p class="muted">Quick access to ministry administration. Each feature retains its own access controls.</p>
 <section class="admin-links"><a class="feature-link" href="#members"><strong>Members &amp; Groups</strong><span>Manage access and send messages</span></a>
 <a class="feature-link" href="#account"><div><strong>Member Approvals</strong><span>Approve new account requests</span></div><b class="arrow">›</b></a>
 <a class="feature-link" href="#care"><div><strong>Care & Follow-Up</strong><span>Private leadership follow-up tasks</span></div><b class="arrow">›</b></a>
 <a class="feature-link" href="#serve"><div><strong>Volunteer Scheduling</strong><span>Manage teams, positions and shifts</span></div><b class="arrow">›</b></a>
 <a class="feature-link" href="#notifications"><div><strong>Announcements & Notifications</strong><span>Publish app notices and enable phone delivery</span></div><b class="arrow">›</b></a>
 <a class="feature-link" href="#bulletin"><div><strong>Sunday Bulletin</strong><span>Edit and publish the weekly service guide</span></div><b class="arrow">›</b></a>
 <a class="feature-link" href="#missions"><div><strong>Missions</strong><span>Manage missionary updates</span></div><b class="arrow">›</b></a>
 <a class="feature-link" href="#studies"><div><strong>Discipleship</strong><span>Manage Bible studies</span></div><b class="arrow">›</b></a>
 <a class="feature-link" href="#groups"><div><strong>Ministry Groups</strong><span>Manage class and ministry notices</span></div><b class="arrow">›</b></a>
 <a class="feature-link" href="#hymns"><div><strong>Hymnal</strong><span>Maintain song references and links</span></div><b class="arrow">›</b></a>
 <a class="feature-link" href="#help"><div><strong>Help Board</strong><span>Review practical needs and volunteers</span></div><b class="arrow">›</b></a></section>`;
}
function visitor(){return `<section class="visitor-intro"><span class="eyebrow">Welcome to Providence</span><h1>Plan Your Visit</h1><p>We would be glad to worship with you at Providence Missionary Baptist Church in Center, Texas.</p></section>
 <article class="card"><h2>Come Visit</h2><p><strong>Providence Missionary Baptist Church</strong></p>
 <p>1129 CR 1265, Center, TX</p>
 <div class="visitor-action"><a class="button" target="_blank" rel="noopener noreferrer" href="https://www.google.com/maps/search/?api=1&query=1129%20CR%201265%2C%20Center%2C%20TX">Get Directions ↗</a>
 <a class="button outline" href="mailto:church@providence.center?subject=Planning%20a%20Visit">Ask a Question</a></div></article>
 <article class="card"><h2>What to Expect</h2><p>You'll find a congregation of believers gathering to worship God, hear the Scriptures, and encourage one another.</p>
 <details class="visitor-details"><summary>When are services?</summary><p>Sunday worship begins at 11:00 a.m. For other gathering times, visit <a href="https://www.providence.center/" target="_blank" rel="noopener noreferrer">our church website</a>. We keep times there so they are not duplicated or accidentally out of date.</p></details>
 <details class="visitor-details"><summary>Can I bring my children?</summary><p>Yes. Families and children are welcome. If you have questions about children's activities, please contact the church before your visit.</p></details>
 <details class="visitor-details"><summary>Do I need to make an account?</summary><p>No. Visitors can explore public church information without registering for member access.</p></details></article>
 <article class="card"><h2>Stay Connected</h2><p>Have a question or want someone to contact you? Send a message directly to the church.</p><a href="mailto:church@providence.center?subject=New%20Visitor%20Question">Email Providence ↗</a></article>`;}
function prayer() {
 return '<div id="prayer-root"></div><a class="feature-link" href="#answered"><div><strong>Answered Prayers</strong><span>Remember the requests marked answered</span></div><b class="arrow" aria-hidden="true">›</b></a>';
}
function answered(){return '<div id="answered-root"></div>';}
function serve() {
 return '<div id="serve-root"></div>';
}
function notifications(){
 return '<div id="notifications-root"></div>';
}
function videos(){
 return `<div class="videos-page"><span class="eyebrow">Sermons &amp; Messages</span><h1>Sermons</h1>
 <p class="muted">Listen to recent messages and find teachings by topic. The church website also has sermon notes and Scripture references.</p>
  <a class="sermon-website-link" href="https://www.providence.center/sermons/enduring-faith" target="_blank" rel="noopener noreferrer">Explore sermons on our church website ↗</a>
 <div id="videos-page-list"><p class="muted">Loading sermons…</p></div></div>`;
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
function connect() {
 const visit = '<a class="feature-link" href="#visitor"><div><strong>Plan Your Visit</strong><span>Welcome information for guests</span></div><b class="arrow">›</b></a>';
 if (!isApproved()) {
   return `<h1>Connect</h1>${visit}<a class="feature-link" href="#account">${user ? "View membership status" : "Member sign in"}</a>`;
 }
 return `<h1>Connect</h1><div id="connect-need"></div>
 <a class="feature-link" href="#help"><div><strong>Church Needs & Help</strong><span>Find ways to serve one another</span></div><b class="arrow">›</b></a>
 <a class="feature-link" href="#groups"><div><strong>Ministry Groups</strong><span>Classes, youth and other ministries</span></div><b class="arrow">›</b></a>
 <a class="feature-link" href="#directory"><div><strong>Member Directory</strong><span>Opt-in contacts for approved members</span></div><b class="arrow">›</b></a>
 ${visit}`;
}
async function showOpenNeed(target) {
 try {
   const open = await getDocs(query(collection(db,"helpRequests"),where("status","==","open"),limit(1)));
   if (!target.isConnected || open.empty) return;
   const need = open.docs[0];
   const link = document.createElement("a");
   link.className = "feature-link";
   link.href = "#help?need=" + encodeURIComponent(need.id);
   link.textContent = "Open need · " + need.data().title;
   target.append(link);
 } catch {
   // The help board link remains available when the preview cannot load.
 }
}
function more() {
 return `<h1>More</h1>
 <details class="card more-resources"><summary>Study & Ministry Resources</summary>
 <a class="feature-link" href="#studies"><div><strong>Bible Studies</strong><span>Scripture and reflection questions</span></div><b class="arrow">›</b></a>
 <a class="feature-link" href="#missions"><div><strong>Missions & Missionaries</strong><span>Updates from supported ministries</span></div><b class="arrow">›</b></a>
 <a class="feature-link" href="#hymns"><div><strong>Digital Hymnal</strong><span>Hymn references and resources</span></div><b class="arrow">›</b></a></details>
 ${isAdmin()?'<a class="feature-link admin-entry" href="#admin"><div><strong>Church Administration</strong><span>Manage church updates and private care</span></div><b class="arrow">›</b></a>':''}
 <section class="card appearance-card" aria-label="Appearance settings">
  <h2>Appearance</h2>
  <label class="theme-toggle-row" for="darkModeToggle">
    <span><strong>Dark Mode</strong><small>Use a darker look for comfortable reading.</small></span>
    <input id="darkModeToggle" type="checkbox" role="switch" aria-label="Dark Mode" ${savedTheme()==="dark"?"checked":""}>
  </label>
 </section>
 <section class="card share-pmbc-card" aria-label="Share the Providence app">
  <h2>Share Providence</h2><p>Invite someone to stay connected with our church.</p>
  <button type="button" class="button share-pmbc-button" id="sharePmbcApp">Share Church App ↗</button>
  <p class="section-note" id="sharePmbcStatus" role="status" aria-live="polite"></p>
 </section>
 ${givingCard()}
 ${contactUs()}
 ${churchInfo()}`;
}
async function sharePmbcApp(){
 const url="https://nicaffus1.github.io/pmbc/#home";
 const title="Providence Missionary Baptist Church";
 const text="Stay connected with Providence Missionary Baptist Church through our church app.";
 const status=document.getElementById("sharePmbcStatus");
 if(navigator.share){
  try{await navigator.share({title,text,url});return;}
  catch(err){if(err?.name==="AbortError")return;}
 }
 try{
  await navigator.clipboard.writeText(url);
  if(status)status.textContent="Church app link copied! Paste it into a text or message.";
 }catch{
  window.prompt("Copy the church app link:",url);
  if(status)status.textContent="Copy this link to share the church app.";
 }
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
const views = {members:()=>isAdmin()?membersPage():"<p>Administrator access required.</p>",connect, home, prayer, serve, more, notifications, videos, bulletin, visitor, missions, studies, groups, hymns, directory, help, care, admin:adminHub, answered, account:accountPage};
function navigate(next) {
 const route = next.split("?")[0];
 section = Object.hasOwn(views,route)?route:"home";render();
}
function render(){
 unmountPrayer();
 unmountBulletin();
 unmountResourceHub();
 unmountAnsweredPrayers();
 unmountDirectory();
 unmountHelpBoard();
 unmountCareBoard();
 unmountServe();
 unmountHomeUpdates();
 unmountNotifications();
 unmountVideos();
 unmountDailyVerse();
 unmountFacebookPosts();
 screen.innerHTML=views[section]();
 if(section==="members" && isAdmin()) mountMembers(screen.querySelector("#members-admin"));
 if(section==="connect" && isApproved()) showOpenNeed(screen.querySelector("#connect-need"));
 if(section==="home"){ mountHomeUpdates(screen,user,profile);mountDailyVerse();mountFacebookPosts();mountVideos(false); }
 if(section==="videos") mountVideos(true,isAdmin());
 if(section==="bulletin") mountBulletin(screen.querySelector("#bulletin-root"),isAdmin());
 if(["missions","studies","groups","hymns"].includes(section)) mountResourceHub(screen.querySelector("#resource-root"),section,isAdmin(),isApproved());
 if(section==="directory") mountDirectory(screen.querySelector("#directory-root"),user,profile);
 if(section==="help") mountHelpBoard(screen.querySelector("#help-root"),user,profile);
 if(section==="care") mountCareBoard(screen.querySelector("#care-root"),isAdmin());
 if(section==="notifications") mountNotifications(screen.querySelector("#notifications-root"),user,profile);
 if(section==="prayer") mountPrayer(screen.querySelector("#prayer-root"),user,profile);
 if(section==="answered") mountAnsweredPrayers(screen.querySelector("#answered-root"),user,profile);
 if(section==="serve") mountServe(screen.querySelector("#serve-root"),user,profile);
 const parentTab = {members:"more",visitor:"connect",help:"connect",groups:"connect",directory:"connect",answered:"prayer",bulletin:"home",studies:"more",missions:"more",hymns:"more",admin:"more",care:"more"}[section] || section;
 navTabs.forEach(button=>{
   const active = button.dataset.tab === parentTab;
   button.classList.toggle("active",active);
   button.setAttribute("aria-current",active ? "page" : "false");
 });
 const bell=document.getElementById("notificationBell");
 if(bell)bell.classList.toggle("active",section==="notifications");
 const accountButton=document.getElementById("accountButton");
 if(accountButton){accountButton.classList.toggle("active",section==="account");accountButton.setAttribute("aria-current",section==="account"?"page":"false");}
 document.title="PMBC — "+section[0].toUpperCase()+section.slice(1);
 screen.querySelectorAll("[data-go]").forEach(b=>b.addEventListener("click",()=>{location.hash=b.dataset.go;}));
 screen.querySelectorAll("[data-authmode]").forEach(b=>b.addEventListener("click",()=>{authMode=b.dataset.authmode;accountError="";render()}));
 screen.querySelector("#sharePmbcApp")?.addEventListener("click",sharePmbcApp);
 screen.querySelector("#darkModeToggle")?.addEventListener("change",e=>setTheme(e.target.checked?"dark":"light"));
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
