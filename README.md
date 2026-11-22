# PMBC — Church Community App

Mobile-first PWA for PMBC, hosted by GitHub Pages with Firebase project `pmbc-d6d17`.

## Current implementation
- Home, Prayer, Serve, More sections with **no fabricated church data**
- Real Firebase client initialization
- Email/password sign-in and password reset forms
- New member registration implementation (temporarily disabled using `REGISTRATION_ENABLED = false` in `app.js` until security setup is completed)
- Member profile document with pending approval status
- Administrator screen to approve or decline pending account requests
- Firestore rules stored in `firestore.rules`, **not yet published to Firebase**
- Prayer, serving, ministry management, push notifications and public content administration are not implemented yet

## Critical setup before opening registration

1. In Firebase Console → Firestore Database, create a **Cloud Firestore** database. Choose **production mode**, not test mode; choose a suitable region (location is difficult to change). Keep access locked until rules are installed.
2. Open Firestore Database → Rules. Replace the rules with the exact contents of `firestore.rules`, then click **Publish**.
3. In Firebase Authentication → Sign-in method, enable Email/Password.
4. In Firebase Authentication → Settings → Authorized domains, add the app's exact GitHub Pages host `nicaffus1.github.io` if it isn't already listed.
5. After rules have been published, change `const REGISTRATION_ENABLED = false;` to `true` in `app.js` and deploy.
6. Register the **first** account on the website. This safely creates a pending account.
7. In Firebase Console → Authentication → Users, copy that account's **User UID**.
8. In Firestore Database → Data → `users` → document ID matching that UID, set `role` to string `admin` and `status` to string `approved`. Do this ONLY for the trusted initial church administrator in the Firebase Console; ordinary users cannot assign these fields through app code. Reload the PMBC account page.
9. The administrator can approve other members from PMBC → More → Review Member Requests.

**IMPORTANT**: Never copy private member information into GitHub. Avoid adding real prayer requests until feature-specific Firestore rules and application screens are live and tested. Auth registration requires Internet access.

## Static assets
The original user-supplied blue dove must be stored unchanged as `assets/dove-source.jpg`, plus prepared home-screen icons `assets/icon-180.png`, `assets/icon-192.png`, and `assets/icon-512.png`. Missing images cannot be uploaded through the current GitHub text-file connector.

## Web hosting
Enable GitHub Pages in repository Settings → Pages → Deploy from branch → `main` → `/ (root)`. Public URL is expected to be `https://nicaffus1.github.io/pmbc/` once deployed.

## Next work
After verified Firestore rules and the first administrator, turn on registration and perform two-user authorization checks. Then build member prayer requests, secure leadership-only privacy, volunteer positions and shifts, ministry-scoped roles, and reminders.
