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

## Serve: ministry foundation
- Approved administrators can create real church ministries through Serve.
- Approved members can view ministry names and descriptions; pending accounts cannot read ministries.
- Before the new Serve screen can save or display ministries, publish the updated `firestore.rules` in Firebase Console → Firestore Database → Rules. GitHub changes do not publish Firebase permissions.
- Administrators can now add volunteer positions under ministries; approved members can join and leave a position (ongoing interest, not a dated shift). Signups are stored at `ministries/{ministryId}/positions/{positionId}/signups/{memberUid}`. Ordinary members can only read or write their own signup; admins can review the signup documents in Firebase.\n- Publish the latest `firestore.rules` before using the new position and signup controls. Recheck that existing prayer and membership features remain available.\n- Scheduled shifts are now available beneath each position: admins create same-day Central Time shifts; approved members can sign up or cancel with Firebase-stored records. No capacity limit, approval flow, reminder, or leader delegation yet. Publish updated rules before testing.\n- The next phases will add shift capacity, approval options, ministry-scoped leaders, volunteer rosters, and notifications.

## Known limitations / next work
- Events, announcements, giving link, and full scheduling administration still need to be built; ministries, positions, and dated shift sign-ups are implemented.
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

## Shift rosters and position removal
- Each shift displays live volunteer names and a count, scoped to its configured audience.
- Shift creator may choose whether approved members or administrators may view the roster. Administrators may also change the audience on an existing shift. Older shifts default to member-visible rosters.
- Firestore rules restrict roster **list** reads to authorized viewers; a user's own signup remains readable to themselves. Roster privacy is not just UI hiding.
- Administrators can **Remove Position** (sets `active: false`) and later **Restore** it from the collapsed Removed Positions list. It is not a permanent delete: historical shifts and signups are retained, and new signups for archived positions are blocked.
- **Deployment:** publish the entire updated `firestore.rules` to Firebase Console → Firestore Rules. Do not just copy new fragments over older rules. Test a member-visible roster, an admin-only roster, removal, and restoration with the separate approved test member account before storing sensitive volunteer information.

## Ministry picker, rolling weekly schedules, and prayer request moderation

- **Serve navigation:** after sign-in, choose one ministry from a picker rather than displaying every ministry's positions at once. Existing ministry documents are unchanged.
- **Weekly recurring schedules:** administrators add a title, weekday, start/end time, notes, and roster audience inside a volunteer position. Schedules are stored under `ministries/{ministryId}/positions/{positionId}/recurring/{scheduleId}`.
- The app calculates the **next five upcoming occurrences** from the current America/Chicago church date. Past occurrences roll out of the display without deleting their signup records. This requires no scheduled background job, but a page refresh/reopen is needed if the page remains open across the rollover.
- Approved members may join/cancel each occurrence, volunteer for the next **4 weeks** (approx. month), or next **13 weeks** (approx. three months) in one action. Multiweek signup preserves already registered dates and uses an atomic Firestore batch for new dates.
- A schedule can be stopped by an administrator without destroying historical signups. Editing a recurrence or rescheduling an individual date are future features.
- **Prayer moderation:** administrators can Remove and Restore prayers. Removal changes `status` to `removed`, hides those requests from ordinary member queries, and preserves the original document and acknowledgements for recovery. This is not permanent deletion.
- Firebase permissions for recurring signups and removed prayers are included in the source `firestore.rules`, which must be **published separately** to the project's Firestore Rules page.
- Member prayer queries now include visibility + status; their Firestore composite indexes are declared in `firestore.indexes.json`. Creating this file in GitHub **does not deploy the indexes**. If Firebase reports a missing index on the Prayer Wall, create the corresponding Firestore index in the console or deploy the JSON with Firebase CLI; do not expose removed prayer requests by weakening security rules.
- Test with non-sensitive records and both administrator and approved test member accounts before using these new features for church operations.
