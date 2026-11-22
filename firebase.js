// PMBC Firebase client setup (public web configuration; not an admin secret).
// This file initializes the real Firebase project but does not grant member access.
import { initializeApp } from "https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDoK2hluWdGQFT8XQ5dpZaSs_RfR3c9CTI",
  authDomain: "pmbc-d6d17.firebaseapp.com",
  projectId: "pmbc-d6d17",
  storageBucket: "pmbc-d6d17.firebasestorage.app",
  messagingSenderId: "479677254461",
  appId: "1:479677254461:web:0607cd2298a323682f5354",
  measurementId: "G-775N47Y3XV"
};

export const firebaseApp = initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);
export const db = getFirestore(firebaseApp);
// Analytics is intentionally not initialized in this phase.
