# PMBC Manual Push Notifications — Free Spark Plan

PMBC uses **Firebase Cloud Messaging (FCM)** to receive push notifications. You do **not** need to enable billing or deploy Cloud Functions to send a manual push from the Firebase Console.

## First: enable phone alerts

1. Open [PMBC Notifications](https://nicaffus1.github.io/pmbc/#notifications).
2. On iPhone, install the website using Safari > Share > Add to Home Screen, then launch PMBC from the Home Screen icon.
3. Sign in to an **approved** PMBC member account.
4. Tap **Enable Phone Alerts**, then allow notifications.
5. Once the device is registered, tap **Copy my device token**. This is a long device identifier used to route push messages. Treat it as private. Each member/device has its own token.
6. Keep the app closed or in the background for the first test.

If the button says notifications are unsupported on iPhone, confirm PMBC was opened from its Home Screen icon. Check the iPhone notification settings.

The public Firebase Web Push key has already been configured in `push-config.js`. **Do not share your private VAPID key** or any Firebase service-account secrets.

## Send a free manual test

1. Open [Firebase Messaging](https://console.firebase.google.com/project/pmbc-d6d17/messaging).
2. Choose **Create campaign** or **Create your first campaign**, then a notification campaign, as offered in your Firebase Console.
3. Enter a title such as **PMBC Push Test** and message **Testing church notifications**.
4. Select **Send test message**.
5. Paste the device's **FCM registration token** copied from PMBC; add/select it as a test target, then send.
6. Confirm a phone alert appears. Tapping it should open PMBC.

Firebase's official guide: https://firebase.google.com/docs/cloud-messaging/web/get-started

## Send a manual message to more people

The Firebase Notifications composer can offer app/segment targeting for campaigns. Follow the options presented in your project. **Be careful:** campaign targeting is not automatically restricted to approved PMBC members. For private, admin-only, or personally sensitive notices, do **not** send a broad campaign. Use individual test tokens for initial testing and verify recipients.

This free manual flow **does not automatically publish the same message to PMBC's in-app inbox**. The app's **Send notification** form publishes to the Firestore inbox only. Firebase Console messages send phone pushes independently.

### What is (and is not) active

- **Available without billing:** member opt-in, FCM registration token, device-token copy, manual push through Firebase Console, PMBC's separate in-app notification inbox.
- **Not active:** automated push on app announcement publication, automatic event/prayer/Serve reminders, server-selected audiences, and Cloud Functions.
- The optional backend source remains in `functions/` for possible future use; **do not deploy it** for this free/manual-only plan.

## Troubleshooting

- Make sure `firestore.rules` from this repository is published in [Firebase Rules](https://console.firebase.google.com/project/pmbc-d6d17/firestore/rules). Members must be allowed to save their own device token.
- Confirm the browser allowed notifications and the PMBC application is on the iPhone Home Screen.
- Check Firebase Cloud Messaging is enabled for the project.
- If test messages fail, generate a new token by opening PMBC and tapping Enable Phone Alerts again, then use the newly copied token.
- Avoid sending private prayer information in notification titles or bodies, since notifications can appear on lock screens.

The app code is committed, but live delivery can only be verified by sending a Firebase Console test message to an opted-in phone.
