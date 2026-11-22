# PMBC Firebase notifications backend — deployment and first test

The website is on GitHub Pages, but **push delivery and scheduled reminders run in Firebase Cloud Functions**, not GitHub Pages. All backend source files are under `functions/`.

## 1. Configure Firebase and billing

- Project: `pmbc-d6d17`
- Open [Firebase Console](https://console.firebase.google.com/project/pmbc-d6d17/overview) and make sure the project is on the **Blaze** billing plan before deploying Cloud Functions. Set budget alerts and review your spending limits. Cloud Scheduler usage is billable; the scheduled job executes every 15 minutes.
- Your public Web Push key is already in `push-config.js`. **Never publish the private key or service-account credentials.**

## 2. Publish the Firestore rules

Open [Firebase Firestore Rules](https://console.firebase.google.com/project/pmbc-d6d17/firestore/rules), paste the complete contents of `firestore.rules` from this repository, and choose **Publish**.

These rules separate:
- Church-wide notifications, visible to approved members.
- Admin-only notifications.
- Private reminders, available only to their intended approved member and administrators.
- Individual device tokens under `users/{uid}/pushTokens`, writable and readable only by their owner.

## 3. Deploy the Cloud Functions

From a terminal with Node.js 22 and Firebase CLI:

```bash
npm install -g firebase-tools
firebase login
git clone https://github.com/nicaffus1/pmbc.git
cd pmbc
cd functions
npm install
npm test
npm run check
cd ..
firebase deploy --only functions --project pmbc-d6d17
```

You can also use Cloud Shell and the repository source if you don't want to install tools locally. This repository has a `firebase.json` pointing to the `functions/` directory. Do not use GitHub Actions secrets or commit credential files.

After successful deployment, confirm **both** functions in [Cloud Functions](https://console.firebase.google.com/project/pmbc-d6d17/functions):
- `deliverAdminNotification`: Firestore trigger that pushes new notifications.
- `sendScheduledReminders`: Cloud Scheduler job that scans for due event and Serve reminders every 15 minutes.

Firebase may prompt you to enable required Google Cloud APIs when deploying. Cloud Scheduler can also be checked in Google Cloud Console.

## 4. Opt in on each phone

On an iPhone, open PMBC in Safari, choose **Share > Add to Home Screen**, then open it from that new icon. Sign in with an approved member account.

Open the top-right bell and choose **Enable Phone Alerts**. Accept the iOS permission request. The app will register this device with Firebase. The permission button won't send a phone alert until the backend is deployed.

## 5. Manual push test

With one opted-in device, an administrator goes to Notifications > **Send notification** and publishes a short member notification such as "PMBC push test" / "Testing church phone alerts" with the audience **All approved members**.

After the backend is deployed, the corresponding function should send a push to that device and the entry will also appear in the in-app inbox.

## Automatic reminders now implemented

| Reminder | Recipient | Timing |
|---|---|---|
| Upcoming event | All approved members | Approximately 24 hours before the event |
| Serving shift | Signed-up member only | Approximately 24 hours before |
| Serving shift | Signed-up member only | Approximately 1 hour before |
| Unfilled Serve shift | Administrators | Approximately 24 hours before |

A reminder is added as a Firestore notification and appears in the appropriate inbox. It also produces a phone push for members who opted in. Scheduled scans run every 15 minutes, with a 30-minute due window to tolerate scheduling drift. Reminder IDs are deterministic, so overlapping scans will not create duplicates.

Expired events, removed records, or inactive ministries, positions, and shifts are skipped. Only currently approved recipients receive device pushes. Private Serve reminders do not expose another member's shift through the general notification feed.

**Not implemented yet:** automatic prayer reminders (frequency and audience still need to be selected), reminders for recurring Serve schedules, per-member push preference controls, and a production dashboard for delivery failures. Cloud delivery is not guaranteed by the operating system; Focus/Do Not Disturb and device settings may suppress alerts.

## Operational cautions

- Notification sending uses an **at-most-once dispatch claim** to avoid duplicate alerts on Firestore trigger retries. A rare server failure during sending can leave a partial delivery. Review `notificationDispatch/{notificationId}` and Cloud Function logs for failed attempts; they are not automatically re-sent.
- If the church later grows to many ministries and shifts, the scheduled scan should be optimized or converted to indexed queries.
- The backend is committed, but **not deployed or live-tested** by ChatGPT. Publishing Firestore rules does not deploy Cloud Functions.
