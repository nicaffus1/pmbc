# PMBC — Send Phone Alerts Directly From the App (Free Plan)

Status: The PMBC code and Cloudflare Worker are committed to GitHub. **No Worker has been deployed or connected yet.** The admin form will save only to the existing inbox until you complete the steps below.

## A. Deploy a free Cloudflare Worker using GitHub (phone-friendly)

1. Create or sign into a free account at https://dash.cloudflare.com .
2. Go to **Workers & Pages** > **Create** > connect/import a Git repository (the wording may differ).
3. Authorize the GitHub repository **nicaffus1/pmbc**. Choose it as the source.
4. Set the **Worker name** to `pmbc-push-sender` — it must match `cloudflare/wrangler.toml`.
5. Set the repository **root directory** to `cloudflare`.
6. Set **Build command** to `npm install` (if prompted), and **Deploy command** to `npx wrangler deploy`.
7. Deploy and copy the exact Worker URL, which will look like `https://pmbc-push-sender.YOUR-SUBDOMAIN.workers.dev`.
8. The Worker will not send notifications yet: it still needs its Firebase credential stored securely.

Cloudflare documentation on [Git-connected Workers](https://developers.cloudflare.com/workers/ci-cd/builds/) confirms that the Worker name must match the Wrangler configuration and explains the root directory setting.

## B. Configure the Firebase service account safely

This is a **secret**, unlike your public Web Push/VAPID key.

1. In Firebase Console for `pmbc-d6d17`, go to **Project settings** > **Service accounts** > **Generate new private key** for a Firebase Admin SDK service account.
2. Download the JSON and **keep it private**. Do **not** upload it to GitHub, send it in chat or email, or paste it into any public webpage.
3. In Cloudflare, open your new `pmbc-push-sender` Worker > **Settings** > **Variables and Secrets** > **Add**, choose **Secret**.
4. Set the name exactly to `FIREBASE_SERVICE_ACCOUNT_JSON` and paste the **entire JSON file contents** as its value. Save/deploy the new version as prompted.
5. Confirm the **Firebase Cloud Messaging API (HTTP v1)** is enabled under Firebase Project settings > Cloud Messaging.

This secret lets the Worker use the authenticated Google APIs to read approved member device tokens and send FCM alerts. Treat it as a powerful credential; restrict access to Cloudflare's account and rotate the credential if ever exposed. For tighter production security, use a dedicated service account with only the required Cloud Firestore document read/write and Firebase Cloud Messaging send permissions, rather than a broadly privileged default account.

## C. Connect Cloudflare to PMBC

1. Open [push-sender-config.js](https://github.com/nicaffus1/pmbc/blob/main/push-sender-config.js) in GitHub.
2. Tap Edit and replace the empty string in `PUSH_SENDER_URL` with the exact deployed `https://...workers.dev` URL.
3. Commit the change. This URL is public and safe to put in GitHub; the Firebase credential is **not**.
4. Open [PMBC Notifications](https://nicaffus1.github.io/pmbc/#notifications) from the Home Screen app, sign in as an approved administrator, and refresh/update the app if necessary.
5. In Notifications, create an **admin-only** test notice first. The button should say **Publish & Send Phone Alerts** after the Worker URL is configured.
6. On a device that previously opted into notifications, check for an actual push. Later test **All approved members**.

The PMBC admin form stores the in-app inbox notice first, then calls the authenticated Worker to send phone alerts. If phone sending fails, the inbox notice is still saved. The **Send phone alert** button beside notices you published supports an attempt after setup; the backend will block duplicate sends for the same notice batch.

## How the sender protects church members

- An admin must be signed into PMBC; Cloudflare verifies the Firebase ID token's signature and project and checks the user's **current** Firestore status and admin role.
- It sends **only** a notice created by that same admin, with audience of approved members or admins.
- The Worker selects recipients from approved Firestore members and registered, enabled device tokens; it never sends directly to arbitrary tokens supplied by the browser.
- Messages are delivered in batches of **up to 25 devices** per request to fit Cloudflare's 50-external-subrequest Free plan limit. PMBC automatically steps through batches for up to 500 registered devices.
- Duplicate batch submissions are prevented using the Firestore `notificationDispatch` collection. Partial failures are reported; they cannot automatically be retried without manual investigation.
- System-generated event/Serve scheduled reminders **remain disabled**. You do not need Firebase Cloud Functions or Firebase Blaze for this manual-only Cloudflare route.

## Caveats

- Cloudflare Free currently limits external fetches to 50 per incoming request and has other fair-use limits. See https://developers.cloudflare.com/workers/platform/limits/ . Free operation is not guaranteed without limits or future pricing changes.
- The Cloudflare code needs live deployment and phone testing. The assistant cannot confirm operation in your account until the Worker is created and the secret configured.
- Push notifications may show on a phone lock screen. Don't send sensitive prayer details or private personal information in broad notifications.
- If you receive a permission/index/service-account error from the sender, review Cloudflare Worker logs without sharing any private keys. Make sure Firestore and FCM APIs are enabled and the service account has sufficient permissions.
