# PMBC phone push setup (first manual test)

This repository has a working in-app inbox. Phone alerts need these Firebase configuration and deployment steps before they can be delivered. No private Firebase Admin SDK key or service-account JSON should be committed to GitHub.

## 1. Get the public Web Push key
1. Open https://console.firebase.google.com/project/pmbc-d6d17/settings/cloudmessaging
2. Under **Web Push certificates**, click **Generate key pair** (if necessary).
3. Copy the **public key**.
4. In GitHub, edit `push-config.js` and paste the **public key only** into `PUBLIC_VAPID_KEY`.
5. Commit the edit. GitHub Pages will publish this client-side change.

The key is a public VAPID key and is intended for browsers. Do **not** paste any private key or service-account credentials into a repository.

## 2. Publish Firestore rules
Copy the complete `firestore.rules` content from this repository into:
https://console.firebase.google.com/project/pmbc-d6d17/firestore/rules
Select **Publish**. The new rules let approved members save their own encrypted FCM routing tokens beneath `users/{uid}/pushTokens`. They do not let other members read those tokens.

## 3. Deploy the trusted sender
The sender is in `functions/index.js`; it **does not run on GitHub Pages**. It runs only after deploying to Firebase Cloud Functions.

Firebase Cloud Functions requires the **Blaze (pay-as-you-go)** plan with billing enabled. Check your organization's approval, usage, and budget alerts before enabling billing.

From a terminal or Google Cloud Shell with the Firebase CLI installed, in this repository:

```sh
npm install -g firebase-tools
firebase login
firebase use pmbc-d6d17
cd functions && npm install && cd ..
firebase deploy --only functions --project pmbc-d6d17
```

If the Firebase CLI says this folder isn't a Firebase project, use the explicit `--project` argument above. Cloud Functions will deploy the `deliverAdminNotification` function in `us-central1`.

The code delivers a push to currently **approved** members (for member notices), or only approved **admins** (for admin notices), who have opted in on their devices. Invalid device tokens are removed automatically. It deliberately does not include sensitive prayer details unless an admin wrote them into an announcement. Avoid including private member information in public messages.

## 4. Enable on iPhone
1. Open https://nicaffus1.github.io/pmbc/ in Safari.
2. Use Share > **Add to Home Screen**; open PMBC **from the Home Screen icon**.
3. Log in as an approved member.
4. Open the Notifications bell > **Enable Phone Alerts** and approve iOS permission.
5. An admin opens Notifications > **Send notification**, selects the audience, and publishes a harmless test message.
6. Lock the phone to verify alert delivery and tapping the alert opens PMBC.

Apple requires iOS 16.4 or newer and explicit permission for Home Screen web push. Alerts may be affected by Focus/Do Not Disturb/device settings.

## Scope
- **Implemented:** opt-in FCM device token registration, permission button, secure token rules, push display in the PMBC service worker, secure server sender, notification click-through, in-app inbox.
- **Requires manual setup:** public VAPID key, Firestore rules publication, Cloud Functions deployment, optional billing approval.
- **Not yet implemented:** automatic scheduled reminders for event times, Serve signups, unfilled slots, and prayers. Manual admin notices are the first test.
