// PMBC Firebase client setup (public web configuration; not an admin secret).
// This file initializes the real Firebase project but does not grant member access.
import { initializeApp } from "https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js";
import { getAuth, connectAuthEmulator } from "https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js";
import { getFirestore, connectFirestoreEmulator } from "https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDoK2hluWdGQFT8XQ5dpZaSs_RfR3c9CTI",
  authDomain: "pmbc-d6d17.firebaseapp.com",
  projectId: "pmbc-d6d17",
  storageBucket: "pmbc-d6d17.firebasestorage.app",
  messagingSenderId: "479677254461",
  appId: "1:479677254461:web:0607cd2298a323682f5354",
  measurementId: "G-775N47Y3XV"
};

// Explicit localhost-only emulator mode for automated tests. Never enabled on GitHub Pages.
const testMode = (location.hostname === "127.0.0.1" || location.hostname === "localhost")
  && new URLSearchParams(location.search).has("emulator");
if(testMode){
 firebaseConfig.projectId = "demo-pmbc";
 firebaseConfig.authDomain = "demo-pmbc.firebaseapp.com";
}
export const firebaseApp = initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);
export const db = getFirestore(firebaseApp);
if(testMode){
 connectAuthEmulator(auth,"http://127.0.0.1:9099",{disableWarnings:true});
 connectFirestoreEmulator(db,"127.0.0.1",8080);
}
// Analytics is intentionally not initialized in this phase.
