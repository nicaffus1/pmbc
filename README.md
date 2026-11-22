# PMBC — Church Community App

A mobile-first progressive web app for church members, hosted on GitHub Pages and backed by Firebase.

- **Production:** https://nicaffus1.github.io/pmbc/
- **GitHub:** `nicaffus1/pmbc`
- **Firebase project:** `pmbc-d6d17`
- **Rebuild stage:** `rebuild-v2` (draft PR; do not publish untested changes)

## Why v2

The first version accumulated ministry, volunteering, scheduling, and prayer logic in the order new requests arrived. The rebuild follows **data contracts → permissions → minimal CRUD → navigation → scheduling → prayer moderation → mobile acceptance**. We preserve the existing Firebase document paths and never delete test or church data simply to make a feature work.

## Application navigation

**Home** — Welcome and placeholders for future events and announcements.

**Serve** — Pick a ministry, inspect its volunteer positions, register ongoing interest, sign up for one-time shifts, or commit to a recurring weekly schedule. Admins create ministries, positions, and schedules; can archive positions; can stop weekly schedules; and can choose volunteer roster visibility.

**Prayer** — Approved members submit, edit, mark answered, and acknowledge prayers. Authors and administrators may see leadership-only requests. Administrators can remove (hide) and restore requests.

**More** — Email/password access, member registration, password reset, pending approval, and administrator member review.

## Source layout

| File | Responsibility |
| --- | --- |
| `index.html`, `styles.css` | Responsive app shell and styles |
| `app.js` | Authentication, member approval, navigation |
| `firebase.js` | Firebase initialization; localhost-only emulator mode for tests |
| `ministry-data.js` | Independent Firestore ministry creation and subscription |
| `serve-model.js` | Ministry validation and rolling Chicago-time schedule calculations |
| `serve.js` | Serve screen, volunteer roles, shifts, signup views |
| `prayer.js` | Prayer requests, visibility, moderation |
| `firestore.rules` | Authorization and field-level data validation |
| `firestore.indexes.json` | Composite index definitions (deployment required) |
| `service-worker.js` | PWA asset cache |
| `tests/` | Unit, contract, security-emulator and browser tests |
| `REBUILD_PLAN.md` | Milestone sequence and acceptance criteria |

## Existing Firestore document paths

- `users/{uid}` — membership and roles; `role`: `admin` or `member`; `status`: `approved`, `pending` or `rejected`.
- `ministries/{ministryId}` — name, description, active flag.
- `ministries/{ministryId}/positions/{positionId}` — volunteer role, description, active flag.
- `.../positions/{positionId}/signups/{uid}` — ongoing interested volunteers.
- `.../positions/{positionId}/shifts/{shiftId}` — one-time dated shifts, notes, Central Time, roster audience.
- `.../shifts/{shiftId}/signups/{uid}` — volunteers assigned to a particular date.
- `.../positions/{positionId}/recurring/{scheduleId}` — weekly schedule template (weekday, times, notes, roster audience).
- `.../recurring/{scheduleId}/dates/{YYYY-MM-DD}/members/{uid}` — each week's sign-ups. Upcoming five weeks are computed on the client; four- and thirteen-week signup choices write dated records.
- `prayers/{prayerId}` — privacy, answered/active/removed status; `.../prayedBy/{uid}` — private personal acknowledgement.

## How we know a rebuild works

In the `rebuild-v2` branch, GitHub Actions must pass:

1. `npm test` — pure date and validation logic; Firestore/source contract checks.
2. `npm run test:rules` — official Firestore emulator, with simulated approved members, admins and unauthenticated users. No production data.
3. `npm run test:browser` — phone-sized browser tests against Firebase Auth and Firestore emulators: sign in, add ministry, reload, create positions, weekly schedules, multiweek signups and prayer moderation.
4. `node --check` — syntax checks across the JavaScript modules.
5. Manual acceptance on the actual website with two approved accounts, including Safari on iPhone, **before using real confidential prayer information**.

For local automated testing, install Node.js and Java, run `npm install`, then run the scripts above. Browser tests use `http://127.0.0.1:4173/?emulator`, and `firebase.js` only switches to emulators at localhost with the `emulator` query flag.

## Release and safety

The `rebuild-v2` branch is deliberately separate from production. Do not merge until tests pass. **GitHub commits do not publish Firebase Rules or indexes.** When Firestore rules change, deploy their complete validated contents through a trusted release process with a Firebase-authorized account. Do not put admin service credentials or private member data into GitHub.

Archive (soft-delete) position and prayer records rather than permanently erasing them. If a member prayer feed reports a missing composite index, deploy the indexes from `firestore.indexes.json`; do not weaken the privacy rules to hide the error.

Future phases include designated ministry leaders, capacity/approval controls, date exceptions, shift swaps, notifications, announcements, and a church information page.
