# PMBC Rebuild v2 — Ordered implementation and acceptance checklist

This branch is an **isolated rebuild**. The live `main` GitHub Pages site and all Firebase documents remain unchanged until a reviewed promotion. Nothing in this branch should be presented as already working for church members.

## Why rebuild
Features were added as independent patches to one long Serve module, with UI event handling, Firestore subscriptions, and scheduling mixed together. Firestore rules were manually copied without an automated validation/deployment process. The result is a screen that can show a form while its save action does nothing. We must make the core path independently verifiable before restoring advanced features.

## Source of truth
- GitHub repo: `nicaffus1/pmbc`.
- Production site: `https://nicaffus1.github.io/pmbc/`.
- Firebase project: `pmbc-d6d17`. Existing records must be preserved.
- Firestore users: `users/{uid}`, lowercase `role` and `status`.
- Requests: `prayers/{id}`, `prayedBy/{uid}`.
- Ministries: `ministries/{id}`.
- Positions: `ministries/{id}/positions/{id}`.
- One-time shifts: `positions/{id}/shifts/{id}/signups/{uid}`.
- Recurring weekly schedules: `positions/{id}/recurring/{id}/dates/{YYYY-MM-DD}/members/{uid}`.

## Development order
1. **Authentication + secure member identity.** Sign up, sign in, reset, pending member, approval, admin. Reject unauthorized reads and writes. Must pass with two accounts before any feature work.
2. **Data and rules foundation.** Freeze existing collection shapes; put Firestore rules and indexes in source control; validate syntax and authorization; don't copy partial rule fragments. Protect church/member data.
3. **Ministry core — only name + description.** Separate the Firestore write service from screen click handler. Display explicit feedback for validation, in-flight write, permission errors, success. Test save -> refresh -> view using admin account. **Do not attach shift listeners to the ministry composer.**
4. **Positions.** Admin adds position under a ministry. Admin archives/restores, never deletes historical signup data. Members browse only active positions.
5. **Navigation.** Members select one ministry; only selected ministry's positions and schedules are subscribed/rendered. No giant feed.
6. **One-time serving.** Admin creates date, time, per-shift notes, roster audience. Approved member opts in/out; appropriate audience sees volunteer names. Past shifts disappear from upcoming view but data remains.
7. **Weekly recurrence.** Admin defines weekday/time/notes once. The app calculates 5 upcoming instances in Chicago time, rolling as time passes. 1-week, 4-week and 13-week signup operations should be idempotent; individual cancellation always possible. Admin stops/restores recurring schedules. Event exceptions and date-specific notes are later.
8. **Prayer Wall.** Approved members submit, update, mark answered; public-to-members vs admin/author-only; "I Prayed" privacy. Admin hides/removes and restores. Security must enforce hidden status in read queries. Deploy required composite indexes.
9. **Testing / release.** Automated unit/static tests, security-rule simulator tests, two-account Safari tests, then promote to `main`. Bump service-worker version and verify build marker. No new Firestore migrations unless absolutely necessary.

## User-requested features
- Small, mobile-friendly PMBC PWA with dove icon and bottom tabs: Home, Prayer, Serve, More.
- Admin-approved accounts; no unauthenticated access to private requests.
- Ministry picker, ministry descriptions, volunteer positions, interested members.
- Date-specific shifts with personal signups, visible rosters configurable by admin.
- Children’s Church, Music Ministry and any weekly service recurring; five Sundays ahead, automatic rollover.
- Commit for a month (4 weeks) or ~3 months (13 weeks) at once.
- Admin removals: archive a position, stop a recurring series, hide/restore prayer request.
- Later: ministry-scoped leaders, volunteer assignment, slots/capacity, swaps, notifications and public events.

## Rules for rebuilding
- Never directly delete production data to troubleshoot.
- Do not modify Firestore permissions to make a frontend failure seem fixed.
- All state-changing controls must visibly confirm: action started, saved, or exact sanitized error.
- Keep form input values while database snapshots redraw lists.
- Use UTC-safe date arithmetic + America/Chicago wall-clock times; weekly instances are computed, not pre-generated indefinitely.
- Auto-created sign-ups are never assumed; record each approved member's explicit choice.
- Don't merge a feature until it has tests for permissions and regression behavior.
- Published Firebase rules are NOT automatically changed by GitHub commits.
- An older PWA service worker may cache an old app; test script-build marker, not refresh assumptions.
