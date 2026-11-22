# PMBC — Church Community App

Mobile-first Progressive Web App, hosted on GitHub Pages at https://nicaffus1.github.io/pmbc/ and backed by Firebase project `pmbc-d6d17`.

## Implemented
- Member registration, email/password sign-in and password reset
- Administrator-approved membership; administrator account-review controls
- Real Firestore Prayer Wall (not sample data):
  - Approved members submit prayers and select `members` or `leadership` visibility.
  - Approved members see member-visible requests; each author can see their own leadership-only requests.
  - **Only approved PMBC administrators**, plus the author, can see leadership-only requests in this version. Assigned ministry leaders are *not* automatically prayer leadership.
  - Authors may update their prayers and mark answered. Administrators may moderate edits.
  - Members can tap “I Prayed” and undo their own acknowledgement; other members cannot read the identities of those who prayed.
  - Firestore listeners keep requests synchronized between signed-in devices.
- No invented prayer requests, volunteers or announcements.

## IMPORTANT: Publish the updated prayer security rules before using Prayer Wall
The `firestore.rules` file in this repository is a **source copy**. Committing it does not update Firebase permissions.

1. Open Firebase Console → project `pmbc-d6d17` → Firestore Database → **Rules**.
2. Copy the **entire** current file `firestore.rules` from this repo, replace the rules in Firebase, then select **Publish**.
3. Test with *non-sensitive dummy content* and two different accounts:
   - Pending account cannot read or write prayers.
   - Approved member can post a member-visible request.
   - Another approved member can see member-visible but not leadership-only requests.
   - Author can still see their own leadership-only request.
   - Administrator can read leadership-only requests.
   - Member cannot edit another person's prayer or read another person's “I Prayed” document.
4. Do not share sensitive real requests with the congregation until those access checks pass.

Firestore security enforces membership and prayer audience; hiding an item in the UI alone is not privacy. Never put confidential member data or administrator credentials in GitHub.

## Known limitations / next work
- Events, announcements, giving link, and ministry volunteer schedules still need to be built.
- Google Sign-In isn't yet wired into the UI (email/password is supported).
- Public announcements and events are currently empty-state placeholders.
- Scheduled reminders require a secure server-side scheduler and notification permission.
- Author names appear on submitted prayer requests. No anonymous-submission option yet.
- Deletion is blocked to avoid accidental permanent removal; records can be marked answered.
- No offline editing or queuing of prayer submissions; active network access is required.
- The service worker caches static app files, not Firebase member data.

## PMBC dove branding
Use the exact supplied artwork at `assets/dove-source.jpg` and the home-screen icons at `assets/icon-180.png`, `assets/icon-192.png`, `assets/icon-512.png`. Do not redraw the logo.

## First administrator
The first trusted administrator was established by manually setting their own `users/{uid}` Firestore document to exact string fields `role: "admin"` and `status: "approved"`. Only trusted administrators can approve subsequent membership requests through the app.
